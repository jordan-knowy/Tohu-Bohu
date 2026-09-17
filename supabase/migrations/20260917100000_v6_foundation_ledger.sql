-- Phase 1 additive SHADOW ledger. Does not redefine any of the seven unknown RPCs.
-- No legacy backfill: ownership, original ingestion and evidence identity cannot be guessed.
create table scoring.foundation_dyad (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  collaborator_user_id uuid not null references auth.users(id),
  contact_id uuid not null references public.contacts(id),
  unique(organization_id, collaborator_user_id, contact_id)
);
create table scoring.foundation_revision (
  dyad_id uuid not null references scoring.foundation_dyad(id),
  kind text not null check(kind in ('event','marker','quality','role','commitment')),
  revision_id text not null,
  recorded_at timestamptz not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key(dyad_id,kind,revision_id,recorded_at),
  check(jsonb_typeof(payload)='object')
);
create table scoring.foundation_snapshot (
  id uuid primary key default gen_random_uuid(),
  dyad_id uuid not null references scoring.foundation_dyad(id),
  observed_at timestamptz not null,
  computed_at timestamptz not null,
  scoring_version text not null,
  params_version text not null,
  registry_version text not null,
  payload jsonb not null,
  unique(dyad_id,observed_at,computed_at,scoring_version,params_version,registry_version)
);
create table scoring.foundation_classifier_run (
  id uuid primary key default gen_random_uuid(),
  dyad_id uuid not null references scoring.foundation_dyad(id),
  source_event_id text not null,
  recorded_at timestamptz not null default now(),
  result_status text not null check(result_status in ('accepted','candidate','no_marker','technical_error')),
  payload jsonb not null
);
alter table scoring.foundation_dyad enable row level security;
alter table scoring.foundation_revision enable row level security;
alter table scoring.foundation_snapshot enable row level security;
alter table scoring.foundation_classifier_run enable row level security;
revoke all on scoring.foundation_dyad,scoring.foundation_revision,scoring.foundation_snapshot,scoring.foundation_classifier_run from public,anon,authenticated;
grant all on scoring.foundation_dyad,scoring.foundation_revision,scoring.foundation_snapshot,scoring.foundation_classifier_run to service_role;

