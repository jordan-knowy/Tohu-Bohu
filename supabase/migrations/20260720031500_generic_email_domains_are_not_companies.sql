-- Un domaine de messagerie grand public ou partagé par une profession ne
-- constitue pas une identité d'entreprise. Cette règle protège la détection,
-- le rattachement automatique et répare les rapprochements historiques.

create or replace function public.is_generic_email_domain(p_domain text)
returns boolean
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select public.normalize_company_domain(p_domain) = any (array[
    'gmail.com', 'googlemail.com',
    'outlook.com', 'outlook.fr',
    'hotmail.com', 'hotmail.fr',
    'live.com', 'live.fr', 'msn.com',
    'yahoo.com', 'yahoo.fr',
    'icloud.com', 'me.com', 'mac.com',
    'proton.me', 'protonmail.com',
    'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'laposte.net',
    'gmx.com', 'gmx.fr', 'aol.com',
    'avocat.com', 'avocat.fr'
  ]::text[]);
$$;

revoke all on function public.is_generic_email_domain(text) from public, anon;
grant execute on function public.is_generic_email_domain(text) to authenticated, service_role;

-- Garde-fou central : même si un futur connecteur oublie de filtrer ces
-- domaines, le résolveur d'identité ne pourra pas recréer « Outlook » ou
-- « Avocat » comme entreprise.
create or replace function public.resolve_company_identity(
  p_organization_id uuid,
  p_name text,
  p_domain text default null,
  p_industry text default null,
  p_create_if_missing boolean default true
)
returns table (company_id uuid, created boolean)
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  normalized_domain_value text := public.normalize_company_domain(p_domain);
  normalized_name_value text := public.normalize_entity_name(p_name);
  domain_derived_name text;
  generic_domain boolean;
  resolved_id uuid;
begin
  if auth.role() <> 'service_role' and not private.is_org_member(p_organization_id) then
    raise exception 'Accès refusé';
  end if;

  generic_domain := public.is_generic_email_domain(normalized_domain_value);
  if generic_domain then
    domain_derived_name := public.normalize_entity_name(
      replace(split_part(normalized_domain_value, '.', 1), '-', ' ')
    );
    normalized_domain_value := null;
    if normalized_name_value = domain_derived_name then
      normalized_name_value := null;
    end if;
  end if;

  -- Sans identité d'entreprise fiable, ne rien créer.
  if normalized_domain_value is null and normalized_name_value is null then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || '|company|' ||
    coalesce(normalized_domain_value, normalized_name_value, ''),
    0
  ));

  if normalized_domain_value is not null then
    select id
    into resolved_id
    from public.companies
    where organization_id = p_organization_id
      and normalized_domain = normalized_domain_value
    order by created_at
    limit 1;
  end if;

  if resolved_id is null and normalized_name_value is not null then
    select id
    into resolved_id
    from public.companies
    where organization_id = p_organization_id
      and normalized_name = normalized_name_value
    order by created_at
    limit 1;
  end if;

  if resolved_id is not null then
    update public.companies
    set
      domain = coalesce(domain, normalized_domain_value),
      industry = coalesce(industry, p_industry),
      updated_at = now()
    where id = resolved_id;
    return query select resolved_id, false;
    return;
  end if;

  if not p_create_if_missing then
    return;
  end if;

  insert into public.companies (
    organization_id, name, domain, industry, public_context, is_tracked
  )
  values (
    p_organization_id,
    coalesce(nullif(btrim(p_name), ''), normalized_domain_value, 'Organisation'),
    normalized_domain_value,
    nullif(btrim(p_industry), ''),
    '{}'::jsonb,
    false
  )
  returning id into resolved_id;

  return query select resolved_id, true;
end;
$$;

