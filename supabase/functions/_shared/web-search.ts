// Recherche web sourcée de la veille externe (Compte + Personne).
// Réglages pilotés depuis Super Admin > Modèles IA (table llm_model_config) :
//  - perplexity_direct = 'on'  → API Perplexity directe (compte à alimenter), repli OpenRouter si refus ;
//  - perplexity_direct = 'off' → OpenRouter uniquement, avec le modèle `web_search` choisi.
import { getConfiguredModel } from './llm-model-config.ts'

const PERPLEXITY_API = 'https://api.perplexity.ai/chat/completions'
const PERPLEXITY_MODEL = 'sonar'
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions'
export const DEFAULT_WEB_SEARCH_MODEL = 'perplexity/sonar'

export type WebSearchKeys = { perplexity: string | null; openrouter: string | null }
export type WebSearchSettings = { perplexityDirect: boolean; model: string }
export type WebSearchMessage = { role: 'system' | 'user'; content: string }
export type WebSearchResult = { content: string; citations: string[]; provider: string } | { error: string }

// Clé Perplexity directe refusée (401/402/403) : pas de nouvel essai pour le reste de l'instance.
let perplexityDirectDown = false

export async function getWebSearchSettings(db: { from: (table: string) => any }): Promise<WebSearchSettings> {
  const [model, direct] = await Promise.all([
    getConfiguredModel(db, 'web_search', null, DEFAULT_WEB_SEARCH_MODEL),
    getConfiguredModel(db, 'perplexity_direct', null, 'off'),
  ])
  return { model, perplexityDirect: direct === 'on' }
}

export function readWebSearchKeys(): WebSearchKeys {
  return { perplexity: Deno.env.get('PERPLEXITY_API_KEY') ?? null, openrouter: Deno.env.get('OPENROUTER_API_KEY') ?? null }
}

/** Les modèles Sonar cherchent nativement ; tout autre modèle passe par le plugin web d'OpenRouter. */
function hasNativeSearch(model: string): boolean {
  return model.startsWith('perplexity/') || model.includes(':online')
}

export async function runWebSearch(
  keys: WebSearchKeys,
  settings: WebSearchSettings,
  messages: WebSearchMessage[],
  opts: { maxTokens?: number; timeoutMs?: number; recencyYear?: boolean } = {},
): Promise<WebSearchResult> {
  const maxTokens = opts.maxTokens ?? 900
  const timeoutMs = opts.timeoutMs ?? 45000
  const providers: { name: string; url: string; key: string; body: Record<string, unknown> }[] = []
  if (settings.perplexityDirect && keys.perplexity && !perplexityDirectDown) {
    providers.push({
      name: 'perplexity', url: PERPLEXITY_API, key: keys.perplexity,
      body: { model: PERPLEXITY_MODEL, messages, max_tokens: maxTokens, temperature: 0.1, ...(opts.recencyYear ? { search_recency_filter: 'year' } : {}) },
    })
  }
  if (keys.openrouter) {
    providers.push({
      name: 'openrouter', url: OPENROUTER_API, key: keys.openrouter,
      body: {
        model: settings.model, messages, max_tokens: maxTokens, temperature: 0.1,
        ...(hasNativeSearch(settings.model) ? {} : { plugins: [{ id: 'web', max_results: 5 }] }),
      },
    })
  }
  let lastError = keys.openrouter || settings.perplexityDirect ? 'no_provider' : 'openrouter_key_missing'
  for (const p of providers) {
    try {
      const res = await fetch(p.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(p.body),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 200)
        console.error(`[web-search] ${p.name} HTTP ${res.status}: ${detail}`)
        lastError = `${p.name}_http_${res.status}`
        if (p.name === 'perplexity' && [401, 402, 403].includes(res.status)) perplexityDirectDown = true
        continue
      }
      const data = await res.json()
      const message = data.choices?.[0]?.message
      const citations: string[] = Array.isArray(data.citations)
        ? data.citations
        : Array.isArray(message?.annotations)
          ? message.annotations.map((a: any) => a?.url_citation?.url).filter(Boolean)
          : []
      return { content: message?.content ?? '', citations, provider: p.name }
    } catch (err) {
      lastError = `${p.name}_${err instanceof Error ? err.message : String(err)}`.slice(0, 120)
      console.error(`[web-search] ${p.name} impossible: ${lastError}`)
    }
  }
  return { error: lastError }
}
