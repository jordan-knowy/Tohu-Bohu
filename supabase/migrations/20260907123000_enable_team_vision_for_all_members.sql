-- Tous les membres d'un workspace peuvent voir la Vision d'équipe.
-- On n'ouvre pas pour autant la table profiles : cette RPC n'expose que les
-- trois champs strictement nécessaires au composant (id, nom et avatar).

create or replace function public.get_team_vision_members(p_organization_id uuid)
returns table (
  id uuid,
  full_name text,
  avatar_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.id,
    coalesce(nullif(btrim(profile.full_name), ''), 'Membre de l’équipe') as full_name,
    profile.avatar_url
  from public.memberships member
  join public.profiles profile on profile.id = member.user_id
  where member.organization_id = p_organization_id
    and exists (
      select 1
      from public.memberships viewer
      where viewer.organization_id = p_organization_id
        and viewer.user_id = (select auth.uid())
    )
  order by lower(coalesce(nullif(btrim(profile.full_name), ''), 'Membre de l’équipe'));
$$;

revoke all on function public.get_team_vision_members(uuid) from public, anon;
grant execute on function public.get_team_vision_members(uuid) to authenticated, service_role;

comment on function public.get_team_vision_members(uuid) is
  'Profils minimaux des membres du workspace pour la Vision d’équipe, accessibles à chaque membre de ce workspace.';

notify pgrst, 'reload schema';
