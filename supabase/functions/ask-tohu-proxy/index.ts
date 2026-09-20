import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { logAiUsage } from '../_shared/ai-usage.ts'
import { getConfiguredModel } from '../_shared/llm-model-config.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type HistoryItem = { role: 'user' | 'assistant'; content: string }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Authentification requise.' }, 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authorization } } },
    )
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) return json({ error: 'Session invalide.' }, 401)

    const { message, history = [] } = await request.json() as { message?: string; history?: HistoryItem[] }
    if (!message?.trim() || message.length > 4000) return json({ error: 'Question invalide.' }, 400)

    const [companies, contacts, companySignals, behavioralSignals] = await Promise.all([
      supabase.from('companies').select('id,name,domain,industry,account_type,public_context,updated_at').eq('is_tracked', true).order('updated_at', { ascending: false }).limit(50),
      supabase.from('contacts').select('id,company_id,full_name,email,role_title,location,web_bio,updated_at').eq('is_tracked', true).is('merged_into_contact_id', null).order('updated_at', { ascending: false }).limit(50),
      supabase.from('company_signals').select('company_id,family,title,summary,source,confidence,observed_at').order('observed_at', { ascending: false }).limit(50),
      supabase.from('behavioral_signals').select('contact_id,signal_type,text,inference,inference_level,confidence,source_type,observed_at').order('observed_at', { ascending: false }).limit(50),
    ])
    if (companies.error || contacts.error || companySignals.error || behavioralSignals.error) {
      throw companies.error ?? contacts.error ?? companySignals.error ?? behavioralSignals.error
    }

    const openRouterKey = Deno.env.get('OPENROUTER_API_KEY')
    if (!openRouterKey) return json({ error: 'OPENROUTER_API_KEY n’est pas configurée côté serveur.' }, 503)

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const admin = serviceKey ? createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey) : null

    const context = JSON.stringify({
      companies: companies.data,
      contacts: contacts.data,
      company_signals: companySignals.data,
      behavioral_signals: behavioralSignals.data,
    })
    const safeHistory = history.slice(-8).filter((item) => ['user', 'assistant'].includes(item.role) && typeof item.content === 'string').map((item) => ({ role: item.role, content: item.content.slice(0, 4000) }))
    const model = admin
      ? await getConfiguredModel(admin, 'ask_bohu_chat', 'OPENROUTER_MODEL', 'openai/gpt-4.1-mini')
      : Deno.env.get('OPENROUTER_MODEL') ?? 'openai/gpt-4.1-mini'
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openRouterKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': Deno.env.get('SITE_URL') ?? 'https://tohu.app', 'X-Title': 'Tohu' },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: `Tu es Ask Bohu, le cerveau relationnel d'une équipe. Réponds en français, de façon directe, utile et sobre. Appuie-toi uniquement sur le contexte JSON fourni. N'invente aucune donnée. Si l'information manque, dis-le clairement plutôt que de généraliser.

Mets en **gras** (markdown \`**mot**\`) les entités, dates, chiffres et éléments importants dans tout le texte — pas seulement dans les titres, systématiquement dès qu'un mot-clé mérite d'être repéré au scan.

Si pertinent, ouvre ta réponse par 2 à 4 lignes de faits clés, chacune sur sa propre ligne, au format exact \`**Label :** valeur\` (par exemple \`**Compte :** Ac Toulouse\`, \`**Niveau de risque :** élevé\`, \`**Dernier échange :** il y a 21 jours\`) — uniquement quand ces faits existent réellement dans le contexte, jamais inventés.

Puis structure le reste avec des titres markdown parmi (uniquement ceux pertinents pour la question, dans cet ordre) :
### Résumé — une ou deux phrases de synthèse.
### Points clés — liste à puces courtes des faits marquants.
### Pourquoi — l'explication ou le raisonnement, si utile.
### Recommandations — liste à puces d'actions concrètes.
### Sources — liste à puces des éléments du contexte utilisés (nature + date), uniquement si tu cites des faits précis.
Préfère des phrases courtes et des listes à des paragraphes longs. Pour une question courte ou conversationnelle, un simple paragraphe sans titre ni faits reste préférable à une structure forcée.

Contexte accessible à cet utilisateur : ${context}` },
          ...safeHistory,
          { role: 'user', content: message.trim() },
        ],
      }),
    })
    if (!response.ok) throw new Error(`OpenRouter a répondu ${response.status}`)
    const payload = await response.json()
    // Journalisation de l'usage (client service-role : l'utilisateur n'a pas le droit d'écrire).
    if (admin) {
      const { data: membership } = await supabase.from('memberships').select('organization_id').eq('user_id', user.id).limit(1).maybeSingle()
      await logAiUsage(admin, { organizationId: membership?.organization_id ?? null, userId: user.id, fn: 'ask-tohu-proxy', model, usage: payload?.usage })
    }
    return json({ answer: payload.choices?.[0]?.message?.content ?? 'Aucune réponse disponible.' })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Erreur serveur.' }, 500)
  }
})

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
