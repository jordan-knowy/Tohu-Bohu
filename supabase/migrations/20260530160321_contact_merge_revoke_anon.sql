
-- Révoque l'exécution publique/anon (déjà bloqué par is_org_member, mais propre)
REVOKE EXECUTE ON FUNCTION public.merge_contacts(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unmerge_contact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_contacts(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unmerge_contact(uuid) TO authenticated;
