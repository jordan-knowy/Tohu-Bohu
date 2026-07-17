/**
 * Lecture stratégique d'un compte — génération côté serveur.
 *
 * Entrée  : POST { organizationId, companyId } (JWT utilisateur requis).
 * Sortie  : { success, reading } | { insufficient, counts, missing } | { error }.
 *
 * Garde-fous :
 *  - membership vérifié avant toute lecture ;
 *  - seuil de suffisance appliqué AVANT l'appel IA (pas de synthèse inventée) ;
 *  - le prompt ne contient que des métadonnées persistées (jamais de corps d'email) ;
 *  - résultat persisté dans account_strategic_readings (service role uniquement).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MIN_EVIDENCE = 3

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

type ReadingContent = {
  synthese?: string
  forces?: string[]
  risques?: string[]
  prochaines_actions?: string[]
  confidence?: number
}

function extractJson(value: string): ReadingContent {
  try { return JSON.parse(value) } catch {
    const match = value.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('Synthèse IA non parsable')
    return JSON.parse(match[0])
  }
}

function stringList(value: unknown, max = 5): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, max)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Authentification requise' }, 401)
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const { data: { user }, error: userError } = await supabase.auth.getUser(authorization.replace('Bearer ', ''))
    if (userError || !user) return json({ error: 'Session invalide' }, 401)

    const { organizationId, companyId } = await request.json().catch(() => ({}))
    if (!organizationId || !companyId) return json({ error: 'Paramètres invalides' }, 400)
    const { data: membership } = await supabase.from('memberships').select('id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle()
    if (!membership) return json({ error: 'Accès refusé à cette organisation' }, 403)

    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('id,name,domain,industry,account_type,public_context,last_monitored_at')
      .eq('id', companyId)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (companyError) throw companyError
    if (!company) return json({ error: 'Compte introuvable dans ce workspace' }, 404)

    const { data: contacts, error: contactsError } = await supabase
      .from('contacts')
      .select('id,full_name,role_title,relationship_snapshots(engagement_score,phase,last_contact_at,snapshot_date)')
      .eq('organization_id', organizationId)
      .eq('company_id', companyId)
      .is('merged_into_contact_id', null)
      .limit(30)
    if (contactsError) throw contactsError
    const contactIds = (contacts ?? []).map((contact) => contact.id)

    const [signalsResult, behavioralResult, meetingsResult, messagesResult] = await Promise.all([
      supabase.from('company_signals').select('family,title,summary,source,confidence,observed_at').eq('company_id', companyId).order('observed_at', { ascending: false }).limit(20),
      contactIds.length
        ? supabase.from('behavioral_signals').select('contact_id,signal_type,inference,text,confidence,observed_at').eq('organization_id', organizationId).in('contact_id', contactIds).order('observed_at', { ascending: false }).limit(20)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('meetings').select('title,meeting_type,platform,starts_at').eq('company_id', companyId).order('starts_at', { ascending: false }).limit(20),
      contactIds.length
        ? supabase.from('communication_messages').select('contact_id,direction,sent_at').eq('organization_id', organizationId).in('contact_id', contactIds).order('sent_at', { ascending: false }).limit(400)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (signalsResult.error) throw signalsResult.error
    if (behavioralResult.error) throw behavioralResult.error
    if (meetingsResult.error) throw meetingsResult.error
    if (messagesResult.error) throw messagesResult.error

    const signals = signalsResult.data ?? []
    const behavioral = behavioralResult.data ?? []
    const meetings = meetingsResult.data ?? []
    const messages = messagesResult.data ?? []

    const counts = {
      contacts: contactIds.length,
      signals: signals.length + behavioral.length,
      interactions: meetings.length,
      messages: messages.length,
    }
    const missing: string[] = []
    if (counts.contacts < 1) missing.push('au moins un contact lié au compte')
    const evidence = counts.signals + counts.interactions + counts.messages
    if (evidence < MIN_EVIDENCE) missing.push(`au moins ${MIN_EVIDENCE} éléments d'historique (signaux, réunions ou échanges)`)
    if (missing.length) return json({ insufficient: true, counts, missing })

    const apiKey = Deno.env.get('OPENROUTER_API_KEY')
    if (!apiKey) return json({ error: 'OPENROUTER_API_KEY n’est pas configurée côté serveur.' }, 503)

    // Métadonnées d'échanges uniquement : volumes, directions, dates — jamais de contenu.
    const exchangeStats = contactIds.map((contactId) => {
      const own = messages.filter((message) => message.contact_id === contactId)
      if (!own.length) return null
      const outbound = own.filter((message) => message.direction === 'outbound').length
      return {
        contact: (contacts ?? []).find((contact) => contact.id === contactId)?.full_name ?? 'Contact',
        messages: own.length,
        envoyes_par_nous: outbound,
        recus: own.length - outbound,
        dernier_echange: own[0]?.sent_at ?? null,
      }
    }).filter(Boolean)

    const context = JSON.stringify({
      compte: { nom: company.name, secteur: company.industry, domaine: company.domain, type: company.account_type, contexte_public: company.public_context },
      contacts: (contacts ?? []).map((contact) => {
        const snapshots = Array.isArray(contact.relationship_snapshots) ? [...contact.relationship_snapshots].sort((a, b) => String(b.snapshot_date ?? '').localeCompare(String(a.snapshot_date ?? ''))) : []
        const latest = snapshots[0]
        return { nom: contact.full_name, role: contact.role_title, score_engagement: latest?.engagement_score ?? null, phase: latest?.phase ?? null, dernier_contact: latest?.last_contact_at ?? null }
      }),
      signaux_entreprise: signals,
      signaux_comportementaux: behavioral.map((signal) => ({ type: signal.signal_type, inference: signal.inference, observation: signal.text, confiance: signal.confidence, date: signal.observed_at })),
      reunions: meetings,
      statistiques_echanges: exchangeStats,
    })

    const prompt = `Tu produis la « lecture stratégique » d'un compte pour Tohu, le cerveau relationnel d'une équipe.
Règles strictes : réponds en français ; appuie-toi UNIQUEMENT sur le contexte JSON fourni ; n'invente aucun fait, chiffre, nom ou intention ; si la matière est mince, dis-le et reste prudent ; aucune donnée sensible ni jugement sur les personnes ; formulations factuelles et actionnables.
Réponds uniquement en JSON :
{"synthese":"2 à 4 phrases : état de la relation, dynamique, enjeu principal","forces":["2 à 4 points d'appui factuels"],"risques":["2 à 4 points de vigilance factuels"],"prochaines_actions":["2 à 3 actions concrètes découlant du contexte"],"confidence":0}
Le champ confidence (0-100) reflète la quantité et la fraîcheur de la matière disponible.
Contexte : ${context}`

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': Deno.env.get('SITE_URL') ?? 'https://tohu.app', 'X-Title': 'Tohu Account Strategic Reading' },
      body: JSON.stringify({
        model: Deno.env.get('OPENROUTER_MODEL') ?? 'openai/gpt-4.1-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        max_tokens: 700,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!response.ok) throw new Error(`OpenRouter ${response.status}`)
    const payload = await response.json()
    const model = String(payload.model ?? Deno.env.get('OPENROUTER_MODEL') ?? 'openai/gpt-4.1-mini')
    const result = extractJson(String(payload.choices?.[0]?.message?.content ?? ''))
    const synthese = String(result.synthese ?? '').trim()
    if (!synthese) throw new Error('Synthèse IA vide')

    const content = {
      synthese,
      forces: stringList(result.forces),
      risques: stringList(result.risques),
      prochaines_actions: stringList(result.prochaines_actions, 3),
    }
    const confidence = Math.max(0, Math.min(100, Number(result.confidence ?? 0)))
    const { data: saved, error: saveError } = await supabase
      .from('account_strategic_readings')
      .upsert({
        organization_id: organizationId,
        company_id: companyId,
        content,
        confidence,
        source_counts: counts,
        model,
        generated_by: user.id,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'organization_id,company_id' })
      .select('content,confidence,source_counts,model,generated_at')
      .single()
    if (saveError) throw saveError

    return json({ success: true, reading: saved })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Génération impossible' }, 500)
  }
})
