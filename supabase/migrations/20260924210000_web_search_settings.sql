-- Réglages de la veille externe (recherche web), pilotés depuis Super Admin > Modèles IA.
-- Réutilise llm_model_config + admin_set_llm_model_config : aucune nouvelle table/RPC.
--  * web_search        : modèle OpenRouter qui fait la recherche web quand Perplexity direct est désactivé.
--  * perplexity_direct : 'on' → API Perplexity directe (compte alimenté) ; 'off' → OpenRouter uniquement.
INSERT INTO public.llm_model_config (purpose, label, description, current_model, env_fallback) VALUES
  ('web_search', 'Recherche web (veille externe)', 'Modèle OpenRouter qui cherche l''actualité des comptes et personnes. Un modèle « Sonar » a la recherche web native ; tout autre modèle utilise le plugin web d''OpenRouter (léger surcoût par recherche).', 'perplexity/sonar', null),
  ('perplexity_direct', 'Perplexity en direct', 'on = utilise l''API Perplexity directement (compte à alimenter) ; off = tout passe par OpenRouter avec le modèle choisi ci-dessus.', 'off', null)
ON CONFLICT (purpose) DO NOTHING;