revoke all on function public.resolve_company_identity(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.resolve_company_identity(uuid, text, text, text, boolean) to authenticated, service_role;

create or replace function public.detect_account_candidates(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_job_id uuid;
  v_candidates jsonb;
begin
  if auth.uid() is null or not private.is_org_member(p_organization_id) then
    raise exception 'Accès refusé à cette organisation';
  end if;

  insert into public.sync_jobs (
    organization_id, user_id, job_type, status, current_step, progress, started_at, payload
  )
  values (
    p_organization_id, auth.uid(), 'account_detection', 'running',
    'Détection des organisations', 30, now(), '{}'::jsonb
  )
  returning id into v_job_id;

  with contact_domains as (
    select
      contact.id as contact_id,
      public.normalize_company_domain(split_part(contact.email, '@', 2)) as domain
    from public.contacts contact
    where contact.organization_id = p_organization_id
      and contact.merged_into_contact_id is null
      and contact.email is not null
      and position('@' in contact.email) > 1
  ),
  business_domains as (
    select *
    from contact_domains
    where domain is not null
      and not public.is_generic_email_domain(domain)
  ),
  message_stats as (
    select
      business.domain,
      count(message.id) as message_count,
      max(message.sent_at) as last_message_at
    from business_domains business
    left join public.communication_messages message
      on message.contact_id = business.contact_id
     and message.organization_id = p_organization_id
    group by business.domain
  ),
  domain_contacts as (
    select domain, count(*) as contact_count
    from business_domains
    group by domain
  ),
  matched as (
    select
      stats.domain,
      domain_contacts.contact_count,
      stats.message_count,
      stats.last_message_at,
      company.id as company_id,
      company.name as company_name,
      company.industry,
      company.public_context,
      coalesce(company.is_tracked, false) as already_tracked
    from message_stats stats
    join domain_contacts using (domain)
    left join lateral (
      select candidate.*
      from public.companies candidate
      where candidate.organization_id = p_organization_id
        and (
          candidate.normalized_domain = stats.domain
          or lower(candidate.name) = replace(split_part(stats.domain, '.', 1), '-', ' ')
        )
      limit 1
    ) company on true
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'company_id', company_id,
        'name', coalesce(company_name, initcap(replace(split_part(domain, '.', 1), '-', ' '))),
        'domain', domain,
        'industry', industry,
        'location', public_context ->> 'location',
        'interactions', greatest(coalesce(message_count, 0), contact_count),
        'last_interaction_at', last_message_at,
        'source', 'Messagerie connectée',
        'already_tracked', already_tracked
      )
      order by greatest(coalesce(message_count, 0), contact_count) desc, domain
    ),
    '[]'::jsonb
  )
  into v_candidates
  from matched;

  update public.sync_jobs
  set
    status = 'succeeded',
    current_step = 'Préparation des résultats',
    progress = 100,
    completed_at = now(),
    payload = jsonb_build_object('candidates', v_candidates)
  where id = v_job_id;

  return jsonb_build_object('job_id', v_job_id, 'candidates', v_candidates);
end;
$$;

revoke execute on function public.detect_account_candidates(uuid) from public, anon;
grant execute on function public.detect_account_candidates(uuid) to authenticated;

-- Les contacts provenant d'une synchronisation peuvent rester intégrés comme
-- personnes, mais ne doivent plus être rattachés au faux compte Outlook,
-- Avocat, Gmail, etc. Les rattachements manuels sont conservés.
with generic_companies as (
  select id, organization_id
  from public.companies
  where public.is_generic_email_domain(domain)
)
update public.contacts contact
set company_id = null, updated_at = now()
from generic_companies company
where contact.organization_id = company.organization_id
  and contact.company_id = company.id
  and coalesce(contact.source_summary ->> 'source', '') not in ('manual', 'manual_integration')
  and coalesce(contact.source_summary ->> 'last_identity_source', '') not in ('manual', 'manual_integration');

update public.companies company
set
  is_tracked = false,
  tracked_at = null,
  tracked_by = null,
  updated_at = now(),
  public_context = coalesce(company.public_context, '{}'::jsonb)
    || jsonb_build_object(
      'excluded_from_company_detection', true,
      'exclusion_reason', 'generic_email_domain'
    )
where public.is_generic_email_domain(company.domain);

