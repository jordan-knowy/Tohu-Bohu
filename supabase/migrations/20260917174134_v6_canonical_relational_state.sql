-- Phase 3: authoritative V6 account snapshots and canonical read contracts.
-- The foundation dyad ledger remains the only person scoring authority.

create table scoring.account_snapshot (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  account_id uuid not null references public.companies(id),
  observed_at timestamptz not null,
  computed_at timestamptz not null,
  scoring_version text not null,
  params_version text not null,
  registry_version text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  unique (organization_id, account_id, observed_at, computed_at, scoring_version, params_version, registry_version)
);

create index account_snapshot_latest_idx
  on scoring.account_snapshot (organization_id, account_id, observed_at desc, computed_at desc);

alter table scoring.account_snapshot enable row level security;
revoke all on scoring.account_snapshot from public, anon, authenticated;
grant all on scoring.account_snapshot to service_role;

-- Canonical readers run with caller privileges. Direct SELECT remains tenant
-- scoped by RLS if the scoring schema is ever added to the Data API.
grant select on scoring.foundation_dyad, scoring.foundation_revision,
  scoring.foundation_snapshot, scoring.account_snapshot to authenticated;
create policy foundation_dyad_read_contact on scoring.foundation_dyad
  for select to authenticated
  using (private.can_view_contact(organization_id, contact_id));
create policy foundation_revision_read_contact on scoring.foundation_revision
  for select to authenticated
  using (exists (
    select 1 from scoring.foundation_dyad d
    where d.id = foundation_revision.dyad_id
      and private.can_view_contact(d.organization_id, d.contact_id)
  ));
create policy foundation_snapshot_read_contact on scoring.foundation_snapshot
  for select to authenticated
  using (exists (
    select 1 from scoring.foundation_dyad d
    where d.id = foundation_snapshot.dyad_id
      and private.can_view_contact(d.organization_id, d.contact_id)
  ));
create policy account_snapshot_read_company on scoring.account_snapshot
  for select to authenticated
  using (private.can_view_company(organization_id, account_id));

