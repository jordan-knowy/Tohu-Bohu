// Lecture stratégique d'un compte — générée À LA DEMANDE (ouverture de la fiche
// compte), jamais dans une boucle cron. Agrège uniquement des données déjà
// persistées (moments clés extraits des échanges, engagements, profils
// cognitifs des contacts, score relationnel, veille, recommandations ouvertes)
// et demande au modèle une synthèse strictement bornée à ces faits — aucun
// accès au corps des emails ici (jamais stocké, voir sync-email-analysis).
// Historique conservé par insertion (une ligne par génération), le front lit
// toujours la plus récente. Règle de suffisance : voir src/services/strategic-reading.ts
// (dupliquée ici côté serveur, seule source autoritaire).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { strictObject } from '../_shared/behavior-analysis.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

const MIN_EVIDENCE = 3
const STALE_MS = 7 * 86_400_000

const READING_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'tohu_account_strategic_reading',
    strict: true,
    schema: strictObject({
      synthese: { type: 'string' },
      forces: { type: 'array', items: { type: 'string' } },
      risques: { type: 'array', items: { type: 'string' } },
      prochaines_actions: { type: 'array', items: { type: 'string' } },
      confidence: { type: 'number', minimum: 0, maximum: 100 },
    }),
  },
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const authorization = request.headers.get('Authorization')
  if (!authorization) return json({ error: 'Authentification requise' }, 401)
  const { data: { user }, error: userError } = await supabase.auth.getUser(authorization.replace('Bearer ', ''))
  if (userError || !user) return json({ error: 'Session invalide' }, 401)

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const organizationId = typeof body.organizationId === 'string' ? body.organizationId : null
  const companyId = typeof body.companyId === 'string' ? body.companyId : null
  const force = body.force === true
  if (!organizationId || !companyId) return json({ error: 'Paramètres invalides' }, 400)

  const { data: membership } = await supabase.from('memberships').select('id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle()
  if (!membership) return json({ error: 'Accès refusé' }, 403)

  const { data: cached } = await supabase.from('account_strategic_readings')
    .select('content, confidence, source_counts, model, generated_at')
    .eq('organization_id', organizationId).eq('company_id', companyId)
    .order('generated_at', { ascending: false }).limit(1).maybeSingle()
  if (cached && !force && Date.now() - new Date(String(cached.generated_at)).getTime() < STALE_MS) {
    return json({ ...cached, cached: true })
  }

  try {
    const [{ data: company }, { data: contacts }] = await Promise.all([
      supabase.from('companies').select('name').eq('id', companyId).maybeSingle(),
      supabase.from('contacts').select('id, full_name').eq('organization_id', organizationId).eq('company_id', companyId).eq('is_tracked', true).is('merged_into_contact_id', null),
    ])
    const contactIds = (contacts ?? []).map((row) => String(row.id))
    const contactName = new Map((contacts ?? []).map((row) => [String(row.id), String(row.full_name ?? 'Contact')]))

    const [
      { data: latestScoreRows },
      { data: signalRows },
      { data: openRecommendationRows },
      { data: momentRows },
      { data: commitmentRows },
      { data: profileRows },
      { count: meetingCount },
      { count: messageCount },
    ] = await Promise.all([
      supabase.from('account_relationship_score_snapshots')
        .select('score, phase, phase_delta, confidence, contact_coverage, decision_maker_coverage, concentration_risk, total_interactions, last_interaction_at, computed_at')
        .eq('organization_id', organizationId).eq('company_id', companyId)
        .order('computed_at', { ascending: false }).limit(1),
      supabase.from('company_signals').select('family, title, summary, impact, observed_at')
        .eq('organization_id', organizationId).eq('company_id', companyId)
        .order('observed_at', { ascending: false }).limit(15),
      supabase.from('account_recommendations').select('category, title, justification')
        .eq('organization_id', organizationId).eq('company_id', companyId).eq('status', 'open')
        .order('priority', { ascending: false }).limit(10),
      contactIds.length ? supabase.from('person_key_moments').select('contact_id, title, summary, impact, occurred_at')
        .in('contact_id', contactIds).order('occurred_at', { ascending: false }).limit(25) : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      contactIds.length ? supabase.from('person_memory_entries').select('contact_id, content, observed_at')
        .in('contact_id', contactIds).eq('entry_type', 'commitment').order('observed_at', { ascending: false }).limit(15) : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      contactIds.length ? supabase.from('cognitive_profiles').select('contact_id, trust_score, satisfaction_score, account_relation_hint')
        .in('contact_id', contactIds).eq('profile_version', 1) : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      supabase.from('meetings').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('company_id', companyId),
      contactIds.length ? supabase.from('communication_messages').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).in('contact_id', contactIds) : Promise.resolve({ count: 0 }),
    ])

    const sourceCounts = {
      contacts: contactIds.length,
      signals: (signalRows ?? []).length,
      interactions: meetingCount ?? 0,
      messages: messageCount ?? 0,
    }
    const evidenceTotal = sourceCounts.signals + sourceCounts.interactions + sourceCounts.messages
    if (sourceCounts.contacts < 1 || evidenceTotal < MIN_EVIDENCE) {
      return json({
        error: 'Pas assez de matière pour générer une lecture fiable de ce compte.',
        insufficientEvidence: true,
        sourceCounts,
      }, 422)
    }

    const latestScore = latestScoreRows?.[0] ?? null
    const trustScores = (profileRows ?? []).flatMap((row) => Number.isFinite(Number(row.trust_score)) ? [Number(row.trust_score)] : [])
    const satisfactionScores = (profileRows ?? []).flatMap((row) => Number.isFinite(Number(row.satisfaction_score)) ? [Number(row.satisfaction_score)] : [])
    const avg = (values: number[]) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null
    const accountRelationHints = [...new Set((profileRows ?? []).map((row) => row.account_relation_hint).filter((value): value is string => typeof value === 'string' && value.length > 0))]

    const facts = {
      compte: company?.name ?? 'Ce compte',
      score_relationnel: latestScore ? {
        score: latestScore.score, phase: latestScore.phase, variation_pts: latestScore.phase_delta,
        couverture_decideurs_pct: latestScore.decision_maker_coverage, risque_concentration_pct: latestScore.concentration_risk,
        derniere_interaction: latestScore.last_interaction_at,
      } : null,
      confiance_moyenne_contacts: avg(trustScores),
      satisfaction_moyenne_contacts: avg(satisfactionScores),
      nature_relation_suggeree: accountRelationHints,
      moments_cles: (momentRows ?? []).map((row) => ({
        contact: contactName.get(String(row.contact_id)) ?? 'Contact', titre: row.title, resume: row.summary, impact: row.impact, date: row.occurred_at,
      })),
      engagements_en_cours: (commitmentRows ?? []).map((row) => ({
        contact: contactName.get(String(row.contact_id)) ?? 'Contact', texte: row.content, date: row.observed_at,
      })),
      signaux_de_veille: (signalRows ?? []).map((row) => ({ famille: row.family, titre: row.title, resume: row.summary, date: row.observed_at })),
      recommandations_ouvertes: (openRecommendationRows ?? []).map((row) => ({ categorie: row.category, titre: row.title, justification: row.justification })),
    }

    const apiKey = Deno.env.get('OPENROUTER_API_KEY')
    if (!apiKey) throw new Error('OPENROUTER_API_KEY non configurée')
    const model = Deno.env.get('OPENROUTER_ANALYSIS_MODEL') ?? 'google/gemini-3.1-flash-lite'
    const prompt = `Tu rédiges la lecture stratégique du compte "${facts.compte}" pour le responsable qui le suit, EXCLUSIVEMENT à partir des faits ci-dessous — déjà extraits et vérifiés depuis les échanges réels (emails, réunions) et le calcul du score relationnel. N'invente RIEN qui n'y figure pas explicitement, ne suppose aucune cause non documentée. Si une catégorie n'a rien de pertinent, renvoie une liste vide pour elle plutôt que de généraliser.

Faits disponibles :
${JSON.stringify(facts, null, 2)}

Produis :
- "synthese" : 2 à 4 phrases factuelles sur l'état actuel de la relation avec ce compte (ton neutre, pas de superlatif) ;
- "forces" : jusqu'à 4 points forts observés, chacun ancré sur un fait daté quand c'est possible ;
- "risques" : jusqu'à 4 tensions ou risques observés (frictions, silences, désaccords, retards de paiement, concentration excessive...) — cherche-les activement dans les moments_cles marqués "friction" et les signaux de veille ;
- "prochaines_actions" : jusqu'à 3 actions concrètes déduites directement des risques ou opportunités identifiés ci-dessus (jamais génériques) ;
- "confidence" : 0 à 100, reflétant la quantité et la clarté des preuves disponibles.

Réponds uniquement avec ce JSON strict : {"synthese":"...","forces":[],"risques":[],"prochaines_actions":[],"confidence":0}`

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': Deno.env.get('SITE_URL') ?? 'https://tohu.app', 'X-Title': 'Tohu Account Strategic Reading' },
      body: JSON.stringify({
        model, temperature: 0.2, response_format: READING_RESPONSE_FORMAT, provider: { require_parameters: true }, max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!response.ok) throw new Error(`OpenRouter ${response.status}`)
    const data = await response.json()
    const parsed = JSON.parse(String(data.choices?.[0]?.message?.content ?? '{}')) as {
      synthese?: string; forces?: string[]; risques?: string[]; prochaines_actions?: string[]; confidence?: number
    }
    if (!parsed.synthese?.trim()) throw new Error('Réponse du modèle vide ou invalide')

    const content = {
      synthese: parsed.synthese.trim().slice(0, 1200),
      forces: (parsed.forces ?? []).map((item) => String(item).trim()).filter(Boolean).slice(0, 4),
      risques: (parsed.risques ?? []).map((item) => String(item).trim()).filter(Boolean).slice(0, 4),
      prochaines_actions: (parsed.prochaines_actions ?? []).map((item) => String(item).trim()).filter(Boolean).slice(0, 3),
    }
    const confidence = Number.isFinite(Number(parsed.confidence)) ? Math.max(0, Math.min(100, Math.round(Number(parsed.confidence)))) : null
    const generatedAt = new Date().toISOString()

    const { error: insertError } = await supabase.from('account_strategic_readings').insert({
      organization_id: organizationId, company_id: companyId, content, confidence, source_counts: sourceCounts,
      model, generated_by: user.id, generated_at: generatedAt,
    })
    if (insertError) throw insertError

    // Pont vers "Stratégie de compte" : sans ça, la lecture peut être riche
    // (seuil de preuve : 3 interactions/signaux/messages) pendant que Stratégie
    // de compte reste vide (score-batch ne couvre que 4 cas étroits : compte en
    // tension, concentration, ownership sans owner, signal de veille brut) — les
    // prochaines actions identifiées ici sont exactement ce qui doit y apparaître.
    // Remplace le lot précédent de CETTE source (le texte change d'une génération
    // à l'autre, on ne veut pas empiler les anciennes formulations).
    if (content.prochaines_actions.length) {
      await supabase.from('account_recommendations')
        .update({ status: 'dismissed' })
        .eq('organization_id', organizationId).eq('company_id', companyId)
        .eq('category', 'lecture_strategique').eq('status', 'open')
      const { error: recError } = await supabase.from('account_recommendations').insert(
        content.prochaines_actions.map((action, index) => ({
          organization_id: organizationId, company_id: companyId,
          category: 'lecture_strategique', priority: 70 - index * 5,
          title: action, justification: content.synthese, recommended_action: null,
          source_label: 'Lecture stratégique', observed_at: generatedAt,
          confidence, inference_level: 'inferred', status: 'open',
        })),
      )
      if (recError) console.error('account_recommendations insert (lecture stratégique):', recError.message)
    }

    return json({ content, confidence, source_counts: sourceCounts, model, generated_at: generatedAt, cached: false })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Génération impossible' }, 500)
  }
})
