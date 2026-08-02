-- Une découverte automatique par messagerie n'est une relation que si elle
-- contient au moins un message reçu ET un message envoyé. Ce garde-fou SQL
-- masque aussi les anciennes fiches unidirectionnelles des sélecteurs Home.

create index if not exists communication_messages_relationship_direction_idx
  on public.communication_messages (organization_id, contact_id, (metadata ->> 'user_id'), direction);

create or replace function private.contact_has_reciprocal_email(
  p_organization_id uuid,
  p_contact_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select
    exists (
      select 1
      from public.communication_messages message
      where message.organization_id = p_organization_id
        and message.contact_id = p_contact_id
        and message.direction = 'inbound'
        and message.metadata ->> 'user_id' = p_user_id::text
    )
    and exists (
      select 1
      from public.communication_messages message
      where message.organization_id = p_organization_id
        and message.contact_id = p_contact_id
        and message.direction = 'outbound'
        and message.metadata ->> 'user_id' = p_user_id::text
    );
$$;

revoke all on function private.contact_has_reciprocal_email(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function private.contact_has_reciprocal_email(uuid, uuid, uuid) to service_role;

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
          contact.id as contact_id,
          contact.full_name,
          contact.email,
          contact.role_title,
          contact.company_id,
          company.name as company_name,
          count(message.id)::integer as interactions,
          max(message.sent_at) as last_interaction_at,
          coalesce(contact.source_summary ->> 'last_identity_source', contact.source_summary ->> 'source', 'Connecteur') as source
        from public.contacts contact
        left join public.companies company on company.id = contact.company_id
        join public.communication_messages message
          on message.organization_id = contact.organization_id
         and message.contact_id = contact.id
        where contact.organization_id = p_organization_id
          and contact.merged_into_contact_id is null
          and not contact.is_tracked
          and private.contact_has_reciprocal_email(p_organization_id, contact.id, auth.uid())
        group by contact.id, company.name
        order by count(message.id) desc, max(message.sent_at) desc nulls last, contact.full_name
        limit least(greatest(coalesce(p_limit, 100), 1), 250)
      ) candidate
    ), '[]'::jsonb)
  );
end;
$$;

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
  ) values (
    p_organization_id, auth.uid(), 'account_detection', 'running',
    'Détection des organisations', 30, now(), '{}'::jsonb
  ) returning id into v_job_id;

  with reciprocal_contacts as (
    select
      contact.id as contact_id,
      public.normalize_company_domain(split_part(contact.email, '@', 2)) as domain
    from public.contacts contact
    where contact.organization_id = p_organization_id
      and contact.merged_into_contact_id is null
      and contact.email is not null
      and position('@' in contact.email) > 1
      and private.contact_has_reciprocal_email(p_organization_id, contact.id, auth.uid())
  ),
  business_domains as (
    select *
    from reciprocal_contacts
    where domain is not null
      and not public.is_generic_email_domain(domain)
  ),
  message_stats as (
    select
      business.domain,
      count(message.id) as message_count,
      max(message.sent_at) as last_message_at
    from business_domains business
    join public.communication_messages message
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
  ) into v_candidates
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

revoke execute on function public.detect_person_candidates(uuid, integer) from public, anon;
revoke execute on function public.detect_account_candidates(uuid) from public, anon;
grant execute on function public.detect_person_candidates(uuid, integer) to authenticated;
grant execute on function public.detect_account_candidates(uuid) to authenticated;

comment on function private.contact_has_reciprocal_email(uuid, uuid, uuid) is
  'Vrai uniquement si le contact possède au moins un email entrant et un email sortant pour le même utilisateur connecté.';

notify pgrst, 'reload schema';
