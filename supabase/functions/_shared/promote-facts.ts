// ─────────────────────────────────────────────────────────────────────────────
// promote-facts — M2 : PROMOTION DÉTERMINISTE vers account_facts.
//
// DOCTRINE (verrouillée) :
//   • PROMOTION = transformer une donnée DÉJÀ existante et suffisamment certaine
//     (un person_key_moment, un engagement extrait) en mémoire compte. 1:1,
//     fidèle, sans nouvelle affirmation sémantique.
//   • INFÉRENCE = déduire quelque chose qui n'existe PAS explicitement (risque,
//     opportunité, objectif, blocage…). ⚠️ HORS M2. On ne fabrique pas un fait
//     interprétatif juste parce qu'un LLM saurait le déduire.
//
// Ce module ne fait QUE de la promotion :
//   person_key_moments               → account_facts(fact_type='event'|'milestone')
//   person_memory_entries[commitment]→ account_facts(fact_type='commitment')
// Aucune écriture de risque/opportunité/objectif ici. Aucun appel LLM.
// Aucune donnée inventée : une absence d'information ne devient jamais un fait.
//
// Idempotent : rejouer produit 0 fait neuf, 0 preuve dupliquée (sauf source
// réellement modifiée → last_seen_at/champs rafraîchis, jamais de doublon).
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Types ────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>

export type PromoteOptions = {
  organizationId: string
  companyId?: string          // limité à un compte (backfill témoin) ; sinon tous les comptes de l'org
  dryRun?: boolean            // true = ne rien écrire, renvoyer l'aperçu (revue + témoin)
}

type EvidenceDraft = {
  source_type: string         // 'email' | 'meeting' | 'transcript' | 'note' | …
  source_id: string           // stable → clé d'idempotence (unique(fact_id, source_type, source_id))
  source_url: string | null
  source_label: string | null
  occurred_at: string | null  // date RÉELLE de la preuve
  excerpt: string | null      // verbatim quand on l'a (commitment.source_excerpt)
  contact_id: string | null   // personne concernée par CETTE preuve
  confidence: number | null
}

type FactDraft = {
  dedup_key: string
  fact_type: string
  title: string
  detail: string | null
  impact: string | null
  status: 'active' | 'resolved'
  occurred_at: string | null      // date réelle de l'événement (base du delta)
  first_seen_at: string           // 1re détection Tohu (created_at de la source, PAS l'instant de promotion)
  last_seen_at: string            // dernière (re)confirmation (updated_at de la source)
  resolved_at: string | null
  subject_contact_id: string | null
  owner_contact_id: string | null
  owner_user_id: string | null
  due_text_original: string | null
  due_at: string | null
  due_window_start: string | null
  due_window_end: string | null
  due_at_precision: string | null
  due_is_inferred: boolean
  due_confidence: number | null
  confidence: number | null
  inference_level: 'fact' | 'strong_inference' | 'inferred'
  producer: string
  source_ref: Row
  evidence: EvidenceDraft[]
}

// ── Helpers purs (testables sans DB) ─────────────────────────────────────────

/** Miroir TS de public.normalize_signal_content : minuscule, non-alphanum→espace,
 *  espaces réduits, trim. Sert de base au dedup_key stable et lisible. */
export function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // enlève les accents
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * dedup_key ULTRA-CONSERVATEUR (doctrine M2 : promotion fidèle, aucun merge
 * interprétatif). Deux sources ne fusionnent en UN fait QUE si elles partagent
 * une IDENTITÉ DE SOURCE FORTE ET CERTAINE (même meeting_id, même thread/email_id,
 * même source_ref/document, même URL canonique…). Sinon → clé propre à la ligne
 * source : AUCUNE fusion cross-source, même à titre ET date identiques.
 *   En cas de doute → deux faits.
 * `title + date` ne sert JAMAIS de règle de merge destructive en M2 (au mieux,
 * plus tard, un signalement non destructif de « doublon candidat »).
 * Idempotent : une même ligne source rejouée redonne toujours la même clé
 * (indépendante du titre/impact, qui peuvent être recalculés).
 */
export function dedupKey(ownSourceId: string, strongSharedId?: string | null): string {
  const shared = typeof strongSharedId === 'string' ? strongSharedId.trim() : ''
  return (shared ? `shared:${shared}` : ownSourceId).slice(0, 300)
}

/** Mappe le source_type métier (email_analysis, transcript…) vers la taxonomie
 *  fermée de account_fact_evidence.source_type. */
