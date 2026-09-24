// Modèle par usage, pilotable depuis le Super Admin (table llm_model_config).
// Ordre de résolution : base de données -> variable d'env -> défaut en dur.
export async function getConfiguredModel(
  db: { from: (table: string) => any },
  purpose: 'analysis' | 'ask_bohu_chat' | 'enrichment_agent' | 'web_search' | 'perplexity_direct',
  envVar: string | null,
  hardDefault: string,
): Promise<string> {
  const { data } = await db.from('llm_model_config').select('current_model').eq('purpose', purpose).maybeSingle()
  if (data?.current_model) return data.current_model
  if (envVar) {
    const fromEnv = Deno.env.get(envVar)
    if (fromEnv) return fromEnv
  }
  return hardDefault
}
