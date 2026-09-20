CREATE TABLE IF NOT EXISTS public.llm_model_config (
  purpose        text PRIMARY KEY,
  label          text NOT NULL,
  description    text NOT NULL,
  current_model  text NOT NULL,
  env_fallback   text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.llm_model_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.llm_model_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.llm_model_config TO service_role;

INSERT INTO public.llm_model_config (purpose, label, description, current_model, env_fallback) VALUES
  ('analysis', 'Analyse emails / transcripts / marqueurs', 'Volume élevé d''événements à analyser en continu (emails, transcripts, classification des marqueurs de scoring V6) → modèle rapide et peu coûteux privilégié.', 'google/gemini-3.1-flash-lite', 'OPENROUTER_ANALYSIS_MODEL'),
  ('ask_bohu_chat', 'Chat "Demander à Bohu"', 'Conversation interactive avec l''utilisateur → modèle équilibré entre qualité de réponse et coût/latence.', 'openai/gpt-4.1-mini', 'OPENROUTER_MODEL'),
  ('enrichment_agent', 'Enrichissement de fiches compte/contact', 'Extraction structurée à partir de recherches web (agent + Perplexity) → modèle rapide adapté au suivi d''instructions strictes.', 'anthropic/claude-haiku-4.5', null)
ON CONFLICT (purpose) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.openrouter_models_catalog (
  id                     text PRIMARY KEY,
  name                   text,
  context_length         integer,
  prompt_price_per_m     numeric,
  completion_price_per_m numeric,
  is_free                boolean NOT NULL DEFAULT false,
  supports_reasoning     boolean NOT NULL DEFAULT false,
  supports_tools         boolean NOT NULL DEFAULT false,
  supports_web_search    boolean NOT NULL DEFAULT false,
  modality               text,
  raw                    jsonb,
  synced_at              timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.openrouter_models_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.openrouter_models_catalog FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.openrouter_models_catalog TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_llm_model_config()
 RETURNS SETOF llm_model_config
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_super_admin() then raise exception 'Accès refusé'; end if;
  return query select * from public.llm_model_config order by purpose;
end $function$;
REVOKE ALL ON FUNCTION public.admin_get_llm_model_config() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_llm_model_config() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_llm_model_config(p_purpose text, p_model text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_super_admin() then raise exception 'Accès refusé'; end if;
  if p_model is null or length(trim(p_model)) = 0 then raise exception 'Modèle invalide'; end if;
  update public.llm_model_config
    set current_model = trim(p_model), updated_by = auth.uid(), updated_at = now()
    where purpose = p_purpose;
  if not found then raise exception 'Purpose inconnu: %', p_purpose; end if;
end $function$;
REVOKE ALL ON FUNCTION public.admin_set_llm_model_config(p_purpose text, p_model text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_llm_model_config(p_purpose text, p_model text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_openrouter_catalog()
 RETURNS SETOF openrouter_models_catalog
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_super_admin() then raise exception 'Accès refusé'; end if;
  return query select * from public.openrouter_models_catalog order by prompt_price_per_m nulls last, id;
end $function$;
REVOKE ALL ON FUNCTION public.admin_get_openrouter_catalog() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_openrouter_catalog() TO authenticated, service_role;

notify pgrst, 'reload schema';
