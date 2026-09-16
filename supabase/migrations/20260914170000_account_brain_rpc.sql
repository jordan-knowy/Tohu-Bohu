-- account_brain : couche de compréhension serveur (un appel pour la fiche compte).
-- N'RECALCULE PAS le scoring : agrège faits/preuves/recos/snapshots + états de
-- disponibilité explicites (available/insufficient_data/no_personal_interaction).
-- Sépare kind = observed_fact | inference | deterministic | synthesis.
-- SECURITY DEFINER : auth.uid non nul → can_view_company (service role bypass pour jobs).
create or replace function public.account_brain(
  p_organization_id uuid, p_company_id uuid, p_user_id uuid default auth.uid()
) returns jsonb
language plpgsql stable security definer set search_path = public, scoring, private, pg_temp
as $$
declare
  v_name text; v_relation text; v_t0 timestamptz; v_t0_team timestamptz; v_personal boolean;
  v_reading record; v_result jsonb;
begin
  if auth.uid() is not null and not private.can_view_company(p_organization_id, p_company_id) then
    raise exception 'ACCOUNT_FORBIDDEN';
  end if;
  select c.name into v_name from public.companies c where c.id = p_company_id;
  select coalesce(s.relationship_status, c.account_type::text) into v_relation
    from public.companies c left join public.account_settings s
      on s.company_id = c.id and s.organization_id = p_organization_id
    where c.id = p_company_id;
  select greatest(
    coalesce((select max(m.starts_at) from public.meetings m
      where m.organization_id = p_organization_id and m.company_id = p_company_id and m.owner_user_id = p_user_id), 'epoch'),
    coalesce((select max(cm.sent_at) from public.communication_messages cm join public.contacts ct on ct.id = cm.contact_id
      where ct.company_id = p_company_id and cm.source_owner_user_id = p_user_id), 'epoch')) into v_t0;
  if v_t0 = 'epoch' then v_t0 := null; end if;
  v_personal := v_t0 is not null;
  select greatest(
    coalesce((select max(m.starts_at) from public.meetings m where m.company_id = p_company_id), 'epoch'),
    coalesce((select max(cm.sent_at) from public.communication_messages cm join public.contacts ct on ct.id = cm.contact_id
      where ct.company_id = p_company_id), 'epoch')) into v_t0_team;
  if v_t0_team = 'epoch' then v_t0_team := null; end if;
  select content, confidence, generated_at into v_reading from public.account_strategic_readings
    where organization_id = p_organization_id and company_id = p_company_id order by generated_at desc limit 1;
  v_result := jsonb_build_object(
    'generated_at', now(),
    'account', jsonb_build_object('id', p_company_id, 'name', v_name, 'relation_type', v_relation),
    'weather', coalesce((select jsonb_build_object('status','available','score',ss.score,'reliability',ss.reliability,
        'delta_30d',ss.delta_30d,'weakest_dial',ss.weakest_dial,'verdict_allowed',ss.verdict_allowed,
        'dials',ss.axes_or_dials,'at',ss.at,'params_version',ss.params_version)
      from scoring.score_snapshot ss where ss.entity_type='account' and ss.account_id=p_company_id order by ss.at desc limit 1),
      jsonb_build_object('status','insufficient_data','reason','aucun snapshot compte V6')),
    'dimensions', jsonb_build_object('status','insufficient_data','reason','score V6 compte non calcule'),
    'situation', case when v_reading.content is not null then jsonb_build_object('status','available','kind','synthesis',
        'statement', v_reading.content->>'synthese','confidence', v_reading.confidence,'generated_at', v_reading.generated_at)
      else jsonb_build_object('status','insufficient_data','reason','pas de lecture strategique') end,
    'delta_since_last', case when not v_personal then jsonb_build_object('status','no_personal_interaction',
        'message','Vous n''avez encore aucun echange personnel observe avec ce compte.','team_last', v_t0_team)
      else jsonb_build_object('status','available','t0', v_t0, 'personal', true,
        'facts', coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'fact_type',f.fact_type,'title',f.title,'impact',f.impact,
            'occurred_at',f.occurred_at,'kind', case when f.inference_level='fact' then 'observed_fact' else 'inference' end) order by f.occurred_at desc)
          from public.account_facts f where f.company_id=p_company_id and f.status='active' and f.occurred_at is not null and f.occurred_at > v_t0), '[]'::jsonb)) end,
    'active_facts', coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'fact_type',l.fact_type,'title',l.title,'detail',l.detail,
        'impact',l.impact,'occurred_at',l.occurred_at,'first_seen_at',l.first_seen_at,'is_overdue',l.is_overdue,'due_window_end',l.due_window_end,
        'confidence',l.confidence,'inference_level',l.inference_level,'subject_contact_id',l.subject_contact_id,'evidence_count',l.evidence_count,
        'has_verbatim',l.has_verbatim,'kind', case when l.inference_level='fact' then 'observed_fact' else 'inference' end) order by l.occurred_at desc nulls last)
      from public.account_facts_live l where l.company_id=p_company_id and l.status='active'), '[]'::jsonb),
    'engagements', coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'status',l.status,'due_window_end',l.due_window_end,
        'is_overdue',l.is_overdue,'resolved_at',l.resolved_at,'occurred_at',l.occurred_at,'evidence_count',l.evidence_count) order by l.occurred_at desc)
      from public.account_facts_live l where l.company_id=p_company_id and l.fact_type='commitment'), '[]'::jsonb),
    'recommendations', coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'category',r.category,'title',r.title,'justification',r.justification,
        'recommended_action',r.recommended_action,'priority',r.priority,'priority_breakdown',r.priority_breakdown,'contact_id',r.contact_id,'due_at',r.due_at,
        'kind', case when r.category='lecture_strategique' then 'synthesis' else 'deterministic' end) order by r.priority desc)
      from public.account_recommendations r where r.organization_id=p_organization_id and r.company_id=p_company_id and r.status in ('open','postponed')), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'fact_type',f.fact_type,'title',f.title,'impact',f.impact,
        'occurred_at',f.occurred_at,'status',f.status) order by f.occurred_at desc)
      from public.account_facts f where f.company_id=p_company_id and (f.fact_type in ('milestone','decision','event','role') or f.status in ('resolved','obsolete'))), '[]'::jsonb),
    'availability', jsonb_build_object(
      'weather', case when exists(select 1 from scoring.score_snapshot ss where ss.entity_type='account' and ss.account_id=p_company_id) then 'available' else 'insufficient_data' end,
      'dimensions','insufficient_data',
      'situation', case when v_reading.content is not null then 'available' else 'insufficient_data' end,
      'delta', case when v_personal then 'available' else 'no_personal_interaction' end,
      'recommendations', case when exists(select 1 from public.account_recommendations r where r.company_id=p_company_id and r.status in ('open','postponed')) then 'available' else 'insufficient_data' end,
      'history', case when exists(select 1 from public.account_facts f where f.company_id=p_company_id) then 'available' else 'insufficient_data' end));
  return v_result;
end $$;
revoke all on function public.account_brain(uuid, uuid, uuid) from public;
grant execute on function public.account_brain(uuid, uuid, uuid) to authenticated, service_role;
notify pgrst, 'reload schema';
