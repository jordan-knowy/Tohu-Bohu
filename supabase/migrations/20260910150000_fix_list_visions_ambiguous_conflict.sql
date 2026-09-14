-- list_fiche_visions / list_account_visions (migration 20260910105339) échouaient
-- systématiquement avec "column reference \"organization_id\" is ambiguous"
-- (SQLSTATE 42702) : leur RETURNS TABLE déclare une colonne organization_id,
-- ce qui crée une variable plpgsql du même nom que la colonne réelle de
-- fiche_visions — Postgres ne sait plus laquelle cibler dans la liste de
-- colonnes bare d'ON CONFLICT (...). Fix : cibler la contrainte unique par son
-- nom plutôt que par une liste de colonnes, qui n'a pas cette ambiguïté.
-- Conséquence en prod : toute ouverture de fiche Compte ou Personne échouait
-- (Promise.all avec listFicheVisions/listAccountVisions → rejet global).

create or replace function public.list_fiche_visions(p_organization_id uuid, p_contact_id uuid)
returns table (
  organization_id uuid,
  contact_id uuid,
  is_mine boolean,
  owner_user_id uuid,
  owner_name text,
  share_note text,
  visibility text,
  relationship_state text
)
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if auth.uid() is null or not private.is_org_member(p_organization_id) then
    raise exception 'Not authorized';
  end if;
  if not private.can_view_fiche_entity(p_organization_id, 'contact', p_contact_id) then
    raise exception 'Not authorized';
  end if;

  insert into public.fiche_visions (
    organization_id, entity_type, entity_id, owner_user_id,
    visibility, relationship_state, created_reason
  ) values (
    p_organization_id, 'contact', p_contact_id, auth.uid(),
    'restricted', 'relationship_to_build', 'discovery'
  ) on conflict on constraint fiche_visions_organization_id_entity_type_entity_id_owner_u_key do nothing;

  return query
  select
    vision.organization_id,
    vision.entity_id,
    vision.owner_user_id = auth.uid(),
    vision.owner_user_id,
    coalesce(nullif(btrim(profile.full_name), ''), 'Membre'),
    null::text,
    vision.visibility,
    vision.relationship_state
  from public.fiche_visions vision
  left join public.profiles profile on profile.id = vision.owner_user_id
  where vision.organization_id = p_organization_id
    and vision.entity_type = 'contact'
    and vision.entity_id = p_contact_id
    and private.can_view_fiche_vision(vision.id)
  order by (vision.owner_user_id = auth.uid()) desc, lower(coalesce(profile.full_name, ''));
end;
$$;

create or replace function public.list_account_visions(p_organization_id uuid, p_company_id uuid)
returns table (
  organization_id uuid,
  company_id uuid,
  is_mine boolean,
  owner_user_id uuid,
  owner_name text,
  share_note text,
  visibility text,
  relationship_state text
)
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if auth.uid() is null or not private.is_org_member(p_organization_id) then
    raise exception 'Not authorized';
  end if;
  if not private.can_view_fiche_entity(p_organization_id, 'company', p_company_id) then
    raise exception 'Not authorized';
  end if;

  insert into public.fiche_visions (
    organization_id, entity_type, entity_id, owner_user_id,
    visibility, relationship_state, created_reason
  ) values (
    p_organization_id, 'company', p_company_id, auth.uid(),
    'restricted', 'relationship_to_build', 'discovery'
  ) on conflict on constraint fiche_visions_organization_id_entity_type_entity_id_owner_u_key do nothing;

  return query
  select
    vision.organization_id,
    vision.entity_id,
    vision.owner_user_id = auth.uid(),
    vision.owner_user_id,
    coalesce(nullif(btrim(profile.full_name), ''), 'Membre'),
    null::text,
    vision.visibility,
    vision.relationship_state
  from public.fiche_visions vision
  left join public.profiles profile on profile.id = vision.owner_user_id
  where vision.organization_id = p_organization_id
    and vision.entity_type = 'company'
    and vision.entity_id = p_company_id
    and private.can_view_fiche_vision(vision.id)
  order by (vision.owner_user_id = auth.uid()) desc, lower(coalesce(profile.full_name, ''));
end;
$$;