export function evidenceSourceType(sourceType: string | null | undefined): string {
  const s = (sourceType ?? '').toLowerCase()
  if (s.includes('transcript')) return 'transcript'
  if (s.includes('meeting')) return 'meeting'
  if (s.includes('email')) return 'email'   // 'email_analysis' → 'email'
  if (s.includes('crm') || s.includes('hubspot') || s.includes('notion')) return 'crm'
  if (s.includes('signal')) return 'signal'
  return 'note'
}

export type ParsedDue = {
  title: string                 // contenu SANS la mention d'échéance
  due_text_original: string | null
  due_at: string | null
  due_window_start: string | null
  due_window_end: string | null
  due_at_precision: string | null
  due_is_inferred: boolean
}

/**
 * Parse déterministe d'une échéance depuis le texte d'un engagement.
 * RÈGLE : ne JAMAIS fabriquer une précision absente.
 *   • « … — échéance 2026-09-18 »      → precision='day', fenêtre = ce jour, is_inferred=false
 *   • « … — échéance 2026-09-18T17:00 »→ precision='exact', due_at=ce timestamp
 *   • « … — échéance d'ici vendredi »  → precision='unknown', texte conservé, is_inferred=true,
 *                                        aucune date fabriquée (fallback LLM = étape ultérieure)
 *   • pas de mention                   → aucune échéance (title = contenu entier)
 */
export function parseDue(content: string): ParsedDue {
  const none: ParsedDue = {
    title: content.trim(), due_text_original: null, due_at: null,
    due_window_start: null, due_window_end: null, due_at_precision: null, due_is_inferred: false,
  }
  const m = content.match(/[—-]\s*[ée]ch[ée]ance\s*[:\s]\s*(.+)$/i)
  if (!m) return none
  const title = content.slice(0, m.index).replace(/[—-]\s*$/, '').trim()
  const dueText = m[1]!.trim()

  // ISO datetime → précision exacte
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dueText)) {
    const d = new Date(dueText)
    if (Number.isFinite(d.getTime())) {
      return { title, due_text_original: dueText, due_at: d.toISOString(),
        due_window_start: null, due_window_end: null, due_at_precision: 'exact', due_is_inferred: false }
    }
  }
  // ISO date (jour) → fenêtre = la journée entière, aucune heure fabriquée
  if (/^\d{4}-\d{2}-\d{2}$/.test(dueText)) {
    const start = new Date(`${dueText}T00:00:00.000Z`)
    const end = new Date(`${dueText}T23:59:59.999Z`)
    if (Number.isFinite(start.getTime())) {
      return { title, due_text_original: dueText, due_at: start.toISOString(),
        due_window_start: start.toISOString(), due_window_end: end.toISOString(),
        due_at_precision: 'day', due_is_inferred: false }
    }
  }
  // Texte libre → granularité inconnue : on garde le verbatim, on ne fabrique RIEN.
  return { title, due_text_original: dueText, due_at: null,
    due_window_start: null, due_window_end: null, due_at_precision: 'unknown', due_is_inferred: true }
}

/** person_key_moment → FactDraft (PROMOTION). impact 'milestone' → type 'milestone',
 *  sinon 'event'. On conserve impact tel quel ; on n'upgrade jamais en 'fact'
 *  (un moment est une extraction, donc 'strong_inference'). */
