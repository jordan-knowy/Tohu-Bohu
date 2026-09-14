-- Détecte si un email appartient à un membre réel de l'organisation Tohu
-- (un coéquipier, pas un contact CRM). Utilisé par resolve_contact_identity
-- pour ne jamais créer de fiche Personne — même candidate cachée — pour un
-- participant de réunion qui est en fait un teammate. auth.users n'est pas
-- exposé par PostgREST : cette vérification doit passer par une fonction SQL
-- security definer, même pattern que private.is_org_member.

create or replace function private.is_org_member_email(p_organization_id uuid, p_email text)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.organization_id = p_organization_id
      and public.normalize_identity_email(u.email) = public.normalize_identity_email(p_email)
  );
$$;

revoke all on function private.is_org_member_email(uuid, text) from public, anon;
grant execute on function private.is_org_member_email(uuid, text) to authenticated, service_role;
