
-- Fusion de contacts par nom : lien réversible + emails secondaires
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS merged_into_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS secondary_emails text[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_contacts_merged_into ON contacts(merged_into_contact_id) WHERE merged_into_contact_id IS NOT NULL;

-- Fonction de fusion : re-pointe tous les échanges du contact secondaire vers le primaire
CREATE OR REPLACE FUNCTION public.merge_contacts(primary_id uuid, secondary_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_secondary_email text;
BEGIN
  -- Vérifie que les 2 contacts appartiennent à la même org et que l'appelant est membre
  SELECT organization_id, email INTO v_org, v_secondary_email FROM contacts WHERE id = secondary_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Secondary contact not found'; END IF;
  IF NOT private.is_org_member(v_org) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF primary_id = secondary_id THEN RAISE EXCEPTION 'Cannot merge a contact with itself'; END IF;

  -- Re-pointe les données vers le contact primaire
  UPDATE communication_messages SET contact_id = primary_id WHERE contact_id = secondary_id;
  UPDATE meeting_participants SET contact_id = primary_id WHERE contact_id = secondary_id;
  UPDATE behavioral_signals SET contact_id = primary_id WHERE contact_id = secondary_id;

  -- Ajoute l'email secondaire à la liste d'alias du primaire (pour les futures synchros)
  IF v_secondary_email IS NOT NULL THEN
    UPDATE contacts
    SET secondary_emails = (
      SELECT array_agg(DISTINCT e)
      FROM unnest(coalesce(secondary_emails, '{}') || ARRAY[v_secondary_email]) e
      WHERE e IS NOT NULL AND e <> contacts.email
    )
    WHERE id = primary_id;
  END IF;

  -- Marque le contact secondaire comme fusionné (réversible, masqué des listes)
  UPDATE contacts
  SET merged_into_contact_id = primary_id,
      enrichment_status = 'merged',
      updated_at = now()
  WHERE id = secondary_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_contacts(uuid, uuid) TO authenticated;

-- Fonction d'annulation de fusion
CREATE OR REPLACE FUNCTION public.unmerge_contact(secondary_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM contacts WHERE id = secondary_id;
  IF v_org IS NULL OR NOT private.is_org_member(v_org) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE contacts SET merged_into_contact_id = NULL, enrichment_status = 'pending', updated_at = now()
  WHERE id = secondary_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unmerge_contact(uuid) TO authenticated;