create function public.v6_foundation_append(p_dyad jsonb,p_kind text,p_payload jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog,public,scoring as $$
declare d uuid; existing jsonb; org uuid := (p_dyad->>'organizationId')::uuid; collaborator uuid := (p_dyad->>'collaboratorUserId')::uuid; contact uuid := (p_dyad->>'contactId')::uuid;
begin
  if not exists(select 1 from public.memberships m where m.organization_id=org and m.user_id=collaborator)
    or not exists(select 1 from public.contacts c where c.id=contact and c.organization_id=org and c.merged_into_contact_id is null)
    then raise exception 'INVALID_DYAD'; end if;
  if p_kind in ('event','marker') and (not (p_payload ? 'dyad') or p_payload->'dyad' <> p_dyad) then raise exception 'DYAD_MISMATCH'; end if;
  if nullif(p_payload->>'id','') is null or nullif(p_payload->>'recordedAt','') is null
    or nullif(p_payload->>'effectiveFrom','') is null then raise exception 'INVALID_REVISION'; end if;
  if p_kind='marker' and not exists(select 1 from scoring.marker_registry r where r.marker_id=p_payload->>'markerId' and r.registry_version=p_payload->>'registryVersion' and r.scope='person' and r.deprecated_at is null)
    then raise exception 'UNKNOWN_MARKER'; end if;
  insert into scoring.foundation_dyad(organization_id,collaborator_user_id,contact_id) values(org,collaborator,contact)
    on conflict(organization_id,collaborator_user_id,contact_id) do update set contact_id=excluded.contact_id returning id into d;
  select payload into existing from scoring.foundation_revision where dyad_id=d and kind=p_kind and revision_id=p_payload->>'id' order by recorded_at desc limit 1;
  if existing is not null and existing - 'recordedAt' = p_payload - 'recordedAt' then return d; end if;
  insert into scoring.foundation_revision(dyad_id,kind,revision_id,recorded_at,payload)
    values(d,p_kind,p_payload->>'id',(p_payload->>'recordedAt')::timestamptz,p_payload)
    on conflict do nothing;
  select payload into existing from scoring.foundation_revision where dyad_id=d and kind=p_kind and revision_id=p_payload->>'id' and recorded_at=(p_payload->>'recordedAt')::timestamptz;
  if existing <> p_payload then raise exception 'IMMUTABLE_REVISION_CONFLICT'; end if;
  return d;
end $$;
create function public.v6_foundation_list(p_after uuid default null,p_limit integer default 100) returns setof scoring.foundation_dyad
language sql stable security definer set search_path=pg_catalog,scoring as $$
  select * from scoring.foundation_dyad where p_after is null or id>p_after order by id limit greatest(1,least(p_limit,100));
$$;
create function public.v6_foundation_read(p_dyad_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,scoring as $$
  select jsonb_build_object('events',coalesce(jsonb_agg(payload order by recorded_at,revision_id) filter(where kind='event'),'[]'::jsonb),
    'markers',coalesce(jsonb_agg(payload order by recorded_at,revision_id) filter(where kind='marker'),'[]'::jsonb),
    'qualities',coalesce(jsonb_agg(payload order by recorded_at,revision_id) filter(where kind='quality'),'[]'::jsonb),
    'roles',coalesce(jsonb_agg(payload order by recorded_at,revision_id) filter(where kind='role'),'[]'::jsonb),
    'commitments',coalesce(jsonb_agg(payload order by recorded_at,revision_id) filter(where kind='commitment'),'[]'::jsonb))
  from scoring.foundation_revision where dyad_id=p_dyad_id;
$$;
create function public.v6_foundation_store(p_dyad_id uuid,p_kind text,p_payload jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,scoring as $$
begin
  if p_kind='snapshot' then
    if p_payload->>'scoringVersion' is distinct from 'v6-foundation-1' then raise exception 'INVALID_SCORING_VERSION'; end if;
    if not exists(select 1 from scoring.foundation_dyad d where d.id=p_dyad_id
      and d.organization_id::text=p_payload->'entity'->>'organizationId'
      and d.collaborator_user_id::text=p_payload->'entity'->>'collaboratorUserId'
      and d.contact_id::text=p_payload->'entity'->>'contactId') then raise exception 'SNAPSHOT_DYAD_MISMATCH'; end if;
    insert into scoring.foundation_snapshot(dyad_id,observed_at,computed_at,scoring_version,params_version,registry_version,payload)
      values(p_dyad_id,(p_payload->>'observedAt')::timestamptz,(p_payload->>'computedAt')::timestamptz,p_payload->>'scoringVersion',p_payload->>'paramsVersion',p_payload->>'registryVersion',p_payload) on conflict do nothing;
    if exists(select 1 from scoring.foundation_snapshot s
      where s.dyad_id=p_dyad_id and s.observed_at=(p_payload->>'observedAt')::timestamptz
        and s.computed_at=(p_payload->>'computedAt')::timestamptz
        and s.scoring_version=p_payload->>'scoringVersion'
        and s.params_version=p_payload->>'paramsVersion'
        and s.registry_version=p_payload->>'registryVersion'
        and s.payload is distinct from p_payload) then
      raise exception 'IMMUTABLE_SNAPSHOT_CONFLICT';
    end if;
  elsif p_kind='classifier_run' then
    insert into scoring.foundation_classifier_run(dyad_id,source_event_id,result_status,payload)
      values(p_dyad_id,p_payload->>'source_event_id',p_payload->>'result_status',p_payload);
  else raise exception 'INVALID_OUTPUT_KIND'; end if;
end $$;
revoke all on function public.v6_foundation_append(jsonb,text,jsonb),public.v6_foundation_list(uuid,integer),public.v6_foundation_read(uuid),public.v6_foundation_store(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.v6_foundation_append(jsonb,text,jsonb),public.v6_foundation_list(uuid,integer),public.v6_foundation_read(uuid),public.v6_foundation_store(uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';

-- Durable bounded-work progress. The next scheduled invocation resumes, rather
-- than classifying the same first records forever. No product authority flag.
create table scoring.foundation_checkpoint (
  worker text primary key check(worker in ('score','detect','classify')),
  cursor jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table scoring.foundation_checkpoint enable row level security;
revoke all on scoring.foundation_checkpoint from public,anon,authenticated;
grant all on scoring.foundation_checkpoint to service_role;
create function public.v6_foundation_checkpoint(p_worker text,p_cursor jsonb default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,scoring as $$
declare result jsonb;
begin
  if p_cursor is not null then
    insert into scoring.foundation_checkpoint(worker,cursor) values(p_worker,p_cursor)
    on conflict(worker) do update set cursor=excluded.cursor,updated_at=now();
  end if;
  select cursor into result from scoring.foundation_checkpoint where worker=p_worker;
  return coalesce(result,'{}'::jsonb);
end $$;
revoke all on function public.v6_foundation_checkpoint(text,jsonb) from public,anon,authenticated;
grant execute on function public.v6_foundation_checkpoint(text,jsonb) to service_role;

create function public.v6_foundation_find(p_after uuid default null,p_organization_id uuid default null,p_contact_id uuid default null,p_collaborator_id uuid default null)
returns setof scoring.foundation_dyad language sql stable security definer set search_path=pg_catalog,scoring as $$
  select * from scoring.foundation_dyad where (p_after is null or id>p_after)
    and (p_organization_id is null or organization_id=p_organization_id)
    and (p_contact_id is null or contact_id=p_contact_id)
    and (p_collaborator_id is null or collaborator_user_id=p_collaborator_id)
  order by id limit 25;
$$;
revoke all on function public.v6_foundation_find(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.v6_foundation_find(uuid,uuid,uuid,uuid) to service_role;

-- Atomic replacement: an interrupted detector never leaves half-retracted state.
create function public.v6_foundation_replace_detected(p_dyad jsonb,p_at timestamptz,p_markers jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,public,scoring as $$
declare d uuid; old record; item jsonb;
begin
  select id into d from scoring.foundation_dyad where organization_id=(p_dyad->>'organizationId')::uuid
    and collaborator_user_id=(p_dyad->>'collaboratorUserId')::uuid and contact_id=(p_dyad->>'contactId')::uuid for update;
  if d is null or jsonb_typeof(p_markers) is distinct from 'array' then raise exception 'INVALID_DETECTOR_BATCH'; end if;
  for old in select distinct on(revision_id) revision_id,payload from scoring.foundation_revision
    where dyad_id=d and kind='marker' order by revision_id,recorded_at desc
  loop
    if old.payload->>'detectorVersion'='normalized-detectors-v2' and old.payload->>'state'='active'
      and not exists(select 1 from jsonb_array_elements(p_markers) n where n->>'id'=old.revision_id) then
      perform public.v6_foundation_append(p_dyad,'marker',old.payload || jsonb_build_object('recordedAt',p_at,'state','superseded','supersededAt',p_at));
    end if;
  end loop;
  for item in select value from jsonb_array_elements(p_markers) loop
    if item->>'detectorVersion' is distinct from 'normalized-detectors-v2' then raise exception 'INVALID_DETECTOR_VERSION'; end if;
    perform public.v6_foundation_append(p_dyad,'marker',item);
  end loop;
end $$;
revoke all on function public.v6_foundation_replace_detected(jsonb,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.v6_foundation_replace_detected(jsonb,timestamptz,jsonb) to service_role;
