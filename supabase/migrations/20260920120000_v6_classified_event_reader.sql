-- classify-markers relisait toutes les sources de chaque dyade à chaque cycle : le
-- même texte repassait dans le LLM indéfiniment. Depuis que les corps d'email
-- entrants alimentent le classificateur, ce coût devient réel. Cette lecture rend
-- l'ensemble des événements déjà classés (une erreur technique n'en fait pas
-- partie : elle est retentée).

create or replace function public.v6_classified_event_ids(p_dyad_id uuid)
returns setof text
language sql stable security definer
set search_path = pg_catalog, scoring
as $$
  select distinct source_event_id
  from scoring.foundation_classifier_run
  where dyad_id = p_dyad_id and result_status <> 'technical_error';
$$;

revoke all on function public.v6_classified_event_ids(uuid) from public, anon, authenticated;
grant execute on function public.v6_classified_event_ids(uuid) to service_role;

notify pgrst, 'reload schema';
