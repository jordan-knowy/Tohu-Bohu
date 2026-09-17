-- Phase 5: remove the superseded relational engines after every live reader
-- has moved to foundation_snapshot/account_snapshot and the canonical brains.
-- Source communications, meetings, transcripts, contacts, manual memory and
-- provenance are deliberately outside this migration.

do $$ declare job record; begin
  if to_regnamespace('cron') is not null then
    for job in select jobid from cron.job
      where jobname in ('knowr-score', 'tohu-bohu-score')
         or command ilike '%/score-batch%'
         or command ilike '%dispatch_scheduled_edge(''score-batch''%'
    loop perform cron.unschedule(job.jobid); end loop;
  end if;
end $$;

drop function if exists public.upsert_account_weather_snapshot(uuid,uuid,timestamptz,date,text,text,jsonb,numeric,text,numeric);
drop function if exists public.upsert_person_marker_events(uuid,jsonb);
drop function if exists public.account_health_monthly(uuid,integer);
drop function if exists public.get_account_prev_weather_score(uuid,date,text,text);
drop function if exists public.upsert_dyad_weather_snapshot(uuid,uuid,uuid,timestamptz,date,text,text,jsonb,numeric,numeric,boolean,text);
drop function if exists public.get_dyad_weather_snapshot(uuid);
drop function if exists public.get_account_dyad_snapshots(uuid);
drop function if exists public.get_person_marker_events(uuid);
drop function if exists public.get_account_k_marker_events(uuid);
drop function if exists public.reconcile_marker_events(uuid);

drop table if exists public.account_recommendation_user_state cascade;
drop table if exists public.account_recommendations cascade;
drop table if exists public.person_recommendations cascade;
drop table if exists public.account_strategic_readings cascade;
drop table if exists public.account_relationship_score_snapshots_dedup_backup_20260910 cascade;
drop table if exists public.account_relationship_score_snapshots cascade;
drop table if exists public.person_relationship_score_snapshots cascade;
drop table if exists public.contact_score_history cascade;
drop table if exists public.relationship_snapshots cascade;

drop table if exists scoring.marker_event cascade;
drop table if exists scoring.score_snapshot cascade;

alter table public.cognitive_profiles
  drop column if exists engagement_score,
  drop column if exists score_phase,
  drop column if exists score_intensite,
  drop column if exists score_reciprocite,
  drop column if exists score_longevite,
  drop column if exists score_delta,
  drop column if exists score_engagement,
  drop column if exists score_confiance,
  drop column if exists score_satisfaction,
  drop column if exists score_ancrage,
  drop column if exists trust_score,
  drop column if exists trust_reasoning,
  drop column if exists trust_analyzed_at,
  drop column if exists trust_evidence,
  drop column if exists satisfaction_score,
  drop column if exists satisfaction_reasoning,
  drop column if exists satisfaction_analyzed_at,
  drop column if exists satisfaction_evidence,
  drop column if exists account_relation_hint,
  drop column if exists account_relation_hint_confidence,
  drop column if exists account_relation_hint_reasoning,
  drop column if exists account_relation_hint_analyzed_at;

-- Derived score caches embedded in account context are not source records.
update public.companies
set public_context = public_context
  - 'relationship_score' - 'confidence_score' - 'last_interaction_at'
where public_context ?| array['relationship_score','confidence_score','last_interaction_at'];

notify pgrst, 'reload schema';