create function public.v6_account_foundation_states(p_organization_id uuid, p_company_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, scoring
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'FORBIDDEN'; end if;
  if not exists (
    select 1 from public.companies c
    where c.id = p_company_id and c.organization_id = p_organization_id
  ) then raise exception 'INVALID_ACCOUNT'; end if;
  return coalesce((
    select jsonb_agg(s.payload order by d.collaborator_user_id, d.contact_id)
    from scoring.foundation_dyad d
    join public.contacts c on c.id = d.contact_id and c.company_id = p_company_id
    join lateral (
      select fs.payload
      from scoring.foundation_snapshot fs
      where fs.dyad_id = d.id
      order by fs.observed_at desc, fs.computed_at desc, fs.id desc
      limit 1
    ) s on true
    where d.organization_id = p_organization_id
  ), '[]'::jsonb);
end $$;

create function public.v6_account_history(p_organization_id uuid, p_company_id uuid, p_limit integer default 24)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, scoring
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'FORBIDDEN'; end if;
  return coalesce((
    select jsonb_agg(x.payload order by x.observed_at)
    from (
      select s.payload, s.observed_at
      from scoring.account_snapshot s
      where s.organization_id = p_organization_id and s.account_id = p_company_id
      order by s.observed_at desc, s.computed_at desc
      limit greatest(1, least(coalesce(p_limit, 24), 120))
    ) x
  ), '[]'::jsonb);
end $$;

create function public.v6_account_store(p_payload jsonb)
returns void
language plpgsql security definer
set search_path = pg_catalog, public, scoring
as $$
declare
  v_org uuid := (p_payload->'entity'->>'organizationId')::uuid;
  v_account uuid := (p_payload->'entity'->>'accountId')::uuid;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_payload->>'scoringVersion' is distinct from 'v6-account-1'
    or p_payload->>'scope' is distinct from 'account'
    or not exists (
      select 1 from public.companies c where c.id = v_account and c.organization_id = v_org
    ) then raise exception 'INVALID_ACCOUNT_SNAPSHOT'; end if;
  insert into scoring.account_snapshot(
    organization_id, account_id, observed_at, computed_at,
    scoring_version, params_version, registry_version, payload
  ) values (
    v_org, v_account, (p_payload->>'observedAt')::timestamptz,
    (p_payload->>'computedAt')::timestamptz, p_payload->>'scoringVersion',
    p_payload->>'paramsVersion', p_payload->>'registryVersion', p_payload
  ) on conflict do nothing;
  if exists (
    select 1 from scoring.account_snapshot s
    where s.organization_id = v_org and s.account_id = v_account
      and s.observed_at = (p_payload->>'observedAt')::timestamptz
      and s.computed_at = (p_payload->>'computedAt')::timestamptz
      and s.scoring_version = p_payload->>'scoringVersion'
      and s.params_version = p_payload->>'paramsVersion'
      and s.registry_version = p_payload->>'registryVersion'
      and s.payload is distinct from p_payload
  ) then raise exception 'IMMUTABLE_ACCOUNT_SNAPSHOT_CONFLICT'; end if;
end $$;

revoke all on function public.v6_account_foundation_states(uuid, uuid),
  public.v6_account_history(uuid, uuid, integer), public.v6_account_store(jsonb)
  from public, anon, authenticated;
grant execute on function public.v6_account_foundation_states(uuid, uuid),
  public.v6_account_history(uuid, uuid, integer), public.v6_account_store(jsonb)
  to service_role;

create or replace function public.person_brain(
  p_organization_id uuid,
  p_contact_id uuid,
  p_user_id uuid default auth.uid()
) returns jsonb
language plpgsql stable security invoker
set search_path = pg_catalog, public, scoring, private
as $$
declare
  v_personal jsonb;
  v_team jsonb;
  v_account jsonb;
  v_company_id uuid;
begin
  if not exists (
      select 1 from public.contacts c where c.id = p_contact_id
        and c.organization_id = p_organization_id and c.merged_into_contact_id is null
    ) or ((select auth.role()) is distinct from 'service_role' and (
      (select auth.uid()) is null or p_user_id is distinct from (select auth.uid())
      or not private.is_org_member(p_organization_id)
      or not private.can_view_contact(p_organization_id, p_contact_id)
    )) then raise exception 'CONTACT_FORBIDDEN'; end if;

  select c.company_id into v_company_id from public.contacts c where c.id = p_contact_id;
  select s.payload into v_personal
  from scoring.foundation_dyad d
  join scoring.foundation_snapshot s on s.dyad_id = d.id
  where d.organization_id = p_organization_id and d.contact_id = p_contact_id
    and d.collaborator_user_id = p_user_id
  order by s.observed_at desc, s.computed_at desc, s.id desc limit 1;

  select coalesce(jsonb_agg(x.payload order by x.collaborator_user_id), '[]'::jsonb) into v_team
  from (
    select distinct on (d.collaborator_user_id) d.collaborator_user_id, s.payload
    from scoring.foundation_dyad d
    join scoring.foundation_snapshot s on s.dyad_id = d.id
    where d.organization_id = p_organization_id and d.contact_id = p_contact_id
    order by d.collaborator_user_id, s.observed_at desc, s.computed_at desc, s.id desc
  ) x;

  if v_company_id is not null then
    select s.payload into v_account from scoring.account_snapshot s
    where s.organization_id = p_organization_id and s.account_id = v_company_id
    order by s.observed_at desc, s.computed_at desc, s.id desc limit 1;
  end if;

  return jsonb_build_object(
    'contract_version', 'person-brain-v6.1',
    'generated_at', now(),
    'entity', jsonb_build_object('organization_id', p_organization_id, 'contact_id', p_contact_id, 'account_id', v_company_id),
    'state', coalesce(v_personal, jsonb_build_object('status', 'insufficient_evidence', 'score', null)),
    'score', v_personal->'score',
    'dimensions', coalesce(v_personal->'axes', '{}'::jsonb),
    'reliability', v_personal->'reliability',
    'coverage', coalesce(v_personal->'coverage', jsonb_build_object('value', null)),
    'evidence', coalesce(v_personal->'evidence', '[]'::jsonb),
    'facts', '[]'::jsonb,
    'commitments', coalesce((
      select jsonb_agg(x.payload order by x.recorded_at desc)
      from (
        select distinct on (r.revision_id) r.payload, r.recorded_at
        from scoring.foundation_dyad d join scoring.foundation_revision r on r.dyad_id = d.id
        where d.organization_id = p_organization_id and d.contact_id = p_contact_id
          and d.collaborator_user_id = p_user_id and r.kind = 'commitment'
        order by r.revision_id, r.recorded_at desc
      ) x
    ), '[]'::jsonb),
    'roles', jsonb_build_object('declared', v_personal->'declaredRole', 'inferred', v_personal->'inferredRole', 'authority', v_personal->'authority'),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('at', s.observed_at, 'score', s.payload->'score') order by s.observed_at)
      from scoring.foundation_dyad d join scoring.foundation_snapshot s on s.dyad_id = d.id
      where d.organization_id = p_organization_id and d.contact_id = p_contact_id
        and d.collaborator_user_id = p_user_id
        and (v_personal is null or (s.scoring_version = v_personal->>'scoringVersion'
          and s.params_version = v_personal->>'paramsVersion' and s.registry_version = v_personal->>'registryVersion'))
    ), '[]'::jsonb),
    'changes', jsonb_build_object('delta', v_personal->'delta'),
    'causes', coalesce(v_personal->'causes', '[]'::jsonb),
    'recommendations', '[]'::jsonb,
    'team_contact', jsonb_build_object('aggregation', 'independent_dyads', 'score', null, 'dyads', v_team),
    'account', coalesce(v_account, jsonb_build_object('status', 'insufficient_evidence', 'score', null)),
    'availability', jsonb_build_object(
      'personal', case when v_personal is null then 'insufficient_evidence' else coalesce(v_personal->>'status', 'insufficient_evidence') end,
      'team_contact', case when jsonb_array_length(v_team) = 0 then 'insufficient_evidence' else 'available' end,
      'account', case when v_account is null then 'insufficient_evidence' else coalesce(v_account->>'status', 'insufficient_evidence') end,
      'recommendations', 'deferred_human_calibration'
    )
  );
