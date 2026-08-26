// Journalisation de l'usage IA (OpenRouter) → table `ai_usage_events`.
// OpenRouter renvoie `usage` (tokens réels) dans chaque réponse : on stocke ces
// tokens + un coût ESTIMÉ via la grille ci-dessous. La grille est approximative
// (la source de vérité des dépenses reste le tableau de bord OpenRouter) et se
// met à jour ici sans toucher au reste du code.

// Prix approximatifs en USD par 1 000 000 de tokens (entrée / sortie).
// À ajuster selon la facturation OpenRouter réelle.
const PRICING: Record<string, { in: number; out: number }> = {
  'google/gemini-3.1-flash-lite': { in: 0.10, out: 0.40 },
  'anthropic/claude-haiku-4.5': { in: 1.00, out: 5.00 },
  'openai/gpt-4.1-mini': { in: 0.40, out: 1.60 },
}
const DEFAULT_PRICE = { in: 0.50, out: 1.50 }

export type TokenUsage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null | undefined

export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const price = PRICING[model] ?? DEFAULT_PRICE
  return (promptTokens / 1_000_000) * price.in + (completionTokens / 1_000_000) * price.out
}

type AnySupabase = { from: (table: string) => { insert: (rows: unknown) => Promise<{ error: unknown }> } }

/** Best-effort : ne jette jamais (une erreur de log ne doit pas casser l'analyse). */
export async function logAiUsage(client: AnySupabase, params: {
  organizationId?: string | null
  userId?: string | null
  fn: string
  model: string
  usage: TokenUsage
}): Promise<void> {
  try {
    const prompt = Math.max(0, Math.round(Number(params.usage?.prompt_tokens ?? 0)))
    const completion = Math.max(0, Math.round(Number(params.usage?.completion_tokens ?? 0)))
    const total = Math.max(0, Math.round(Number(params.usage?.total_tokens ?? prompt + completion)))
    await client.from('ai_usage_events').insert({
      organization_id: params.organizationId ?? null,
      user_id: params.userId ?? null,
      fn: params.fn,
      model: params.model,
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: total,
      estimated_cost_usd: Number(estimateCostUsd(params.model, prompt, completion).toFixed(6)),
    })
  } catch {
    // silencieux : la journalisation ne doit jamais interrompre le flux principal.
  }
}
