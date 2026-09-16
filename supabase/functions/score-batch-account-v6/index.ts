// Batch Météo du compte (V6, shadow) — Phase 2 (voir plan de session,
// AUDIT_SCORING_V6.md, FINAL_ACCOUNT_ENGINE_V6_REPORT.md §19).
//
// Calcule et persiste scoring.score_snapshot (entity_type='account') à partir
// de DONNÉES RÉELLES uniquement, jamais fabriquées :
//   - d_ancrage    : nombre réel de porteurs internes (owners distincts).
//   - d_equilibre  : répartition réelle du volume de messages par contact.
//   - d_dynamique  : cadence/silence réels (messages+meetings) + engagements
//                    réellement tenus/glissés sur 90j (account_facts_live).
//   - d_satisfaction, d_confiance_recip : scores de dyade V6 réels par contact
//     (buildDyadScoreSnapshot sur scoring.marker_event scope='person', écrit
//     par detect-dyad-markers), pour les dyades non cold-start (P5 : ≥30j
//     d'ancienneté et ≥5 échanges). Chaque dyade est aussi PERSISTÉE
//     (scoring.score_snapshot, entity_type='dyad') pour la Fiche Personne.
//     authority=1 uniforme (account_contact_roles vide — aucun rôle qualifié).
//   - d_couverture : nécessite account_contact_roles (rôle/autorité), table
//     vide aujourd'hui → coverage.targets=[] → cadran null (honnête).
//   - kEvents (K01-K09, scope='account') : lus tels quels, vides aujourd'hui,
//     se peupleront automatiquement plus tard sans changement de code ici.
// reliability/verdict_allowed : PAS calculés dans ce lot — la formule de
// fiabilité par cadran est marquée "provisional / à construire" dans la
// doctrine (aucune valeur figée à reproduire) ; les combler avec 0 ferait
// passer le score en "grisé sans verdict" côté front (displayRule), pire que
// de les laisser NULL. Colonnes laissées NULL / verdict_allowed=false.
//
// Ne recalcule JAMAIS le score legacy (account_relationship_score_snapshots,
// géré par score-batch) : tables et logiques strictement séparées (doctrine
// "jamais mélangé", AUDIT_SCORING_V6.md §T).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { calculateAccountWeatherCore } from '../_shared/scoring-v6/calculateAccountWeatherCore.ts'
import { buildDyadScoreSnapshot } from '../_shared/scoring-v6/snapshots.ts'
import { PARAMS_V6_PALIER, REGISTRY_V6 } from '../_shared/scoring-v6/registry-v6.ts'
import type { AccountDyadInput, AccountWeatherInput, MarkerEvent } from '../_shared/scoring-v6/types.ts'

// Aucun rôle qualifié aujourd'hui (account_contact_roles vide) : profil
// "standard" par défaut — jamais "execution", qui est l'exception documentée
// du registre V6, pas la règle générale.
const UNQUALIFIED_ROLE = { label: 'Non qualifié', volontariteProfile: 'standard' as const }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

const DAY_MS = 86_400_000
const ENGAGEMENT_WINDOW_DAYS = 90

