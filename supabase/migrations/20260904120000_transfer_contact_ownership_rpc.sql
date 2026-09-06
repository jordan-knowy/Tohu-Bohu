-- La passation (réattribution de contacts) est cassée par les RLS "fiches
-- privées par défaut" (contacts_owner_write exige owner_user_id = auth.uid()
-- en USING ET en WITH CHECK, donc personne — même le owner actuel — ne peut
-- jamais changer owner_user_id vers quelqu'un d'autre). RPC security definer
-- dédiée : ouverte à tout membre de l'org (comportement d'avant l'ajout du
-- partage de fiches), transfert + journal contact_transfers atomiques.
create or replace function public.transfer_contact_ownership(
  p_organization_id uuid,
  p_contact_ids uuid[],
  p_to_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transferred integer;
begin
  if not private.is_org_member(p_organization_id) then
    raise exception 'Not authorized';
  end if;
  if not exists (
    select 1 from public.memberships
    where organization_id = p_organization_id and user_id = p_to_user_id
  ) then
    raise exception 'Target user is not a member of this organization';
  end if;

  with targets as (
    select id, owner_user_id as from_user_id
    from public.contacts
    where organization_id = p_organization_id
      and id = any(p_contact_ids)
      and merged_into_contact_id is null
      and owner_user_id is distinct from p_to_user_id
  ),
  updated as (
    update public.contacts c
    set owner_user_id = p_to_user_id
    from targets t
    where c.id = t.id
    returning c.id
  ),
  logged as (
    insert into public.contact_transfers (organization_id, contact_id, from_user_id, to_user_id, kept_copy, transferred_by)
    select p_organization_id, t.id, t.from_user_id, p_to_user_id, false, auth.uid()
    from targets t
    returning 1
  )
  select count(*) into v_transferred from targets;

  return v_transferred;
end;
$$;

revoke all on function public.transfer_contact_ownership(uuid, uuid[], uuid) from public, anon;
grant execute on function public.transfer_contact_ownership(uuid, uuid[], uuid) to authenticated;
