// Rafraîchit public.openrouter_models_catalog depuis le catalogue public
// OpenRouter (GET /models, aucune clé requise) — appelé depuis l'onglet
// "Modèles IA" du Super Admin. Réservé aux super admins : bien que l'endpoint
// source soit public, on évite qu'un utilisateur quelconque déclenche l'appel.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

type OpenRouterModel = {
  id: string
  name?: string
  context_length?: number
  pricing?: { prompt?: string; completion?: string }
  supported_parameters?: string[]
  architecture?: { modality?: string }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Authentification requise.' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const user = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authorization } } })
    const { data: { user: authUser }, error: userError } = await user.auth.getUser()
    if (userError || !authUser) return json({ error: 'Session invalide.' }, 401)

    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const { data: profile } = await admin.from('profiles').select('is_super_admin').eq('id', authUser.id).maybeSingle()
    if (!profile?.is_super_admin) return json({ error: 'Accès réservé au Super Admin.' }, 403)

    const response = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error(`OpenRouter ${response.status}`)
    const { data: models } = await response.json() as { data: OpenRouterModel[] }

    const syncedAt = new Date().toISOString()
    const rows = models.map((model) => {
      const promptPrice = Number(model.pricing?.prompt ?? 0)
      const completionPrice = Number(model.pricing?.completion ?? 0)
      const supported = model.supported_parameters ?? []
      return {
        id: model.id,
        name: model.name ?? model.id,
        context_length: model.context_length ?? null,
        prompt_price_per_m: promptPrice * 1_000_000,
        completion_price_per_m: completionPrice * 1_000_000,
        is_free: promptPrice === 0 && completionPrice === 0,
        supports_reasoning: supported.includes('reasoning') || supported.includes('include_reasoning'),
        supports_tools: supported.includes('tools'),
        supports_web_search: supported.includes('web_search_options') || /sonar|search-preview|grounding/i.test(model.id),
        modality: model.architecture?.modality ?? null,
        raw: model,
        synced_at: syncedAt,
      }
    })

    const { error: upsertError } = await admin.from('openrouter_models_catalog').upsert(rows, { onConflict: 'id' })
    if (upsertError) throw upsertError

    return json({ synced: rows.length, synced_at: syncedAt })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Erreur serveur.' }, 500)
  }
})
