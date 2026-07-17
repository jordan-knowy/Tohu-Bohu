-- Le trigger s'exécute via les triggers de tables uniquement :
-- aucun rôle client ne doit pouvoir l'appeler en RPC.
revoke execute on function public.validate_person_detail_scope() from public, anon, authenticated;
notify pgrst, 'reload schema';
