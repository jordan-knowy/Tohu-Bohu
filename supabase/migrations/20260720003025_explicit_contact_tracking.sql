-- Les données découvertes par les connecteurs restent disponibles comme
-- candidates, mais seules les personnes explicitement intégrées apparaissent
-- dans le produit et alimentent les traitements coûteux.

alter table public.contacts
  add column if not exists is_tracked boolean not null default false,
  add column if not exists tracked_at timestamptz,
  add column if not exists tracked_by uuid references auth.users(id) on delete set null;

create index if not exists contacts_tracked_idx
  on public.contacts (organization_id, updated_at desc)
  where is_tracked and merged_into_contact_id is null;

-- Reconstitue prudemment les intégrations certaines : saisies manuelles,
-- personnes déjà configurées dans Tohu, et personnes des comptes suivis.
update public.contacts c
set
  is_tracked = true,
  tracked_at = coalesce(c.tracked_at, c.updated_at, c.created_at, now())
where c.merged_into_contact_id is null
  and (
    c.company_id in (
      select company.id
      from public.companies company
      where company.organization_id = c.organization_id
        and company.is_tracked
    )
    or coalesce(c.source_summary ->> 'source', '') in ('manual', 'manual_integration')
    or coalesce(c.source_summary ->> 'last_identity_source', '') in ('manual', 'manual_integration')
    or exists (
      select 1 from public.person_settings settings
      where settings.organization_id = c.organization_id
        and settings.contact_id = c.id
    )
    or exists (
      select 1 from public.person_user_settings settings
      where settings.organization_id = c.organization_id
        and settings.contact_id = c.id
    )
  );

create or replace function public.detect_person_candidates(
  p_organization_id uuid,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if auth.uid() is null or not private.is_org_member(p_organization_id) then
    raise exception 'Accès refusé à cette organisation';
  end if;

  return jsonb_build_object(
    'candidates',
    coalesce((
      select jsonb_agg(to_jsonb(candidate) order by candidate.interactions desc, candidate.last_interaction_at desc nulls last, candidate.full_name)
      from (
        select
          c.id as contact_id,
          c.full_name,
          c.email,
          c.role_title,
          c.company_id,
          company.name as company_name,
          count(message.id)::integer as interactions,
          max(message.sent_at) as last_interaction_at,
          coalesce(c.source_summary ->> 'last_identity_source', c.source_summary ->> 'source', 'Connecteur') as source
        from public.contacts c
        left join public.companies company on company.id = c.company_id
        left join public.communication_messages message
          on message.organization_id = c.organization_id
         and message.contact_id = c.id
        where c.organization_id = p_organization_id
          and c.merged_into_contact_id is null
          and not c.is_tracked
        group by c.id, company.name
        order by count(message.id) desc, max(message.sent_at) desc nulls last, c.full_name
        limit least(greatest(coalesce(p_limit, 100), 1), 250)
      ) candidate
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.add_tracked_contact(
  p_organization_id uuid,
  p_contact_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if auth.uid() is null or not private.is_org_member(p_organization_id) then
    raise exception 'Accès refusé à cette organisation';
  end if;

  update public.contacts
  set
    is_tracked = true,
    tracked_at = coalesce(tracked_at, now()),
    tracked_by = auth.uid(),
    owner_user_id = coalesce(owner_user_id, auth.uid()),
    updated_at = now()
  where id = p_contact_id
    and organization_id = p_organization_id
    and merged_into_contact_id is null;

  if not found then
    raise exception 'Personne introuvable';
  end if;

  insert into public.person_user_settings (
    organization_id, contact_id, user_id, watch_enabled, updated_at
  ) values (
    p_organization_id, p_contact_id, auth.uid(), true, now()
  )
  on conflict (organization_id, contact_id, user_id) do update
  set watch_enabled = true, updated_at = now();
end;
$$;

create or replace function public.add_tracked_company(
  p_organization_id uuid,
  p_company_id uuid,
  p_name text default null,
  p_domain text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_company_id uuid := p_company_id;
  v_plan_id text;
  v_limit integer;
  v_current_count integer;
begin
  if auth.uid() is null or not private.is_org_member(p_organization_id) then
    raise exception 'Accès refusé à cette organisation';
  end if;

  if v_company_id is not null then
    select id into v_company_id
    from public.companies
    where id = v_company_id and organization_id = p_organization_id;
  end if;

  if v_company_id is null and nullif(trim(p_domain), '') is not null then
    select id into v_company_id
    from public.companies
    where organization_id = p_organization_id
      and lower(domain) = lower(trim(p_domain))
    limit 1;
  end if;

  if v_company_id is null and nullif(trim(p_name), '') is not null then
    select id into v_company_id
    from public.companies
    where organization_id = p_organization_id
      and lower(name) = lower(trim(p_name))
    limit 1;
  end if;

  if v_company_id is null then
    if nullif(trim(p_name), '') is null then
      raise exception 'Nom du compte requis';
    end if;
    insert into public.companies (organization_id, name, domain, public_context)
    values (p_organization_id, trim(p_name), nullif(lower(trim(p_domain)), ''), '{}'::jsonb)
    returning id into v_company_id;
  end if;

  select s.plan_id into v_plan_id
  from public.subscriptions s
  where s.organization_id = p_organization_id
  order by (s.status = 'active') desc, s.updated_at desc
  limit 1;

  select plan.max_tracked_accounts into v_limit
  from public.subscription_plans plan
  where plan.id = coalesce(v_plan_id, 'free');

  select count(*) into v_current_count
  from public.companies
  where organization_id = p_organization_id and is_tracked;

  if v_limit is not null
    and not exists (select 1 from public.companies where id = v_company_id and is_tracked)
    and v_current_count >= v_limit
  then
    raise exception 'Le forfait % est limité à % comptes suivis', coalesce(v_plan_id, 'free'), v_limit;
  end if;

  update public.companies
  set
    is_tracked = true,
    tracked_at = coalesce(tracked_at, now()),
    tracked_by = auth.uid(),
    domain = coalesce(domain, nullif(lower(trim(p_domain)), '')),
    updated_at = now()
  where id = v_company_id and organization_id = p_organization_id;

  return v_company_id;
end;
$$;

revoke all on function public.detect_person_candidates(uuid, integer) from public, anon;
revoke all on function public.add_tracked_contact(uuid, uuid) from public, anon;
revoke all on function public.add_tracked_company(uuid, uuid, text, text) from public, anon;
grant execute on function public.detect_person_candidates(uuid, integer) to authenticated;
grant execute on function public.add_tracked_contact(uuid, uuid) to authenticated;
grant execute on function public.add_tracked_company(uuid, uuid, text, text) to authenticated;

comment on column public.contacts.is_tracked is
  'Vrai uniquement après intégration explicite dans Tohu ; les contacts découverts restent des candidats cachés.';
