// classify-markers — Classificateur sémantique (DÉTECTEUR, jamais un score).
// Opère sur les EXTRAITS déjà dérivés (person_key_moments.summary /
// person_memory_entries[commitment].source_excerpt) — les corps bruts ne sont pas
// stockés. Registre FERMÉ ; le LLM répond marker_id∈registre | NO_MARKER + confidence ;
// jamais un nombre d'axe. Persiste des scoring.marker_event (is_candidate selon les
// garde-fous : verbatim obligatoire S07, seuil de confiance). Idempotent (dedup_key).
// Logique validée par src/services/scoring/__tests__/semanticClassifier.test.ts.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const REGISTRY: Record<string, { sense: -1 | 1; requiresVerbatim: boolean; def: string }> = {
  C01: { sense: 1, requiresVerbatim: false, def: 'divulgation interne/personnelle non nécessaire à la tâche' },
  C05: { sense: 1, requiresVerbatim: false, def: 'jugement personnel partagé sur un tiers absent' },
  S03: { sense: -1, requiresVerbatim: false, def: 'appréciation négative explicite' },
  S06: { sense: -1, requiresVerbatim: false, def: 'désintermédiation / contournement direct' },
  S07: { sense: -1, requiresVerbatim: true, def: 'dénonciation auprès d’un tiers (verbatim obligatoire)' },
  S08: { sense: 1, requiresVerbatim: false, def: 'éloge spontané, non sollicité, hors politesse' },
  E01: { sense: 1, requiresVerbatim: false, def: 'mise en relation avec un tiers de son réseau' },
  E02: { sense: 1, requiresVerbatim: false, def: 'ouverture d’organigramme / accès à collègues/hiérarchie' },
  E03: { sense: 1, requiresVerbatim: false, def: 'projection au-delà de l’engagement courant' },
  E04: { sense: 1, requiresVerbatim: false, def: 'artefact / livrable non demandé' },
}
const ACCEPT = 0.75, VERSION = 'semantic-classifier-v1'

function prompt(text: string): string {
  const reg = Object.entries(REGISTRY).map(([id, r]) => `- ${id} : ${r.def} (sens ${r.sense >= 0 ? '+' : '−'})`).join('\n')
  return `Tu es un DÉTECTEUR de marqueurs relationnels. Tu ne produis JAMAIS de score.
Indique si l'extrait correspond EXACTEMENT à UN marqueur du REGISTRE FERMÉ, sinon NO_MARKER.
Choisis UNIQUEMENT dans cette liste (aucune invention) :
${reg}

Extrait : « ${text} »
Réponds en JSON strict : {"marker_id":"<ID>|NO_MARKER","confidence":0..1,"rationale":"<1 phrase>"}
Si tu hésites : NO_MARKER.`
}

async function classify(text: string, apiKey: string, model: string): Promise<{ marker_id: string; confidence: number; rationale: string } | null> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Tohu Semantic Classifier' },
    body: JSON.stringify({ model, temperature: 0, max_tokens: 200, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt(text) }] }),
  })
  if (!res.ok) return null
  const data = await res.json()
  try { return JSON.parse(String(data.choices?.[0]?.message?.content ?? '{}')) } catch { return null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const body = await req.json().catch(() => ({}))
  const organizationId = typeof body.organizationId === 'string' ? body.organizationId : null
  const companyId = typeof body.companyId === 'string' ? body.companyId : null
  const limit = Math.min(Number(body.limit) || 40, 100)
  if (!organizationId) return json({ error: 'organizationId requis' }, 400)
  const apiKey = Deno.env.get('OPENROUTER_API_KEY')
  if (!apiKey) return json({ error: 'OPENROUTER_API_KEY non configurée' }, 500)
  const model = Deno.env.get('OPENROUTER_ANALYSIS_MODEL') ?? 'google/gemini-3.1-flash-lite'

  // Extraits : moments (summary, pas verbatim) + engagements (source_excerpt = verbatim)
  const [{ data: moments }, { data: commitments }] = await Promise.all([
    supabase.from('person_key_moments').select('id, contact_id, occurred_at, summary, contacts!inner(company_id, organization_id)')
      .eq('contacts.organization_id', organizationId).limit(limit),
    supabase.from('person_memory_entries').select('id, contact_id, observed_at, source_occurred_at, source_excerpt, contacts!inner(company_id, organization_id)')
      .eq('contacts.organization_id', organizationId).eq('entry_type', 'commitment').limit(limit),
  ])
  const items: Array<{ id: string; contactId: string; companyId: string; text: string; observedAt: string | null; hasVerbatim: boolean }> = []
  for (const m of moments ?? []) {
    const co = (m as any).contacts?.company_id
    if (!co || (companyId && co !== companyId) || !m.summary) continue
    items.push({ id: String(m.id), contactId: String(m.contact_id), companyId: co, text: String(m.summary), observedAt: m.occurred_at as string, hasVerbatim: false })
  }
  for (const e of commitments ?? []) {
    const co = (e as any).contacts?.company_id
    if (!co || (companyId && co !== companyId) || !e.source_excerpt) continue
    items.push({ id: String(e.id), contactId: String(e.contact_id), companyId: co, text: String(e.source_excerpt), observedAt: (e.source_occurred_at ?? e.observed_at) as string, hasVerbatim: true })
  }

  let accepted = 0, candidates = 0, noMarker = 0, inserted = 0
  for (const it of items) {
    const r = await classify(it.text, apiKey, model)
    const id = (r?.marker_id ?? '').trim()
    if (!id || id === 'NO_MARKER' || !REGISTRY[id] || !it.observedAt) { noMarker++; continue }
    const entry = REGISTRY[id]!
    const confidence = Math.max(0, Math.min(1, Number(r?.confidence) || 0))
    let isCandidate = confidence < ACCEPT
    if (entry.requiresVerbatim && !it.hasVerbatim) isCandidate = true
    isCandidate ? candidates++ : accepted++
    const { error } = await supabase.schema('scoring').from('marker_event').insert({
      organization_id: organizationId, registry_version: 'reg-v6.0', marker_id: id, scope: 'person',
      contact_id: it.contactId, account_id: it.companyId, observed_at: it.observedAt, sense: entry.sense,
      measure: { confidence, rationale: String(r?.rationale ?? '').slice(0, 240) }, source: 'classifier:extract',
      evidence_ref: it.id, evidence_text: it.text.slice(0, 500), detector_version: VERSION, is_candidate: isCandidate,
      dedup_key: `sem:${id}:${it.id}`,
    })
    if (!error) inserted++
    else if (error.code !== '23505') console.error('marker insert', error.message) // 23505 = déjà présent (idempotent)
  }
  return json({ analyzed: items.length, accepted, candidates, no_marker: noMarker, inserted })
})
