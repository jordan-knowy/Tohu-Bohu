-- Phase 6: minimal operational ledger for the canonical V6 pipeline.
-- It stores counts, versions and failures, never message content or evidence.

create table scoring.pipeline_run (
  id uuid primary key default gen_random_uuid(),
  worker text not null check (worker in ('score-batch-account-v6')),
  trace_id uuid not null,
  status text not null check (status in ('running', 'succeeded', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  counts jsonb not null default '{}'::jsonb,
  versions jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  constraint pipeline_run_finished_state check (
    (status = 'running' and finished_at is null)
    or (status <> 'running' and finished_at is not null)
  )
);

create index pipeline_run_worker_started_idx
  on scoring.pipeline_run (worker, started_at desc);
create index pipeline_run_failed_started_idx
  on scoring.pipeline_run (started_at desc)
  where status in ('partial', 'failed');

alter table scoring.pipeline_run enable row level security;
revoke all on scoring.pipeline_run from public, anon, authenticated;
grant select, insert, update on scoring.pipeline_run to service_role;

create function public.v6_pipeline_run_start(
  p_worker text,
  p_trace_id uuid,
  p_versions jsonb default '{}'::jsonb
) returns uuid
language plpgsql volatile security definer
set search_path = pg_catalog, public, scoring
as $$
declare v_id uuid;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  insert into scoring.pipeline_run(worker, trace_id, status, versions)
  values (p_worker, p_trace_id, 'running', coalesce(p_versions, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

create function public.v6_pipeline_run_finish(
  p_run_id uuid,
  p_status text,
  p_duration_ms integer,
  p_counts jsonb default '{}'::jsonb,
  p_error_code text default null,
  p_error_message text default null
) returns void
language plpgsql volatile security definer
set search_path = pg_catalog, public, scoring
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_status not in ('succeeded', 'partial', 'failed') then
    raise exception 'INVALID_PIPELINE_STATUS';
  end if;
  update scoring.pipeline_run set
    status = p_status,
    finished_at = now(),
    duration_ms = greatest(0, p_duration_ms),
    counts = coalesce(p_counts, '{}'::jsonb),
    error_code = left(p_error_code, 120),
    error_message = left(p_error_message, 1000)
  where id = p_run_id and status = 'running';
  if not found then raise exception 'PIPELINE_RUN_NOT_RUNNING'; end if;
end $$;

create function public.v6_pipeline_health(p_hours integer default 24)
returns jsonb
language sql stable security definer
set search_path = pg_catalog, public, scoring
as $$
  select case when (select auth.role()) = 'service_role' then jsonb_build_object(
    'window_hours', greatest(1, least(coalesce(p_hours, 24), 720)),
    'runs', count(*),
    'succeeded', count(*) filter (where status = 'succeeded'),
    'partial', count(*) filter (where status = 'partial'),
    'failed', count(*) filter (where status = 'failed'),
    'running', count(*) filter (where status = 'running'),
    'last_started_at', max(started_at),
    'last_success_at', max(finished_at) filter (where status = 'succeeded'),
    'p95_duration_ms', percentile_disc(0.95) within group (order by duration_ms)
      filter (where duration_ms is not null)
  ) else null end
  from scoring.pipeline_run
  where started_at >= now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 720)))
$$;

revoke all on function public.v6_pipeline_run_start(text, uuid, jsonb),
  public.v6_pipeline_run_finish(uuid, text, integer, jsonb, text, text),
  public.v6_pipeline_health(integer)
  from public, anon, authenticated;
grant execute on function public.v6_pipeline_run_start(text, uuid, jsonb),
  public.v6_pipeline_run_finish(uuid, text, integer, jsonb, text, text),
  public.v6_pipeline_health(integer)
  to service_role;

notify pgrst, 'reload schema';