-- Compatibilité avec l'ancien parcours d'accueil : il peut encore remplacer
-- une sélection complète, mais ne rattache plus les personnes par un domaine
-- générique.
create or replace function public.set_tracked_companies(
  p_organization_id uuid,
  p_selection jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_job_id uuid;
  v_plan text;
  v_limit integer;
  v_count integer;
  v_item jsonb;
  v_company_id uuid;
  v_name text;
  v_domain text;
  v_tracked integer := 0;
  v_linked integer := 0;
begin
  if auth.uid() is null or not private.is_org_member(p_organization_id) then
    raise exception 'Accès refusé à cette organisation';
  end if;
  if p_selection is null or jsonb_typeof(p_selection) <> 'array' then
    raise exception 'Sélection invalide';
  end if;

  v_count := jsonb_array_length(p_selection);
  if v_count < 1 then
    raise exception 'Sélectionne au moins un compte';
  end if;

  select subscription.plan_id::text
  into v_plan
  from public.subscriptions subscription
  where subscription.organization_id = p_organization_id
  limit 1;
  v_plan := coalesce(v_plan, 'free');

  begin
    execute format(
      'select plan.max_tracked_accounts from public.subscription_plans plan where plan.id::text = %L limit 1',
      v_plan
    )
    into v_limit;
  exception when undefined_table or undefined_column then
    v_limit := null;
  end;

  if v_limit is not null and v_count > v_limit then
    raise exception 'Le forfait % est limité à % comptes suivis (% demandés)', v_plan, v_limit, v_count;
  end if;

  insert into public.sync_jobs (
    organization_id, user_id, job_type, status, current_step, progress, started_at, payload
  )
  values (
    p_organization_id, auth.uid(), 'account_analysis', 'running',
    'Activation des comptes sélectionnés', 20, now(), '{}'::jsonb
  )
  returning id into v_job_id;

  update public.companies
  set is_tracked = false, tracked_at = null, tracked_by = null
  where organization_id = p_organization_id and is_tracked;

  for v_item in select * from jsonb_array_elements(p_selection) loop
    v_company_id := nullif(v_item ->> 'company_id', '')::uuid;
    v_name := nullif(trim(v_item ->> 'name'), '');
    v_domain := nullif(public.normalize_company_domain(v_item ->> 'domain'), '');

    if v_company_id is not null then
      select id
      into v_company_id
      from public.companies
      where id = v_company_id and organization_id = p_organization_id;
    end if;

    if v_company_id is null and (v_domain is not null or v_name is not null) then
      select id
      into v_company_id
      from public.companies
      where organization_id = p_organization_id
        and (
          (v_domain is not null and normalized_domain = v_domain)
          or (v_name is not null and lower(name) = lower(v_name))
        )
      limit 1;
    end if;

    if v_company_id is null then
      if v_name is null then
        continue;
      end if;
      insert into public.companies (organization_id, name, domain, public_context)
      values (p_organization_id, v_name, v_domain, '{}'::jsonb)
      returning id into v_company_id;
    end if;

    update public.companies
    set
      is_tracked = true,
      tracked_at = now(),
      tracked_by = auth.uid(),
      domain = coalesce(domain, v_domain)
    where id = v_company_id and organization_id = p_organization_id;
    v_tracked := v_tracked + 1;
  end loop;

  update public.sync_jobs
  set current_step = 'Rattachement des personnes détectées', progress = 70
  where id = v_job_id;

  with tracked_domains as (
    select id, normalized_domain as domain
    from public.companies
    where organization_id = p_organization_id
      and is_tracked
      and normalized_domain is not null
      and not public.is_generic_email_domain(normalized_domain)
  )
  update public.contacts contact
  set company_id = company.id
  from tracked_domains company
  where contact.organization_id = p_organization_id
    and contact.company_id is null
    and contact.merged_into_contact_id is null
    and contact.email is not null
    and public.normalize_company_domain(split_part(contact.email, '@', 2)) = company.domain;
  get diagnostics v_linked = row_count;

  update public.sync_jobs
  set
    status = 'succeeded',
    current_step = 'Portefeuille initialisé',
    progress = 100,
    completed_at = now(),
    payload = jsonb_build_object('tracked', v_tracked, 'linked_contacts', v_linked)
  where id = v_job_id;

  return jsonb_build_object(
    'job_id', v_job_id,
    'tracked', v_tracked,
    'linked_contacts', v_linked
  );
end;
$$;

revoke execute on function public.set_tracked_companies(uuid, jsonb) from public, anon;
grant execute on function public.set_tracked_companies(uuid, jsonb) to authenticated;

comment on function public.is_generic_email_domain(text) is
  'Vrai pour une boîte mail personnelle ou un domaine professionnel partagé qui ne prouve aucune appartenance à une même entreprise.';

notify pgrst, 'reload schema';
