-- Généralisation M2 : promotion déterministe (aucune inférence/LLM) des moments/engagements
-- en account_facts, à l'échelle org. Idempotent (dedup_key). Miroir de promote-facts.ts. Service role.
-- (Voir le corps déployé via MCP le 2026-09-15 ; version finale ci-dessous.)
create or replace function public.promote_account_facts(p_org uuid, p_company uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_m int; v_c int; v_me int; v_ce int;
begin
  insert into public.account_facts (organization_id, company_id, fact_type, title, detail, impact, status, occurred_at, first_seen_at, last_seen_at, subject_contact_id, confidence, inference_level, dedup_key, producer, source_ref)
  select ct.organization_id, ct.company_id, case when k.impact='milestone' then 'milestone' else 'event' end, k.title, k.summary,
    case when k.impact in ('friction','reinforce','milestone') then k.impact else 'neutral' end, 'active', k.occurred_at, k.created_at, k.updated_at, k.contact_id, k.confidence, 'strong_inference',
    'moment:'||k.id, 'promote_moments', jsonb_build_object('person_key_moment_id', k.id, 'contact_id', k.contact_id)
  from public.person_key_moments k join public.contacts ct on ct.id=k.contact_id
  where ct.organization_id=p_org and ct.company_id is not null and (p_company is null or ct.company_id=p_company) and k.title is not null and k.occurred_at is not null
  on conflict (organization_id, company_id, dedup_key) do nothing;
  get diagnostics v_m = row_count;
  insert into public.account_fact_evidence (fact_id, organization_id, company_id, source_type, source_id, source_label, occurred_at, excerpt, contact_id, confidence)
  select f.id, f.organization_id, f.company_id, 'email', 'moment:'||k.id, k.source_label, k.occurred_at, k.summary, k.contact_id, k.confidence
  from public.person_key_moments k join public.contacts ct on ct.id=k.contact_id
  join public.account_facts f on f.dedup_key='moment:'||k.id and f.organization_id=ct.organization_id and f.company_id=ct.company_id
  where ct.organization_id=p_org and (p_company is null or ct.company_id=p_company)
  on conflict (fact_id, source_type, source_id) do nothing;
  get diagnostics v_me = row_count;
  with c as (select e.*, ct.organization_id as org, ct.company_id as cid, (regexp_match(e.content, '[ée]ch[ée]ance\s*:?\s*([^\s].*)$'))[1] as due_text
    from public.person_memory_entries e join public.contacts ct on ct.id=e.contact_id
    where ct.organization_id=p_org and ct.company_id is not null and e.entry_type='commitment' and (p_company is null or ct.company_id=p_company) and btrim(coalesce(e.content,''))<>'')
  insert into public.account_facts (organization_id, company_id, fact_type, title, status, occurred_at, first_seen_at, last_seen_at, resolved_at, subject_contact_id, confidence, inference_level, dedup_key, producer, source_ref, due_text_original, due_at, due_window_start, due_window_end, due_at_precision, due_is_inferred, due_confidence)
  select c.org, c.cid, 'commitment', btrim(regexp_replace(c.content, '\s*[—-]\s*[ée]ch[ée]ance.*$', '')),
    case when c.resolved_at is not null then 'resolved' else 'active' end, coalesce(c.source_occurred_at, c.observed_at), c.created_at, c.updated_at, c.resolved_at, c.contact_id, c.confidence,
    coalesce(c.inference_level,'strong_inference'), 'commitment:'||c.id, 'promote_commitments', jsonb_build_object('person_memory_entry_id', c.id, 'contact_id', c.contact_id), c.due_text,
    case when c.due_text ~ '^\d{4}-\d{2}-\d{2}$' then (c.due_text||' 00:00:00+00')::timestamptz end,
    case when c.due_text ~ '^\d{4}-\d{2}-\d{2}$' then (c.due_text||' 00:00:00+00')::timestamptz end,
    case when c.due_text ~ '^\d{4}-\d{2}-\d{2}$' then (c.due_text||' 23:59:59.999+00')::timestamptz end,
    case when c.due_text ~ '^\d{4}-\d{2}-\d{2}$' then 'day' when c.due_text is not null then 'unknown' end,
    (c.due_text is not null and c.due_text !~ '^\d{4}-\d{2}-\d{2}$'), case when c.due_text is not null then c.confidence end
  from c on conflict (organization_id, company_id, dedup_key) do nothing;
  get diagnostics v_c = row_count;
  insert into public.account_fact_evidence (fact_id, organization_id, company_id, source_type, source_id, source_label, occurred_at, excerpt, contact_id, confidence)
  select f.id, f.organization_id, f.company_id, 'email', 'commitment:'||e.id, e.source_label, coalesce(e.source_occurred_at, e.observed_at), e.source_excerpt, e.contact_id, e.confidence
  from public.person_memory_entries e join public.contacts ct on ct.id=e.contact_id
  join public.account_facts f on f.dedup_key='commitment:'||e.id and f.organization_id=ct.organization_id and f.company_id=ct.company_id
  where ct.organization_id=p_org and e.entry_type='commitment' and (p_company is null or ct.company_id=p_company)
  on conflict (fact_id, source_type, source_id) do nothing;
  get diagnostics v_ce = row_count;
  return jsonb_build_object('moments_promoted', v_m, 'moment_evidence', v_me, 'commitments_promoted', v_c, 'commitment_evidence', v_ce);
end $$;
revoke all on function public.promote_account_facts(uuid, uuid) from public;
grant execute on function public.promote_account_facts(uuid, uuid) to service_role;
