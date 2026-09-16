-- Réconciliation : une donnée dérivée ne survit jamais à sa preuve (rétractation
-- non destructive : status='obsolete' / deprecated_at, audit conservé). Service role only.
create or replace function public.reconcile_account_facts(p_organization_id uuid, p_company_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_obsolete int;
begin
  with impacted as (
    select f.id from public.account_facts f
    where f.organization_id = p_organization_id and (p_company_id is null or f.company_id = p_company_id)
      and f.status <> 'obsolete' and f.producer in ('promote_moments','promote_commitments')
      and ((f.source_ref ? 'person_key_moment_id' and not exists (select 1 from public.person_key_moments k where k.id = (f.source_ref->>'person_key_moment_id')::uuid))
        or (f.source_ref ? 'person_memory_entry_id' and not exists (select 1 from public.person_memory_entries e where e.id = (f.source_ref->>'person_memory_entry_id')::uuid)))
  ), upd as (update public.account_facts f set status='obsolete', obsolete_at=now(), updated_at=now() from impacted i where f.id=i.id returning f.id)
  select count(*) into v_obsolete from upd;
  return jsonb_build_object('facts_obsoleted', v_obsolete);
end $$;
create or replace function public.reconcile_marker_events(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path = public, scoring, private, pg_temp as $$
declare v int;
begin
  with impacted as (
    select m.id from scoring.marker_event m
    where m.organization_id = p_organization_id and m.deprecated_at is null
      and m.source = 'detector:communication_messages' and m.marker_id = 'S04'
      and not exists (select 1 from public.communication_messages cm where cm.id = m.evidence_ref::uuid)
  ), upd as (update scoring.marker_event m set deprecated_at = now() from impacted i where m.id=i.id returning m.id)
  select count(*) into v from upd;
  return jsonb_build_object('markers_deprecated', v);
end $$;
revoke all on function public.reconcile_account_facts(uuid, uuid) from public;
revoke all on function public.reconcile_marker_events(uuid) from public;
grant execute on function public.reconcile_account_facts(uuid, uuid) to service_role;
grant execute on function public.reconcile_marker_events(uuid) to service_role;
notify pgrst, 'reload schema';