// Types de relation réels de l'app (public.account_settings.relationship_status,
// voir src/account-list/mapping.ts::RELATION_COLORS) → clé de dialWeights.
// Repli sur 'Client/Prospect' pour tout ce qui n'est pas explicitement mappé —
// même repli que calculateAccountWeatherCore lui-même.
function toDialRelationType(relationshipStatus: string | null, accountType: string | null): string {
  const v = (relationshipStatus ?? accountType ?? '').trim().toLowerCase()
  if (v.startsWith('prospect') || v.startsWith('client')) return 'Client/Prospect'
  if (v.startsWith('partenaire')) return 'Partenaire'
  if (v.startsWith('fournisseur')) return 'Fournisseur'
  if (v.startsWith('investisseur')) return 'Investisseur'
  if (v.startsWith('interne') || v.startsWith('collègue') || v.startsWith('collegue')) return 'Interne'
  return 'Client/Prospect'
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function monthStartUTC(iso: string): string {
  const d = new Date(iso)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10)
}
function monthsAgoStartUTC(iso: string, months: number): string {
  const d = new Date(iso)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, 1)).toISOString().slice(0, 10)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  const cronHeader = req.headers.get('x-cron-secret')
  let isCron = false
  if (cronHeader) {
    const { data: sec } = await supabase.from('app_secrets').select('value').eq('name', 'monitor_cron').maybeSingle()
    if (sec?.value && sec.value === cronHeader) isCron = true
  }
  if (!isCron) {
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    const segments = token.split('.')
    if (segments.length === 3) {
      try {
        const payload = JSON.parse(atob(segments[1].replace(/-/g, '+').replace(/_/g, '/')))
        if (payload?.role === 'service_role') isCron = true
      } catch { /* token non décodable : ignoré */ }
    }
  }
  if (!isCron) return jsonResponse({ error: 'Forbidden' }, 403)

  const now = new Date()
  const nowIso = now.toISOString()
  const currentMonth = monthStartUTC(nowIso)
  const previousMonth = monthsAgoStartUTC(nowIso, 1)
  const engagementCutoff = new Date(now.getTime() - ENGAGEMENT_WINDOW_DAYS * DAY_MS).toISOString()

  const { data: companies, error: companiesErr } = await supabase
    .from('companies')
    .select('id, organization_id, account_type, account_settings(archived_at, relationship_status, primary_owner_user_id)')
  if (companiesErr) return jsonResponse({ error: companiesErr.message }, 500)

  let processed = 0
  let scored = 0
  const errors: Array<{ companyId: string; message: string }> = []

  for (const row of (companies ?? []) as any[]) {
    const companyId = String(row.id)
    const organizationId = String(row.organization_id)
    const settings = Array.isArray(row.account_settings) ? row.account_settings[0] : row.account_settings
    if (settings?.archived_at) continue // compte archivé : hors calcul (doctrine implicite, même filtre que account_brain)

    try {
      // scoring.* n'est pas un schéma exposé côté PostgREST (réglage projet, pas
      // une migration) : lu/écrit via des RPC public.* SECURITY DEFINER, même
      // schéma d'accès que public.account_brain — voir migration
      // account_weather_v6_scoring_schema_rpcs.
      const [contactsRes, kEventsRes, factsRes] = await Promise.all([
        supabase.from('contacts').select('id, owner_user_id').eq('company_id', companyId).is('merged_into_contact_id', null),
        supabase.rpc('get_account_k_marker_events', { p_company_id: companyId }),
        supabase.from('account_facts_live').select('status, resolved_at, is_overdue, occurred_at')
          .eq('company_id', companyId).eq('fact_type', 'commitment').gte('occurred_at', engagementCutoff),
      ])
      const contacts = (contactsRes.data ?? []) as Array<{ id: string; owner_user_id: string | null }>
      const contactIds = contacts.map((c) => c.id)

      let messages: Array<{ contact_id: string; sent_at: string }> = []
      let meetingTimes: string[] = []
      if (contactIds.length > 0) {
        const { data } = await supabase.from('communication_messages').select('contact_id, sent_at').in('contact_id', contactIds)
        messages = (data ?? []) as typeof messages
      }
      {
        const { data } = await supabase.from('meetings').select('starts_at').eq('company_id', companyId)
        meetingTimes = ((data ?? []) as Array<{ starts_at: string }>).map((m) => m.starts_at)
      }

      // ── equilibreShares : volume réel de messages par contact ──────────
      const countByContact = new Map<string, number>()
      for (const msg of messages) countByContact.set(msg.contact_id, (countByContact.get(msg.contact_id) ?? 0) + 1)
      const equilibreShares = contactIds.map((id) => countByContact.get(id) ?? 0).filter((n) => n > 0)

      // ── Dyades V6 par contact : snapshot PERSISTÉ (scoring.score_snapshot,
      // entity_type='dyad') pour chaque contact ayant au moins un échange réel
      // — pas seulement ceux « actifs » côté compte. Réutilisé par la Fiche
      // Personne (get_dyad_weather_snapshot) ET par les cadrans Satisfaction/
      // Confiance & réciprocité du compte (activeDyads, dyades non cold-start
      // uniquement). authority=1 uniforme tant qu'aucun rôle n'est qualifié
      // (account_contact_roles vide) — pondération neutre, jamais un score
      // fabriqué. Fiabilité : channelCoverage/identityResolution/
      // diarizationQuality fixées à 1 (non mesurables aujourd'hui, cf. audit
      // detectors.ts) — seul le volume réel de marqueurs fait varier la fiabilité.
      const activeDyads: AccountDyadInput[] = []
      for (const contactId of contactIds) {
        const contactMessages = messages.filter((m) => m.contact_id === contactId).map((m) => new Date(m.sent_at).getTime()).sort((a, b) => a - b)
        if (contactMessages.length === 0) continue
        const ageDays = Math.max(0, Math.round((now.getTime() - contactMessages[0]!) / DAY_MS))
        const episodes = contactMessages.length
        const contactDaysSinceLast = Math.max(0, Math.round((now.getTime() - contactMessages[contactMessages.length - 1]!) / DAY_MS))
        const contactGaps = contactMessages.slice(1).map((t, i) => (t - contactMessages[i]!) / DAY_MS).sort((a, b) => a - b)
        const contactCadenceMedian = median(contactGaps)

        const { data: eventRows } = await supabase.rpc('get_person_marker_events', { p_contact_id: contactId })
        const events: MarkerEvent[] = ((eventRows ?? []) as Array<{ marker_id: string; sense: number; observed_at: string; evidence_ref: string }>)
          .map((e) => ({ markerId: e.marker_id, sense: (e.sense >= 0 ? 1 : -1) as -1 | 1, observedAt: e.observed_at, evidenceRef: e.evidence_ref }))

        const snapshot = buildDyadScoreSnapshot({
          markerEvents: events, role: UNQUALIFIED_ROLE, at: nowIso,
          context: { ageDays, episodes, daysSinceLast: contactDaysSinceLast, cadenceMedian: contactCadenceMedian, hasX02: false },
          reliabilityInputs: { channelCoverage: 1, identityResolution: 1, diarizationQuality: 1 },
          params: PARAMS_V6_PALIER, registry: REGISTRY_V6,
        })

        const { error: dyadErr } = await supabase.rpc('upsert_dyad_weather_snapshot', {
          p_organization_id: organizationId, p_contact_id: contactId, p_account_id: companyId,
          p_at: nowIso, p_snapshot_month: currentMonth,
          p_params_version: snapshot.paramsVersion, p_registry_version: snapshot.registryVersion,
          p_axes: snapshot.core?.axes ?? null, p_score: snapshot.score,
          p_reliability: snapshot.reliability, p_verdict_allowed: snapshot.verdictAllowed, p_status: snapshot.status,
        })
        if (dyadErr) throw new Error(`dyad ${contactId}: ${dyadErr.message}`)

        if (!snapshot.coldStart && snapshot.core) {
          activeDyads.push({ contactId, authority: 1, satisfaction: snapshot.core.axes.satisfaction.value, confiance: snapshot.core.axes.confiance.value, reciprocite: snapshot.core.axes.reciprocite.value })
        }
      }

      // ── carriers : porteurs internes réels distincts ───────────────────
      const carrierIds = new Set<string>()
      for (const c of contacts) if (c.owner_user_id) carrierIds.add(c.owner_user_id)
      if (settings?.primary_owner_user_id) carrierIds.add(settings.primary_owner_user_id)
      const carriers = carrierIds.size

      // ── dynamics : cadence/silence réels + engagements réels sur 90j ───
      const allTimes = [...messages.map((m) => m.sent_at), ...meetingTimes].map((t) => new Date(t).getTime()).filter((t) => Number.isFinite(t)).sort((a, b) => a - b)
      const daysSinceLast = allTimes.length ? Math.max(0, Math.round((now.getTime() - allTimes[allTimes.length - 1]!) / DAY_MS)) : 0
      const gaps = allTimes.slice(1).map((t, i) => (t - allTimes[i]!) / DAY_MS).sort((a, b) => a - b)
      const cadenceMedian = median(gaps)
      const facts = (factsRes.data ?? []) as Array<{ status: string | null; resolved_at: string | null; is_overdue: boolean | null }>
      const engagementsHeld = facts.filter((f) => f.resolved_at && !f.is_overdue).length
      const engagementsSlipped = facts.filter((f) => f.is_overdue).length

      // ── kEvents : marqueurs compte réels (vides aujourd'hui, honnête) —
      // agrégés par marker_id (occurrences = nb de lignes non résolues ; K01 :
      // ancienneté en mois depuis la 1ère occurrence non résolue, pour le
      // plafond "ouvert > 12 mois"). evidence_ref/observed_at proviennent de
      // scoring.marker_event (même table que get_person_marker_events, qui
      // expose déjà evidence_ref) — on les conserve pour la traçabilité
      // « Preuves » de la Météo, jamais utilisés dans le calcul lui-même.
      const kRows = (kEventsRes.data ?? []) as Array<{ marker_id: string; observed_at: string; evidence_ref?: string | null }>
      const byMarker = new Map<string, Array<{ observedAt: string; evidenceRef: string | null }>>()
      for (const k of kRows) byMarker.set(k.marker_id, [...(byMarker.get(k.marker_id) ?? []), { observedAt: k.observed_at, evidenceRef: k.evidence_ref ?? null }])
      const kEvents = [...byMarker.entries()].map(([markerId, occs]) => {
        const earliest = occs.reduce((a, b) => (a.observedAt < b.observedAt ? a : b))
        const openMonths = markerId === 'K01' ? Math.floor((now.getTime() - new Date(earliest.observedAt).getTime()) / (DAY_MS * 30.44)) : undefined
        return { markerId, observedAt: earliest.observedAt, resolvedAt: null, occurrences: occs.length, openMonths, evidenceRef: earliest.evidenceRef ?? '' }
      })

      // Aucun historique réel du tout : ne pas écrire de snapshot (rien à mesurer).
      if (allTimes.length === 0 && kEvents.length === 0 && carriers === 0) { processed++; continue }

      const input: AccountWeatherInput = {
        relationType: toDialRelationType(settings?.relationship_status ?? null, row.account_type ?? null),
        activeDyads,
        coverage: { targets: [] }, // account_contact_roles vide aujourd'hui — cadran couverture reste null
        equilibreShares,
        carriers,
        kEvents,
        dynamics: { delta30OtherDials: 0, daysSinceLast, cadenceMedian, engagementsHeld, engagementsSlipped },
        at: nowIso,
      }
      const result = calculateAccountWeatherCore(input, PARAMS_V6_PALIER, REGISTRY_V6)

      const { data: prevScore } = await supabase.rpc('get_account_prev_weather_score', {
        p_company_id: companyId, p_snapshot_month: previousMonth,
        p_params_version: result.paramsVersion, p_registry_version: result.registryVersion,
      })
      const delta30d = prevScore != null && result.score != null ? result.score - Number(prevScore) : null

      const { error: upsertErr } = await supabase.rpc('upsert_account_weather_snapshot', {
        p_organization_id: organizationId,
        p_company_id: companyId,
        p_at: nowIso,
        p_snapshot_month: currentMonth,
        p_params_version: result.paramsVersion,
        p_registry_version: result.registryVersion,
        p_dials: result.dials,
        p_score: result.score,
        p_weakest_dial: result.weakestDial,
        p_delta_30d: delta30d,
      })
      if (upsertErr) throw new Error(upsertErr.message)

      scored++
      processed++
    } catch (err) {
      errors.push({ companyId, message: err instanceof Error ? err.message : String(err) })
      processed++
    }
  }

  return jsonResponse({ processed, scored, errors })
})
