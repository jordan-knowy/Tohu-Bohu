-- merge_contacts écrivait enrichment_status = 'merged', une valeur que
-- contacts_enrichment_status_check n'a jamais autorisée (pending/running/
-- done/failed) : toute fusion échouait avec une violation de contrainte.
-- merged_into_contact_id est déjà le signal exploité partout ailleurs
-- (.is('merged_into_contact_id', null)) — enrichment_status n'a pas à
-- porter cette information.
create or replace function public.merge_contacts(primary_id uuid, secondary_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
DECLARE
  v_org uuid;
  v_secondary_email text;
BEGIN
  SELECT organization_id, email INTO v_org, v_secondary_email FROM contacts WHERE id = secondary_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Secondary contact not found'; END IF;
  IF NOT private.is_org_member(v_org) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF primary_id = secondary_id THEN RAISE EXCEPTION 'Cannot merge a contact with itself'; END IF;

  UPDATE communication_messages SET contact_id = primary_id WHERE contact_id = secondary_id;
  UPDATE meeting_participants SET contact_id = primary_id WHERE contact_id = secondary_id;
  UPDATE behavioral_signals SET contact_id = primary_id WHERE contact_id = secondary_id;

  IF v_secondary_email IS NOT NULL THEN
    UPDATE contacts
    SET secondary_emails = (
      SELECT array_agg(DISTINCT e)
      FROM unnest(coalesce(secondary_emails, '{}') || ARRAY[v_secondary_email]) e
      WHERE e IS NOT NULL AND e <> contacts.email
    )
    WHERE id = primary_id;
  END IF;

  UPDATE contacts
  SET merged_into_contact_id = primary_id,
      updated_at = now()
  WHERE id = secondary_id;
END;
$$;
