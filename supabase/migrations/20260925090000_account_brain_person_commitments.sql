-- « Ce qu'il faut faire » (fiche Compte) était vide depuis le retrait du moteur
-- legacy (20260917180531) : account_brain renvoyait engagements = [].
-- Les engagements réellement détectés vivent au niveau PERSONNE
-- (person_memory_entries.entry_type = 'commitment'). On les remonte ici au
-- niveau compte, sans rien inférer :
--   - owner_contact_id = la personne SEULEMENT si source_direction = 'inbound'
--     (c'est elle qui s'est engagée) ; sinon owner non attribué (jamais deviné) ;
--   - owner_user_id = auteur SEULEMENT si source_direction = 'outbound' ;
--   - contact_id = personne concernée, toujours renseignée (affichage avatar).
-- Seuls les engagements ouverts (ni tenus ni écartés) sont remontés.
-- Le reste de la fonction est inchangé.

create or replace function public.account_brain(p_organization_id uuid, p_company_id uuid, p_user_id uuid default auth.uid())
 returns jsonb
 language plpgsql
 stable
 set search_path to 'pg_catalog', 'public', 'scoring', 'private'
as $function$
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
    'weather', case when v_snapshot is null then
      jsonb_build_object('status', 'insufficient_data', 'score', null, 'reason', 'aucun snapshot compte V6 canonique')
      else jsonb_build_object(
        'status', case when v_snapshot->>'status' = 'available' then 'available' else 'insufficient_data' end,
        'score', v_snapshot->'score', 'reliability', v_snapshot->'reliability',
        'delta_30d', v_snapshot->'delta', 'weakest_dial', v_snapshot->'weakestDial',
        'verdict_allowed', v_snapshot->'verdictAllowed', 'dials', v_snapshot->'dials',
        'at', v_snapshot->'observedAt', 'params_version', v_snapshot->'paramsVersion',
        'history', coalesce(v_snapshot->'history', '[]'::jsonb)
      ) end,
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
    'active_facts', '[]'::jsonb,
    'engagements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'origin', 'person_memory',
        'title', e.content,
        'detail', null,
        'status', 'active',
        'due_window_end', null,
        'is_overdue', null,
        'resolved_at', null,
        'occurred_at', coalesce(e.source_occurred_at, e.observed_at, e.created_at),
        'evidence_count', case when e.source_excerpt is null then 0 else 1 end,
        'contact_id', e.contact_id,
        'owner_contact_id', case when e.source_direction = 'inbound' then e.contact_id else null end,
        'owner_user_id', case when e.source_direction = 'outbound' then e.author_user_id else null end,
        'evidence', case when e.source_excerpt is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
          'source_type', 'email', 'source_label', e.source_label,
          'occurred_at', coalesce(e.source_occurred_at, e.observed_at),
          'excerpt', e.source_excerpt, 'contact_id', e.contact_id)) end
      ) order by coalesce(e.source_occurred_at, e.observed_at, e.created_at) desc)
      from public.person_memory_entries e
      join public.contacts k on k.id = e.contact_id and k.organization_id = e.organization_id
      where e.organization_id = p_organization_id
        and k.company_id = p_company_id
        and k.merged_into_contact_id is null
        and e.entry_type = 'commitment'
        and e.resolved_at is null
        and e.dismissed_at is null
        and (e.visibility = 'workspace' or e.author_user_id = p_user_id)
    ), '[]'::jsonb),
    'situation', jsonb_build_object('status', 'insufficient_data', 'reason', 'synthèse non admise dans le contrat canonique'),
    'delta_since_last', case when v_snapshot is null then
      jsonb_build_object('status', 'insufficient_data', 'message', 'Aucun état canonique disponible.')
      else jsonb_build_object('status', 'available', 'facts', '[]'::jsonb) end,
    'availability', jsonb_build_object(
      'weather', case when v_snapshot is null then 'insufficient_evidence' else coalesce(v_snapshot->>'status', 'insufficient_evidence') end,
      'facts', 'not_in_canonical_ledger', 'commitments', 'person_memory',
      'recommendations', 'deferred_human_calibration'
    )
  );
end $function$;
