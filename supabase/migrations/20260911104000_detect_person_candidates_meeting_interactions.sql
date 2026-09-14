-- La synchronisation calendrier large (sync-google-calendar/sync-microsoft-calendar)
-- crée des contacts candidats (is_tracked=false) à partir de meeting_participants,
-- pas seulement de communication_messages. detect_person_candidates (utilisée par
-- AddEntitiesModal via detectPersonCandidates) doit compter les deux sources pour
-- faire remonter "plusieurs rendez-vous avec cette personne" dans le classement,
-- sinon un candidat détecté uniquement via calendrier n'apparaît jamais dans
-- "Ajouter" → onglet Personnes.

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
          c.id as contact_id,
          c.full_name,
          c.email,
          c.role_title,
          c.company_id,
          company.name as company_name,
          (count(distinct message.id) + count(distinct mp.id))::integer as interactions,
          greatest(max(message.sent_at), max(meeting.starts_at)) as last_interaction_at,
          coalesce(c.source_summary ->> 'last_identity_source', c.source_summary ->> 'source', 'Connecteur') as source
        from public.contacts c
        left join public.companies company on company.id = c.company_id
        left join public.communication_messages message
          on message.organization_id = c.organization_id
         and message.contact_id = c.id
        left join public.meeting_participants mp
          on mp.organization_id = c.organization_id
         and mp.contact_id = c.id
        left join public.meetings meeting
          on meeting.id = mp.meeting_id
         and meeting.status = 'confirmed'
        where c.organization_id = p_organization_id
          and c.merged_into_contact_id is null
          and not c.is_tracked
        group by c.id, company.name
        order by (count(distinct message.id) + count(distinct mp.id)) desc, greatest(max(message.sent_at), max(meeting.starts_at)) desc nulls last, c.full_name
        limit least(greatest(coalesce(p_limit, 100), 1), 250)
      ) candidate
    ), '[]'::jsonb)
  );
end;
$$;

notify pgrst, 'reload schema';