end $$;

create or replace function public.account_brain(
  p_organization_id uuid,
  p_company_id uuid,
  p_user_id uuid default auth.uid()
) returns jsonb
language plpgsql stable security invoker
set search_path = pg_catalog, public, scoring, private
as $$
declare
  v_snapshot jsonb;
  v_name text;
  v_relation text;
begin
  if not exists (
      select 1 from public.companies c where c.id = p_company_id and c.organization_id = p_organization_id
    ) or ((select auth.role()) is distinct from 'service_role' and (
      (select auth.uid()) is null or p_user_id is distinct from (select auth.uid())
      or not private.is_org_member(p_organization_id)
      or not private.can_view_company(p_organization_id, p_company_id)
    )) then raise exception 'ACCOUNT_FORBIDDEN'; end if;

  select c.name, coalesce(s.relationship_status, c.account_type::text)
  into v_name, v_relation
  from public.companies c left join public.account_settings s
    on s.company_id = c.id and s.organization_id = c.organization_id
  where c.id = p_company_id and c.organization_id = p_organization_id;

  select s.payload into v_snapshot from scoring.account_snapshot s
  where s.organization_id = p_organization_id and s.account_id = p_company_id
  order by s.observed_at desc, s.computed_at desc, s.id desc limit 1;

  return jsonb_build_object(
    'contract_version', 'account-brain-v6.1',
    'generated_at', now(),
    'account', jsonb_build_object('id', p_company_id, 'name', v_name, 'relation_type', v_relation),
    'state', coalesce(v_snapshot, jsonb_build_object('status', 'insufficient_evidence', 'score', null)),
    'weather', coalesce(v_snapshot, jsonb_build_object('status', 'insufficient_evidence', 'score', null)),
    'score', v_snapshot->'score',
    'dimensions', coalesce(v_snapshot->'dials', '{}'::jsonb),
    'reliability', v_snapshot->'reliability',
    'coverage', coalesce(v_snapshot->'coverage', jsonb_build_object('targetCount', 0, 'coveredCount', 0)),
    'evidence', coalesce(v_snapshot->'evidence', '[]'::jsonb),
    'facts', '[]'::jsonb,
    'commitments', '[]'::jsonb,
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'contact_id', r.contact_id, 'organizational_role', r.organizational_role,
        'decision_role', r.decision_role, 'relationship_role', r.relationship_role,
        'internal_owner_user_id', r.internal_owner_user_id, 'source_type', r.source_type,
        'inference_level', r.inference_level, 'confidence', r.confidence,
        'observed_at', r.observed_at, 'last_verified_at', r.last_verified_at
      ) order by r.contact_id)
      from public.account_contact_roles r
      where r.organization_id = p_organization_id and r.company_id = p_company_id and r.active
    ), '[]'::jsonb),
    'history', coalesce(v_snapshot->'history', '[]'::jsonb),
    'changes', jsonb_build_object('delta', v_snapshot->'delta'),
    'causes', coalesce(v_snapshot->'causes', '[]'::jsonb),
    'recommendations', '[]'::jsonb,
    'availability', jsonb_build_object(
      'weather', case when v_snapshot is null then 'insufficient_evidence' else coalesce(v_snapshot->>'status', 'insufficient_evidence') end,
      'facts', 'not_in_canonical_ledger', 'commitments', 'not_in_canonical_ledger',
      'recommendations', 'deferred_human_calibration'
    )
  );
end $$;

revoke all on function public.person_brain(uuid, uuid, uuid), public.account_brain(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.person_brain(uuid, uuid, uuid), public.account_brain(uuid, uuid, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
