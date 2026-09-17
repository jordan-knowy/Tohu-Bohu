-- Recover the seven observed remote contracts (audit captured 2026-09-16).
-- Compatibility contracts only: foundation scoring uses its own dyadic ledger.
-- Preserve observed SQL behavior; run with caller privileges and explicit ACLs.
-- No scores or source records are rewritten by this migration.

CREATE OR REPLACE FUNCTION public.upsert_account_weather_snapshot(p_organization_id uuid, p_company_id uuid, p_at timestamp with time zone, p_snapshot_month date, p_params_version text, p_registry_version text, p_dials jsonb, p_score numeric, p_weakest_dial text, p_delta_30d numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'scoring', 'pg_temp'
AS $function$
begin
  insert into scoring.score_snapshot(
    organization_id, entity_type, entity_id, account_id, at, snapshot_month,
    params_version, registry_version, axes_or_dials, score, reliability, verdict_allowed,
    weakest_dial, delta_30d
  ) values (
    p_organization_id, 'account', p_company_id, p_company_id, p_at, p_snapshot_month,
    p_params_version, p_registry_version, p_dials, p_score, null, false,
    p_weakest_dial, p_delta_30d
  )
  on conflict (entity_type, entity_id, snapshot_month, params_version, registry_version)
  do update set at = excluded.at, axes_or_dials = excluded.axes_or_dials, score = excluded.score,
    weakest_dial = excluded.weakest_dial, delta_30d = excluded.delta_30d;
end $function$;
REVOKE ALL ON FUNCTION public.upsert_account_weather_snapshot(p_organization_id uuid, p_company_id uuid, p_at timestamp with time zone, p_snapshot_month date, p_params_version text, p_registry_version text, p_dials jsonb, p_score numeric, p_weakest_dial text, p_delta_30d numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_account_weather_snapshot(p_organization_id uuid, p_company_id uuid, p_at timestamp with time zone, p_snapshot_month date, p_params_version text, p_registry_version text, p_dials jsonb, p_score numeric, p_weakest_dial text, p_delta_30d numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_person_marker_events(p_organization_id uuid, p_events jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'scoring', 'pg_temp'
AS $function$
declare
  v_count int := 0;
begin
  insert into scoring.marker_event(
    organization_id, registry_version, marker_id, scope, contact_id, account_id,
    observed_at, sense, measure, source, evidence_ref, evidence_text, detector_version,
    is_candidate, is_verbatim, dedup_key
  )
  select
    p_organization_id, 'reg-v6.0', e->>'marker_id', 'person',
    (e->>'contact_id')::uuid, (e->>'account_id')::uuid,
    (e->>'observed_at')::timestamptz, (e->>'sense')::int,
    coalesce(e->'measure', '{}'::jsonb), e->>'source', e->>'evidence_ref', e->>'evidence_text',
    e->>'detector_version', coalesce((e->>'is_candidate')::boolean, false),
    coalesce((e->>'is_verbatim')::boolean, false), e->>'dedup_key'
  from jsonb_array_elements(p_events) as e
  on conflict (organization_id, dedup_key) where dedup_key is not null do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $function$;
REVOKE ALL ON FUNCTION public.upsert_person_marker_events(p_organization_id uuid, p_events jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_person_marker_events(p_organization_id uuid, p_events jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.account_health_monthly(p_company_id uuid, p_months integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with nowu as (select (now() at time zone 'utc') as t),
total as (
  select count(*)::numeric n from contacts
  where company_id = p_company_id and is_tracked and merged_into_contact_id is null
),
months as (
  select gs as idx,
    date_trunc('month',(select t from nowu)) - (gs||' month')::interval as m_start,
    least(date_trunc('month',(select t from nowu)) - (gs||' month')::interval + interval '1 month' - interval '1 second',
          (select t from nowu)) as cutoff
  from generate_series(greatest(p_months,1)-1, 0, -1) gs
),
ct as (
  select id from contacts
  where company_id = p_company_id and is_tracked and merged_into_contact_id is null
),
per as (
  select m.idx, m.m_start, m.cutoff, c.id as contact_id,
    (select h.score from contact_score_history h
       where h.contact_id = c.id and h.snapshot_date <= m.cutoff::date
       order by h.snapshot_date desc limit 1) as score,
    (select count(*) from communication_messages cm
       where cm.contact_id = c.id and cm.sent_at <= m.cutoff) as emails,
    (select max(cm.sent_at) from communication_messages cm
       where cm.contact_id = c.id and cm.sent_at <= m.cutoff) as last_email
  from months m cross join ct c
),
mt as (
  select m.idx, max(mt.starts_at) filter (where mt.starts_at <= m.cutoff) as last_meet
  from months m left join meetings mt on mt.company_id = p_company_id
  group by m.idx
),
agg as (
  select p.idx, p.m_start, p.cutoff,
    count(*) filter (where p.score is not null) as engaged,
    sum(p.score*(1+p.emails)) filter (where p.score is not null) as wsum,
    sum(1+p.emails) filter (where p.score is not null) as wden,
    max(p.last_email) as last_email
  from per p group by p.idx, p.m_start, p.cutoff
)
select coalesce(jsonb_agg(jsonb_build_object(
    'ym', to_char(a.m_start,'YYYY-MM'),
    'engaged', a.engaged,
    'score', case
      when a.engaged = 0 or (select n from total) = 0 then null
      else round( least(1, greatest(0,
            (a.wsum/nullif(a.wden,0)/100)*0.55
          + (a.engaged::numeric/(select n from total))*0.25
          + coalesce(exp(-(ln(2)/90.0) * (extract(epoch from (a.cutoff - greatest(a.last_email, mt.last_meet)))/86400.0)), 0)*0.20
        )) * 100 )::int
    end
  ) order by a.m_start), '[]'::jsonb)
from agg a left join mt on mt.idx = a.idx;
$function$;
REVOKE ALL ON FUNCTION public.account_health_monthly(p_company_id uuid, p_months integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_health_monthly(p_company_id uuid, p_months integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_account_prev_weather_score(p_company_id uuid, p_snapshot_month date, p_params_version text, p_registry_version text)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public', 'scoring', 'pg_temp'
AS $function$
  select score from scoring.score_snapshot
  where entity_type = 'account' and entity_id = p_company_id and snapshot_month = p_snapshot_month
    and params_version = p_params_version and registry_version = p_registry_version
  limit 1
$function$;
REVOKE ALL ON FUNCTION public.get_account_prev_weather_score(p_company_id uuid, p_snapshot_month date, p_params_version text, p_registry_version text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_prev_weather_score(p_company_id uuid, p_snapshot_month date, p_params_version text, p_registry_version text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.upsert_dyad_weather_snapshot(p_organization_id uuid, p_contact_id uuid, p_account_id uuid, p_at timestamp with time zone, p_snapshot_month date, p_params_version text, p_registry_version text, p_axes jsonb, p_score numeric, p_reliability numeric, p_verdict_allowed boolean, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'scoring', 'pg_temp'
AS $function$
begin
  insert into scoring.score_snapshot(
    organization_id, entity_type, entity_id, account_id, contact_id, at, snapshot_month,
    params_version, registry_version, axes_or_dials, score, reliability, verdict_allowed, status
  ) values (
    p_organization_id, 'dyad', p_contact_id, p_account_id, p_contact_id, p_at, p_snapshot_month,
    p_params_version, p_registry_version, coalesce(p_axes, '{}'::jsonb), p_score, p_reliability, p_verdict_allowed, p_status
  )
  on conflict (entity_type, entity_id, snapshot_month, params_version, registry_version)
  do update set at = excluded.at, axes_or_dials = excluded.axes_or_dials, score = excluded.score,
    reliability = excluded.reliability, verdict_allowed = excluded.verdict_allowed, status = excluded.status;
end $function$;
REVOKE ALL ON FUNCTION public.upsert_dyad_weather_snapshot(p_organization_id uuid, p_contact_id uuid, p_account_id uuid, p_at timestamp with time zone, p_snapshot_month date, p_params_version text, p_registry_version text, p_axes jsonb, p_score numeric, p_reliability numeric, p_verdict_allowed boolean, p_status text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_dyad_weather_snapshot(p_organization_id uuid, p_contact_id uuid, p_account_id uuid, p_at timestamp with time zone, p_snapshot_month date, p_params_version text, p_registry_version text, p_axes jsonb, p_score numeric, p_reliability numeric, p_verdict_allowed boolean, p_status text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_dyad_weather_snapshot(p_contact_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public', 'scoring', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'score', score, 'reliability', reliability, 'verdict_allowed', verdict_allowed,
    'status', status, 'axes', axes_or_dials, 'at', at
  )
  from scoring.score_snapshot
  where entity_type = 'dyad' and entity_id = p_contact_id
  order by at desc limit 1
$function$;
REVOKE ALL ON FUNCTION public.get_dyad_weather_snapshot(p_contact_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_dyad_weather_snapshot(p_contact_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_account_dyad_snapshots(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public', 'scoring', 'pg_temp'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
      'contact_id', contact_id, 'score', score, 'reliability', reliability,
      'verdict_allowed', verdict_allowed, 'status', status
    )), '[]'::jsonb)
  from (
    select distinct on (contact_id) contact_id, score, reliability, verdict_allowed, status
    from scoring.score_snapshot
    where entity_type = 'dyad' and account_id = p_company_id
    order by contact_id, at desc
  ) latest
$function$;
REVOKE ALL ON FUNCTION public.get_account_dyad_snapshots(p_company_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_dyad_snapshots(p_company_id uuid) TO authenticated, service_role;
