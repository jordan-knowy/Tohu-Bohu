-- Home Tohu — RPC serveur (détection d'organisations + activation du
-- portefeuille avec limite de forfait validée côté serveur).
-- Dépend de 202607150009_home_foundation.sql. Idempotente.

-- ---------------------------------------------------------------------------
-- Détection des organisations présentes dans les échanges.
-- Regroupe les contacts par domaine email professionnel, compte les messages
-- synchronisés (métadonnées uniquement), déduplique contre `companies`
-- (domaine ou nom) et journalise le job dans `sync_jobs`.
-- ---------------------------------------------------------------------------
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

  insert into public.sync_jobs (organization_id, user_id, job_type, status, current_step, progress, started_at, payload)
  values (p_organization_id, auth.uid(), 'account_detection', 'running', 'Détection des organisations', 30, now(), '{}'::jsonb)
  returning id into v_job_id;

  with contact_domains as (
    select c.id as contact_id,
           lower(split_part(c.email, '@', 2)) as domain
    from public.contacts c
    where c.organization_id = p_organization_id
      and c.merged_into_contact_id is null
      and c.email is not null
      and position('@' in c.email) > 1
  ),
  business_domains as (
    select * from contact_domains
    where domain not in (
      'gmail.com','googlemail.com','outlook.com','outlook.fr','hotmail.com','hotmail.fr',
      'yahoo.com','yahoo.fr','orange.fr','free.fr','wanadoo.fr','icloud.com','live.com',
      'live.fr','sfr.fr','laposte.net','protonmail.com','proton.me','gmx.com','gmx.fr',
      'msn.com','aol.com','me.com','mac.com'
    ) and domain <> ''
  ),
  message_stats as (
    select bd.domain,
           count(m.id) as message_count,
           max(m.sent_at) as last_message_at
    from business_domains bd
    left join public.communication_messages m
      on m.contact_id = bd.contact_id and m.organization_id = p_organization_id
    group by bd.domain
  ),
  domain_contacts as (
    select domain, count(*) as contact_count
    from business_domains
    group by domain
  ),
  matched as (
    select ms.domain,
           dc.contact_count,
           ms.message_count,
           ms.last_message_at,
           co.id as company_id,
           co.name as company_name,
           co.industry as industry,
           co.public_context as public_context,
           coalesce(co.is_tracked, false) as already_tracked
    from message_stats ms
    join domain_contacts dc using (domain)
    left join lateral (
      select c.* from public.companies c
      where c.organization_id = p_organization_id
        and (lower(coalesce(c.domain, '')) = ms.domain
             or lower(c.name) = replace(split_part(ms.domain, '.', 1), '-', ' '))
      limit 1
    ) co on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'company_id', company_id,
           'name', coalesce(company_name, initcap(replace(split_part(domain, '.', 1), '-', ' '))),
           'domain', domain,
           'industry', industry,
           'location', public_context ->> 'location',
           'interactions', greatest(coalesce(message_count, 0), contact_count),
           'last_interaction_at', last_message_at,
           'source', 'Messagerie connectée',
           'already_tracked', already_tracked
         ) order by greatest(coalesce(message_count, 0), contact_count) desc, domain), '[]'::jsonb)
  into v_candidates
  from matched;

  update public.sync_jobs
  set status = 'succeeded',
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