export function momentToFact(moment: Row, companyId: string): FactDraft | null {
  const title = String(moment.title ?? '').trim()
  const occurredAt = typeof moment.occurred_at === 'string' ? moment.occurred_at : null
  if (!title || !occurredAt) return null          // absence de matière → pas de fait

  const impact = ['friction', 'reinforce', 'milestone'].includes(String(moment.impact))
    ? String(moment.impact) : 'neutral'
  const factType = impact === 'milestone' ? 'milestone' : 'event'
  const contactId = String(moment.contact_id)
  const createdAt = typeof moment.created_at === 'string' ? moment.created_at : occurredAt
  const updatedAt = typeof moment.updated_at === 'string' ? moment.updated_at : createdAt

  return {
    // aucune identité de source partagée sur un moment → clé propre à la ligne :
    // pas de fusion cross-source, deux moments = deux faits (doctrine M2).
    dedup_key: dedupKey(`moment:${moment.id}`),
    fact_type: factType,
    title,
    detail: typeof moment.summary === 'string' ? moment.summary : null,
    impact,
    // 'active' = fait VALIDE / non rétracté (pas « action ouverte ») : un événement
    // historique reste dans la mémoire vive et alimente « Historique & mémoire ».
    status: 'active',
    occurred_at: occurredAt,                       // date RÉELLE
    first_seen_at: createdAt,                      // détection Tohu (jamais l'instant de promotion)
    last_seen_at: updatedAt,
    resolved_at: null,
    subject_contact_id: contactId,
    owner_contact_id: null,
    owner_user_id: null,
    due_text_original: null, due_at: null, due_window_start: null, due_window_end: null,
    due_at_precision: null, due_is_inferred: false, due_confidence: null,
    confidence: numOrNull(moment.confidence),
    inference_level: 'strong_inference',           // extraction LLM, jamais un fait brut observé
    producer: 'promote_moments',
    source_ref: { person_key_moment_id: moment.id, contact_id: contactId },
    evidence: [{
      source_type: evidenceSourceType(String(moment.source_type)),
      source_id: `moment:${moment.id}`,
      source_url: null,
      source_label: typeof moment.source_label === 'string' ? moment.source_label : 'Tohu · moment détecté',
      occurred_at: occurredAt,
      excerpt: typeof moment.summary === 'string' ? moment.summary : null, // résumé, pas verbatim strict
      contact_id: contactId,
      confidence: numOrNull(moment.confidence),
    }],
  }
}

/** commitment (person_memory_entries) → FactDraft (PROMOTION). resolved_at présent
 *  → status='resolved' (ne réapparaît jamais comme actif).
 *  OWNER : NON déduit. `source_direction` = sens du message source (reçu/envoyé),
 *  PAS le responsable de l'engagement ; le champ `owner` réellement extrait n'est
 *  pas persisté aujourd'hui. En l'absence de donnée fiable → owner null. */
export function commitmentToFact(entry: Row, companyId: string): FactDraft | null {
  const raw = String(entry.content ?? '').trim()
  if (!raw || normalizeText(raw) === '') return null    // absence → pas de fait

  const due = parseDue(raw)
  const title = due.title || raw
  const contactId = String(entry.contact_id)
  const resolvedAt = typeof entry.resolved_at === 'string' ? entry.resolved_at : null
  const observedAt = typeof entry.source_occurred_at === 'string' ? entry.source_occurred_at
    : typeof entry.observed_at === 'string' ? entry.observed_at : null
  const createdAt = typeof entry.created_at === 'string' ? entry.created_at : (observedAt ?? new Date().toISOString())
  const updatedAt = typeof entry.updated_at === 'string' ? entry.updated_at : createdAt

  const inferenceLevel = (['fact', 'strong_inference', 'inferred'] as const)
    .includes(entry.inference_level as any) ? entry.inference_level as FactDraft['inference_level'] : 'strong_inference'

  return {
    // aucune identité de source partagée + owner non persisté → clé propre à la
    // ligne : jamais de fusion cross-source pour un engagement en M2.
    dedup_key: dedupKey(`commitment:${entry.id}`),
    fact_type: 'commitment',
    title,
    detail: null,
    impact: null,                                  // un engagement n'est ni friction ni reinforce en soi
    status: resolvedAt ? 'resolved' : 'active',
    occurred_at: observedAt,                       // date réelle où l'engagement a été formulé
    first_seen_at: createdAt,
    last_seen_at: updatedAt,
    resolved_at: resolvedAt,
    subject_contact_id: contactId,                 // fait rattaché à ce contact (factuel)
    owner_contact_id: null,                        // responsable NON déduit (owner non persisté)
    owner_user_id: null,
    due_text_original: due.due_text_original,
    due_at: due.due_at,
    due_window_start: due.due_window_start,
    due_window_end: due.due_window_end,
    due_at_precision: due.due_at_precision,
    due_is_inferred: due.due_is_inferred,
    due_confidence: due.due_at_precision ? numOrNull(entry.confidence) : null,
    confidence: numOrNull(entry.confidence),
    inference_level: inferenceLevel,
    producer: 'promote_commitments',
    source_ref: { person_memory_entry_id: entry.id, contact_id: contactId },
    evidence: [{
      source_type: evidenceSourceType(String(entry.source_type)),
      source_id: `commitment:${entry.id}`,
      source_url: null,
      source_label: typeof entry.source_label === 'string' ? entry.source_label : 'Tohu · engagement détecté',
      occurred_at: typeof entry.source_occurred_at === 'string' ? entry.source_occurred_at : observedAt,
      excerpt: typeof entry.source_excerpt === 'string' ? entry.source_excerpt : null, // verbatim réel
      contact_id: contactId,
      confidence: numOrNull(entry.confidence),
    }],
  }
}

