import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
      supabase.from('companies').select('id,name,domain,industry,account_type,public_context,updated_at').order('updated_at', { ascending: false }).limit(50),
      supabase.from('contacts').select('id,company_id,full_name,email,role_title,location,web_bio,updated_at').is('merged_into_contact_id', null).order('updated_at', { ascending: false }).limit(50),
      supabase.from('company_signals').select('company_id,family,title,summary,source,confidence,observed_at').order('observed_at', { ascending: false }).limit(50),
      supabase.from('behavioral_signals').select('contact_id,signal_type,text,inference,inference_level,confidence,source_type,observed_at').order('observed_at', { ascending: false }).limit(50),
    ])
    if (companies.error || contacts.error || companySignals.error || behavioralSignals.error) {
      throw companies.error ?? contacts.error ?? companySignals.error ?? behavioralSignals.error
    }

    const openRouterKey = Deno.env.get('OPENROUTER_API_KEY')
    if (!openRouterKey) return json({ error: 'OPENROUTER_API_KEY n’est pas configurée côté serveur.' }, 503)

    const context = JSON.stringify({
      companies: companies.data,
      contacts: contacts.data,
      company_signals: companySignals.data,
      behavioral_signals: behavioralSignals.data,
    })
    const safeHistory = history.slice(-8).filter((item) => ['user', 'assistant'].includes(item.role) && typeof item.content === 'string').map((item) => ({ role: item.role, content: item.content.slice(0, 4000) }))
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openRouterKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': Deno.env.get('SITE_URL') ?? 'https://tohu.app', 'X-Title': 'Tohu' },
      body: JSON.stringify({
        model: Deno.env.get('OPENROUTER_MODEL') ?? 'openai/gpt-4.1-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: `Tu es Ask Tohu, le cerveau relationnel d'une équipe. Réponds en français, de façon directe, utile et sobre. Appuie-toi uniquement sur le contexte JSON fourni. N'invente aucune donnée. Si l'information manque, dis-le clairement. Contexte accessible à cet utilisateur : ${context}` },
          ...safeHistory,
          { role: 'user', content: message.trim() },
        ],
      }),
    })
    if (!response.ok) throw new Error(`OpenRouter a répondu ${response.status}`)
    const payload = await response.json()
    return json({ answer: payload.choices?.[0]?.message?.content ?? 'Aucune réponse disponible.' })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Erreur serveur.' }, 500)
  }
})

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
