-- Fait remonter la citation (evidence_text) jusqu'au panneau « Preuves » de la
-- Météo du compte : ajoute un flag is_verbatim (extrait garanti fidèle vs
-- paraphrase LLM) et recrée en migration trackée get_person_marker_events /
-- get_account_k_marker_events (créées hors suivi jusqu'ici, cf. mémoire
-- tohu-untracked-scoring-rpcs) pour qu'elles sélectionnent evidence_text.

alter table scoring.marker_event
  add column if not exists is_verbatim boolean not null default false;

comment on column scoring.marker_event.is_verbatim is
  'true si evidence_text est un extrait garanti fidèle (source_excerpt vérifié / transcript), jamais une paraphrase LLM (person_key_moments.summary).';

create or replace function public.get_person_marker_events(p_contact_id uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public', 'scoring', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
      'marker_id', marker_id, 'sense', sense, 'observed_at', observed_at,
      'evidence_ref', evidence_ref, 'evidence_text', evidence_text, 'is_verbatim', is_verbatim
    ) order by observed_at desc), '[]'::jsonb)
  from scoring.marker_event
  where scope = 'person' and contact_id = p_contact_id and is_candidate = false and deprecated_at is null
$function$;

create or replace function public.get_account_k_marker_events(p_company_id uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public', 'scoring', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
      'marker_id', marker_id, 'observed_at', observed_at,
      'evidence_ref', evidence_ref, 'evidence_text', evidence_text, 'is_verbatim', is_verbatim
    )), '[]'::jsonb)
  from scoring.marker_event
  where scope = 'account' and account_id = p_company_id and is_candidate = false and deprecated_at is null and resolved_at is null
$function$;
