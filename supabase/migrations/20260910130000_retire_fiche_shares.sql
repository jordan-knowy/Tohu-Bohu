-- share_fiche/list_fiche_shares/revoke_fiche_share ne sont appelées par aucun
-- composant frontend (le geste qu'elles servaient — donner l'accès à une fiche
-- à un collègue précis — est déjà couvert par set_fiche_vision_grant, utilisé
-- par grantPersonAccess/grantAccountAccess). can_view_contact/can_view_company
-- et les fonctions « partagé avec moi » (réellement affichées, elles) sont
-- d'abord repointées sur fiche_vision_grants avant de supprimer fiche_shares,
-- sinon la lecture des emails (communication_messages) casserait.

create or replace function private.can_view_contact(p_organization_id uuid, p_contact_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.contacts c
    where c.id = p_contact_id
      and c.organization_id = p_organization_id
      and (
        c.owner_user_id = auth.uid()
        or exists (
          select 1
          from public.fiche_visions v
          join public.fiche_vision_grants g on g.vision_id = v.id
          where v.organization_id = p_organization_id
            and v.entity_type = 'contact'
            and v.entity_id = p_contact_id
            and g.grantee_user_id = auth.uid()
            and g.revoked_at is null
        )
      )
  );
$$;

create or replace function private.can_view_company(p_organization_id uuid, p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.companies co
    where co.id = p_company_id
      and co.organization_id = p_organization_id
      and (
        exists (
          select 1 from public.contacts c
          where c.company_id = p_company_id and c.owner_user_id = auth.uid()
        )
        or exists (
          select 1
          from public.fiche_visions v
          join public.fiche_vision_grants g on g.vision_id = v.id
          where v.organization_id = p_organization_id
            and v.entity_type = 'company'
            and v.entity_id = p_company_id
            and g.grantee_user_id = auth.uid()
            and g.revoked_at is null
        )
      )
  );
$$;

create or replace function public.list_shared_with_me(p_entity_type text default 'contact')
returns table (
  organization_id uuid,
  entity_id uuid,
  full_name text,
  job_title text,
  avatar_url text,
  from_user_id uuid,
  from_name text,
  note text,
  shared_at timestamptz,
  already_mine boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    v.organization_id, c.id as entity_id, c.full_name, c.role_title as job_title, c.avatar_url,
    v.owner_user_id as from_user_id, coalesce(pr.full_name, 'Membre') as from_name,
    null::text as note, g.granted_at as shared_at,
    exists (
      select 1 from public.contacts mine
      where mine.owner_user_id = auth.uid()
        and mine.id <> c.id
        and public.normalize_identity_email(mine.email) is not null
        and public.normalize_identity_email(mine.email) = public.normalize_identity_email(c.email)
    ) as already_mine
  from public.fiche_vision_grants g
  join public.fiche_visions v on v.id = g.vision_id and v.entity_type = 'contact'
  join public.contacts c on c.id = v.entity_id
  left join public.profiles pr on pr.id = v.owner_user_id
  where g.grantee_user_id = auth.uid() and g.revoked_at is null and p_entity_type = 'contact'
  order by g.granted_at desc;
$$;

create or replace function public.list_shared_accounts_with_me()
returns table (
  organization_id uuid,
  entity_id uuid,
  name text,
  domain text,
  industry text,
  from_user_id uuid,
  from_name text,
  note text,
  shared_at timestamptz,
  already_mine boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    v.organization_id, co.id as entity_id, co.name, co.domain, co.industry,
    v.owner_user_id as from_user_id, coalesce(pr.full_name, 'Membre') as from_name,
    null::text as note, g.granted_at as shared_at,
    exists (
      select 1 from public.companies mine
      where mine.id <> co.id
        and mine.normalized_domain is not null
        and mine.normalized_domain = co.normalized_domain
        and exists (select 1 from public.contacts c where c.company_id = mine.id and c.owner_user_id = auth.uid())
    ) as already_mine
  from public.fiche_vision_grants g
  join public.fiche_visions v on v.id = g.vision_id and v.entity_type = 'company'
  join public.companies co on co.id = v.entity_id
  left join public.profiles pr on pr.id = v.owner_user_id
  where g.grantee_user_id = auth.uid() and g.revoked_at is null
  order by g.granted_at desc;
$$;

drop function if exists public.list_fiche_shares(uuid, text, uuid);
drop function if exists public.revoke_fiche_share(uuid);
drop function if exists public.share_fiche(uuid, text, uuid, uuid, text);
drop table if exists public.fiche_shares;

notify pgrst, 'reload schema';