function numOrNull(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Regroupe les drafts partageant EXACTEMENT le même dedup_key. En M2 cela ne se
 * produit QUE pour une même ligne source rejouée, ou pour des sources à identité
 * FORTE partagée (même meeting_id/thread/URL) — jamais sur une simple
 * coïncidence titre+date. Deux moments/engagements distincts restent donc deux
 * faits. La fonction reste générique (1 fait, N preuves) pour le jour où des
 * identités partagées existeront (signaux, réunions).
 */
export function mergeDrafts(drafts: FactDraft[]): FactDraft[] {
  const byKey = new Map<string, FactDraft>()
  for (const d of drafts) {
    const existing = byKey.get(d.dedup_key)
    if (!existing) { byKey.set(d.dedup_key, { ...d, evidence: [...d.evidence] }); continue }
    // Fusion temporelle fidèle : plus ancienne détection, événement le plus
    // ancien, dernière (re)confirmation la plus récente.
    existing.first_seen_at = min(existing.first_seen_at, d.first_seen_at)
    existing.last_seen_at = max(existing.last_seen_at, d.last_seen_at)
    existing.occurred_at = minNullable(existing.occurred_at, d.occurred_at)
    // Un engagement tenu par l'un ne « ré-ouvre » jamais le fait résolu.
    if (existing.status === 'resolved' || d.status === 'resolved') {
      existing.status = existing.status === 'resolved' ? existing.status : d.status
      existing.resolved_at = minNullable(existing.resolved_at, d.resolved_at) ?? existing.resolved_at ?? d.resolved_at
    }
    existing.confidence = maxNullable(existing.confidence, d.confidence)
    // preuves dédupliquées par (source_type, source_id)
    for (const ev of d.evidence) {
      if (!existing.evidence.some((e) => e.source_type === ev.source_type && e.source_id === ev.source_id)) {
        existing.evidence.push(ev)
      }
    }
  }
  return [...byKey.values()]
}

const min = (a: string, b: string) => (a < b ? a : b)
const max = (a: string, b: string) => (a > b ? a : b)
const minNullable = (a: string | null, b: string | null) => (a && b ? min(a, b) : a ?? b)
const maxNullable = (a: number | null, b: number | null) => (a != null && b != null ? Math.max(a, b) : a ?? b)
/** Égalité par INSTANT, pas par chaîne : '…+00:00' et '…000Z' représentent le
 *  même moment. Sans ça, la détection de changement flaggerait un faux update. */
function sameInstant(a: unknown, b: unknown): boolean {
  const sa = a == null ? null : String(a), sb = b == null ? null : String(b)
  if (!sa && !sb) return true
  if (!sa || !sb) return false
  const ta = new Date(sa).getTime(), tb = new Date(sb).getTime()
  return Number.isFinite(ta) && Number.isFinite(tb) ? ta === tb : sa === sb
}

// ── Runner (I/O) ─────────────────────────────────────────────────────────────

export type PromoteReport = {
  companyId: string
  dryRun: boolean
  sourceCounts: { moments: number; commitments: number }
  totals: { facts_new: number; facts_updated: number; facts_noop: number; evidence_new: number; evidence_dup: number }
  skipped: Array<{ reason: string; count: number }>
  facts: Array<{
    dedup_key: string; fact_type: string; title: string; status: string
    occurred_at: string | null; due_at: string | null
    due_window: string | null; due_precision: string | null; due_is_inferred: boolean
    confidence: number | null; inference_level: string
    subjects: string[]; evidence_count: number; sources: string[]; origin: string
    action: 'insert' | 'update' | 'noop'
  }>
}

export async function promoteAccountFacts(client: SupabaseClient, opts: PromoteOptions): Promise<PromoteReport[]> {
  const { organizationId, companyId, dryRun = false } = opts

  // 1. Contacts trackés du périmètre → map contact→company + nom. Un moment/
  //    engagement sans company_id n'est JAMAIS promu (absence ≠ fait compte).
  let contactQuery = client.from('contacts')
    .select('id, full_name, company_id, merged_into_contact_id')
    .eq('organization_id', organizationId).not('company_id', 'is', null)
  if (companyId) contactQuery = contactQuery.eq('company_id', companyId)
  const { data: contactRows, error: contactErr } = await contactQuery
  if (contactErr) throw contactErr

  const contactCompany = new Map<string, string>()
  const contactName = new Map<string, string>()
  for (const c of (contactRows ?? []) as Row[]) {
    contactCompany.set(String(c.id), String(c.company_id))
    contactName.set(String(c.id), String(c.full_name ?? 'Contact'))
  }
  const contactIds = [...contactCompany.keys()]
  if (!contactIds.length) return []

  // 2. Sources à promouvoir
  const [{ data: moments, error: mErr }, { data: commitments, error: cErr }] = await Promise.all([
    client.from('person_key_moments')
      .select('id, contact_id, occurred_at, title, summary, impact, confidence, source_type, source_label, created_at, updated_at')
      .in('contact_id', contactIds),
    client.from('person_memory_entries')
      .select('id, contact_id, content, confidence, inference_level, source_type, source_label, observed_at, source_occurred_at, source_excerpt, resolved_at, created_at, updated_at')
      .eq('entry_type', 'commitment').in('contact_id', contactIds),
  ])
  if (mErr) throw mErr
  if (cErr) throw cErr

  // 3. Regroupement PAR COMPTE (le fait est company-level)
  const perCompany = new Map<string, FactDraft[]>()
  const skip = new Map<string, number>()
  const bump = (r: string) => skip.set(r, (skip.get(r) ?? 0) + 1)
  const push = (companyId: string, draft: FactDraft | null, reason: string) => {
    if (!draft) { bump(reason); return }
    if (!perCompany.has(companyId)) perCompany.set(companyId, [])
    perCompany.get(companyId)!.push(draft)
  }
  for (const m of (moments ?? []) as Row[]) {
    const cid = contactCompany.get(String(m.contact_id)); if (!cid) { bump('moment_sans_company'); continue }
    push(cid, momentToFact(m, cid), 'moment_vide_ou_sans_date')
  }
  for (const e of (commitments ?? []) as Row[]) {
    const cid = contactCompany.get(String(e.contact_id)); if (!cid) { bump('commitment_sans_company'); continue }
    push(cid, commitmentToFact(e, cid), 'commitment_vide')
  }

  const reports: PromoteReport[] = []
  for (const [cid, rawDrafts] of perCompany) {
    const drafts = mergeDrafts(rawDrafts)   // multi-contact → 1 fait + N preuves
    reports.push(await reconcileCompany(client, organizationId, cid, drafts, contactName, {
      moments: (moments ?? []).filter((m: Row) => contactCompany.get(String(m.contact_id)) === cid).length,
      commitments: (commitments ?? []).filter((e: Row) => contactCompany.get(String(e.contact_id)) === cid).length,
    }, dryRun, skip))
  }
  return reports
}

/**
 * Réconcilie les drafts d'UN compte avec l'existant : décide insert / update /
 * noop (idempotence), attache les preuves manquantes. Ne réécrit JAMAIS un fait
 * résolu vers actif, ne recule jamais first_seen_at.
 */
async function reconcileCompany(
  client: SupabaseClient, organizationId: string, companyId: string, drafts: FactDraft[],
  contactName: Map<string, string>, sourceCounts: { moments: number; commitments: number },
  dryRun: boolean, skip: Map<string, number>,
): Promise<PromoteReport> {
  // État existant (produit par promotion uniquement) indexé par dedup_key.
  const { data: existingFacts } = await client.from('account_facts')
    .select('id, dedup_key, status, first_seen_at, last_seen_at, due_at, occurred_at, producer')
    .eq('organization_id', organizationId).eq('company_id', companyId)
    .in('producer', ['promote_moments', 'promote_commitments'])
  const byKey = new Map((existingFacts ?? []).map((f: Row) => [String(f.dedup_key), f]))

  const factIds = (existingFacts ?? []).map((f: Row) => String(f.id))
  const { data: existingEvidence } = factIds.length
    ? await client.from('account_fact_evidence').select('fact_id, source_type, source_id').in('fact_id', factIds)
    : { data: [] as Row[] }
  const evidenceKey = new Set((existingEvidence ?? []).map((e: Row) => `${e.fact_id}|${e.source_type}|${e.source_id}`))

  let factsNew = 0, factsUpdated = 0, factsNoop = 0, evidenceNew = 0, evidenceDup = 0
  const factLines: PromoteReport['facts'] = []

  for (const d of drafts) {
    const existing = byKey.get(d.dedup_key)
    let action: 'insert' | 'update' | 'noop' = 'insert'
    let factId: string | null = existing ? String(existing.id) : null

    if (existing) {
      // Rafraîchissement minimal, jamais destructif ni régressif. Comparaisons
      // de dates par INSTANT (sameInstant) pour éviter les faux updates dus au
      // format ('+00:00' vs 'Z').
      const existLastMs = existing.last_seen_at ? new Date(String(existing.last_seen_at)).getTime() : 0
      const nextLastSeen = new Date(d.last_seen_at).getTime() > existLastMs ? d.last_seen_at : String(existing.last_seen_at)
      const wantStatus = existing.status === 'resolved' ? 'resolved' : d.status // ne ré-ouvre jamais
      const changed = !sameInstant(nextLastSeen, existing.last_seen_at) || wantStatus !== String(existing.status)
        || !sameInstant(d.due_at, existing.due_at)
      action = changed ? 'update' : 'noop'
      if (changed && !dryRun) {
        await client.from('account_facts').update({
          last_seen_at: nextLastSeen, status: wantStatus,
          resolved_at: wantStatus === 'resolved' ? d.resolved_at : null,
          due_at: d.due_at, due_window_start: d.due_window_start, due_window_end: d.due_window_end,
          due_at_precision: d.due_at_precision, due_is_inferred: d.due_is_inferred, due_text_original: d.due_text_original,
          updated_at: new Date().toISOString(),
        }).eq('id', existing.id)
      }
      changed ? factsUpdated++ : factsNoop++
    } else {
      if (!dryRun) {
        const { data: inserted, error } = await client.from('account_facts').insert({
          organization_id: organizationId, company_id: companyId,
          fact_type: d.fact_type, title: d.title, detail: d.detail, impact: d.impact, status: d.status,
          occurred_at: d.occurred_at, first_seen_at: d.first_seen_at, last_seen_at: d.last_seen_at,
          resolved_at: d.resolved_at, subject_contact_id: d.subject_contact_id,
          owner_contact_id: d.owner_contact_id, owner_user_id: d.owner_user_id,
          due_text_original: d.due_text_original, due_at: d.due_at,
          due_window_start: d.due_window_start, due_window_end: d.due_window_end,
          due_at_precision: d.due_at_precision, due_is_inferred: d.due_is_inferred, due_confidence: d.due_confidence,
          confidence: d.confidence, inference_level: d.inference_level,
          dedup_key: d.dedup_key, producer: d.producer, source_ref: d.source_ref,
        }).select('id').single()
        if (error) throw error
        factId = String(inserted!.id)
      }
      factsNew++
    }

    // Preuves : insert des manquantes uniquement (idempotent).
    for (const ev of d.evidence) {
      const k = factId ? `${factId}|${ev.source_type}|${ev.source_id}` : null
      if (k && evidenceKey.has(k)) { evidenceDup++; continue }
      evidenceNew++
      if (!dryRun && factId) {
        await client.from('account_fact_evidence').insert({
          fact_id: factId, organization_id: organizationId, company_id: companyId,
          source_type: ev.source_type, source_id: ev.source_id, source_url: ev.source_url,
          source_label: ev.source_label, occurred_at: ev.occurred_at, excerpt: ev.excerpt,
          contact_id: ev.contact_id, confidence: ev.confidence,
        })
        if (k) evidenceKey.add(k)
      }
    }

    factLines.push({
      dedup_key: d.dedup_key, fact_type: d.fact_type, title: d.title, status: d.status,
      occurred_at: d.occurred_at, due_at: d.due_at,
      due_window: d.due_window_start && d.due_window_end ? `${d.due_window_start} → ${d.due_window_end}` : null,
      due_precision: d.due_at_precision, due_is_inferred: d.due_is_inferred,
      confidence: d.confidence, inference_level: d.inference_level,
      subjects: [...new Set(d.evidence.map((e) => e.contact_id).filter(Boolean).map((id) => contactName.get(String(id)) ?? String(id)))],
      evidence_count: d.evidence.length,
      sources: [...new Set(d.evidence.map((e) => e.source_label ?? e.source_type).filter(Boolean) as string[])],
      origin: d.evidence.map((e) => e.source_id).join(', '),
      action,
    })
  }

  return {
    companyId, dryRun, sourceCounts,
    totals: { facts_new: factsNew, facts_updated: factsUpdated, facts_noop: factsNoop, evidence_new: evidenceNew, evidence_dup: evidenceDup },
    skipped: [...skip.entries()].map(([reason, count]) => ({ reason, count })),
    facts: factLines,
  }
}