-- ---------------------------------------------------------------------------
-- Activation du portefeuille suivi (S2 → S3).
-- p_selection est l'ensemble COMPLET des comptes à suivre :
--   [{ "company_id": uuid|null, "name": text, "domain": text|null }, …]
-- La limite du forfait (subscription_plans.max_tracked_accounts) est validée
-- ici, côté serveur — le client ne peut pas la contourner.
-- ---------------------------------------------------------------------------
create or replace function public.set_tracked_companies(p_organization_id uuid, p_selection jsonb)
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

  select s.plan_id::text into v_plan
  from public.subscriptions s
  where s.organization_id = p_organization_id
  limit 1;
  v_plan := coalesce(v_plan, 'free');

  begin
    execute format('select p.max_tracked_accounts from public.subscription_plans p where p.id::text = %L limit 1', v_plan)
    into v_limit;
  exception when undefined_table or undefined_column then
    v_limit := null;
  end;

  if v_limit is not null and v_count > v_limit then
    raise exception 'Le forfait % est limité à % comptes suivis (% demandés)', v_plan, v_limit, v_count;
  end if;

  insert into public.sync_jobs (organization_id, user_id, job_type, status, current_step, progress, started_at, payload)
  values (p_organization_id, auth.uid(), 'account_analysis', 'running', 'Activation des comptes sélectionnés', 20, now(), '{}'::jsonb)
  returning id into v_job_id;

  -- La sélection remplace le portefeuille suivi.
  update public.companies
  set is_tracked = false, tracked_at = null, tracked_by = null
  where organization_id = p_organization_id and is_tracked;

  for v_item in select * from jsonb_array_elements(p_selection) loop
    v_company_id := nullif(v_item ->> 'company_id', '')::uuid;
    v_name := nullif(trim(v_item ->> 'name'), '');
    v_domain := nullif(lower(trim(v_item ->> 'domain')), '');

    if v_company_id is not null then
      -- jamais un compte d'un autre workspace
      select id into v_company_id from public.companies
      where id = v_company_id and organization_id = p_organization_id;
    end if;
    if v_company_id is null and (v_domain is not null or v_name is not null) then
      select id into v_company_id from public.companies
      where organization_id = p_organization_id
        and ((v_domain is not null and lower(coalesce(domain, '')) = v_domain)
             or (v_name is not null and lower(name) = lower(v_name)))
      limit 1;
    end if;
    if v_company_id is null then
      if v_name is null then continue; end if;
      insert into public.companies (organization_id, name, domain, public_context)
      values (p_organization_id, v_name, v_domain, '{}'::jsonb)
      returning id into v_company_id;
    end if;

    update public.companies
    set is_tracked = true, tracked_at = now(), tracked_by = auth.uid(), domain = coalesce(domain, v_domain)
    where id = v_company_id and organization_id = p_organization_id;
    v_tracked := v_tracked + 1;
  end loop;

  -- Garde-fou final : la limite s'applique au portefeuille réellement suivi.
  if v_limit is not null then
    select count(*) into v_count from public.companies
    where organization_id = p_organization_id and is_tracked;
    if v_count > v_limit then
      raise exception 'Le forfait % est limité à % comptes suivis', v_plan, v_limit;
    end if;
  end if;

  update public.sync_jobs
  set current_step = 'Rattachement des personnes détectées', progress = 70
  where id = v_job_id;

  -- Rattache les contacts orphelins dont le domaine email correspond à un compte suivi.
  with tracked_domains as (
    select id, lower(domain) as domain
    from public.companies
    where organization_id = p_organization_id and is_tracked and domain is not null
  )
  update public.contacts c
  set company_id = td.id
  from tracked_domains td
  where c.organization_id = p_organization_id
    and c.company_id is null
    and c.merged_into_contact_id is null
    and c.email is not null
    and lower(split_part(c.email, '@', 2)) = td.domain;
  get diagnostics v_linked = row_count;

  update public.sync_jobs
  set status = 'succeeded',
      current_step = 'Portefeuille initialisé',
      progress = 100,
      completed_at = now(),
      payload = jsonb_build_object('tracked', v_tracked, 'linked_contacts', v_linked)
  where id = v_job_id;

  return jsonb_build_object('job_id', v_job_id, 'tracked', v_tracked, 'linked_contacts', v_linked);
end;
$$;

revoke execute on function public.set_tracked_companies(uuid, jsonb) from public, anon;
grant execute on function public.set_tracked_companies(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
