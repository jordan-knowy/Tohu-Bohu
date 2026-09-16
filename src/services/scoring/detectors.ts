// Détecteurs DÉTERMINISTES V6 — purs, sans DB/LLM. Produisent des marker_event
// « drafts » (preuve + date obligatoires) à partir des données RÉELLES disponibles
// (communication_messages, meetings). Un draft n'entre PAS dans le score tant qu'il
// n'est pas persisté ; un draft `candidate` n'entre jamais tel quel (validation requise).
//
// Disponibilité auditée le 2026-09-14 :
//   • messages : thread_id, direction, sent_at, subject → OK (latence, cadence, threads)
//   • meetings + meeting_participants → OK (présence), MAIS response_status = 'needsAction'
//     uniquement → pas d'accept/decline → E05 = candidate_only
//   • cc réel non capté (metadata: from/to seulement) → C02 blocked_by_missing_source
//   • corps non stocké (analyzed_without_body_storage) → C03/S01 (formalité/hedging) blocked
// Voir FINAL_ACCOUNT_ENGINE_V6_REPORT.md §6.

export const DETECTOR_VERSION = 'detectors-v1'

export interface DyadMessage {
  id: string
  threadId: string
  direction: 'inbound' | 'outbound' // inbound = du contact vers nous
  sentAt: string
  subject?: string | null
}
export interface DyadMeeting {
  id: string
  startsAt: string
  occurred: boolean            // réunion réellement tenue (passée / brief)
  contactParticipated: boolean
}

export interface MarkerEventDraft {
  markerId: string
  scope: 'person'
  sense: -1 | 1
  observedAt: string
  evidenceRef: string          // id d'un message/réunion représentatif
  evidenceText: string
  measure: Record<string, unknown>
  detectorVersion: string
  confidence: number           // 0-1
  status: 'accepted' | 'candidate'  // candidate = ne pas scorer tant que non validé
}

const DAY = 86_400_000
const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

// ── P4 : baseline dyade (fenêtre glissante, défaut 182 j ≈ 6 mois) ───────────
export interface DyadBaseline {
  episodes: number
  sufficient: boolean          // ≥ 8 épisodes → marqueurs de déviation autorisés
  reliabilityCap: number       // ≤ 0.50 sous 8 épisodes (P4)
  cadenceMedianDays: number | null
  contactResponseMedianHours: number | null // latence : notre outbound → leur inbound
  ourResponseMedianHours: number | null      // leur inbound → notre outbound
  avgThreadDepth: number | null
  channels: string[]
  windowDays: number
}

export function computeDyadBaseline(messages: DyadMessage[], meetings: DyadMeeting[], nowMs: number, windowDays = 182): DyadBaseline {
  const from = nowMs - windowDays * DAY
  const msg = messages.filter((m) => { const t = new Date(m.sentAt).getTime(); return t >= from && t <= nowMs }).sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime())
  const meet = meetings.filter((m) => { const t = new Date(m.startsAt).getTime(); return t >= from && t <= nowMs })
  const episodes = msg.length + meet.length

  // Latences par sens, à l'intérieur de chaque thread (messages consécutifs de sens opposé).
  const byThread = new Map<string, DyadMessage[]>()
  for (const m of msg) byThread.set(m.threadId, [...(byThread.get(m.threadId) ?? []), m])
  const contactResp: number[] = []
  const ourResp: number[] = []
  for (const arr of byThread.values()) {
    const s = arr.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime())
    for (let i = 1; i < s.length; i++) {
      const prev = s[i - 1]!, cur = s[i]!
      if (prev.direction === cur.direction) continue
      const gapH = (new Date(cur.sentAt).getTime() - new Date(prev.sentAt).getTime()) / 3_600_000
      if (prev.direction === 'outbound' && cur.direction === 'inbound') contactResp.push(gapH)
      else if (prev.direction === 'inbound' && cur.direction === 'outbound') ourResp.push(gapH)
    }
  }

  // Cadence : médiane des écarts entre interactions consécutives (tous types).
  const times = [...msg.map((m) => new Date(m.sentAt).getTime()), ...meet.map((m) => new Date(m.startsAt).getTime())].sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < times.length; i++) gaps.push((times[i]! - times[i - 1]!) / DAY)

  const channels: string[] = []
  if (msg.length) channels.push('email')
  if (meet.length) channels.push('meeting')

  const sufficient = episodes >= 8
  return {
    episodes, sufficient, reliabilityCap: sufficient ? 1 : 0.5,
    cadenceMedianDays: median(gaps),
    contactResponseMedianHours: median(contactResp),
    ourResponseMedianHours: median(ourResp),
    avgThreadDepth: byThread.size ? msg.length / byThread.size : null,
    channels, windowDays,
  }
}

// ── S04 : même demande relancée ≥ 2× sans réponse (déterministe) ─────────────
// Un thread avec ≥ 2 outbound sur des jours distincts et 0 inbound = relances sans réponse.
export function detectS04(messages: DyadMessage[]): MarkerEventDraft[] {
  const byThread = new Map<string, DyadMessage[]>()
  for (const m of messages) byThread.set(m.threadId, [...(byThread.get(m.threadId) ?? []), m])
  const out: MarkerEventDraft[] = []
  for (const [threadId, arr] of byThread) {
    const outbound = arr.filter((m) => m.direction === 'outbound')
    const inbound = arr.filter((m) => m.direction === 'inbound')
    if (inbound.length > 0 || outbound.length < 2) continue
    const days = new Set(outbound.map((m) => m.sentAt.slice(0, 10)))
    if (days.size < 2) continue // relances le même jour = pas une vraie relance espacée
    const sorted = outbound.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime())
    const spanDays = (new Date(sorted[sorted.length - 1]!.sentAt).getTime() - new Date(sorted[0]!.sentAt).getTime()) / DAY
    out.push({
      markerId: 'S04', scope: 'person', sense: -1, observedAt: sorted[sorted.length - 1]!.sentAt,
      evidenceRef: sorted[0]!.id,
      evidenceText: `${outbound.length} relances sans réponse sur « ${sorted[0]!.subject ?? 'sujet inconnu'} » (${Math.round(spanDays)} j)`,
      measure: { threadId, outboundCount: outbound.length, inboundCount: 0, spanDays: Math.round(spanDays) },
      detectorVersion: DETECTOR_VERSION, confidence: 0.9, status: 'accepted',
    })
  }
  return out
}

// ── R01 : latence asymétrique du contact vs SA baseline (jamais un seuil absolu) ──
export function detectR01(baseline: DyadBaseline, recentMessages: DyadMessage[], nowMs: number, recentDays = 45): MarkerEventDraft[] {
  if (!baseline.sufficient || baseline.contactResponseMedianHours == null) return []
  const from = nowMs - recentDays * DAY
  const byThread = new Map<string, DyadMessage[]>()
  for (const m of recentMessages) if (new Date(m.sentAt).getTime() >= from) byThread.set(m.threadId, [...(byThread.get(m.threadId) ?? []), m])
  const recent: number[] = []
  let lastId = ''
  for (const arr of byThread.values()) {
    const s = arr.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime())
    for (let i = 1; i < s.length; i++) {
      if (s[i - 1]!.direction === 'outbound' && s[i]!.direction === 'inbound') {
        recent.push((new Date(s[i]!.sentAt).getTime() - new Date(s[i - 1]!.sentAt).getTime()) / 3_600_000)
        lastId = s[i]!.id
      }
    }
  }
  const recentMed = median(recent)
  if (recentMed == null || recent.length < 2) return []
  const ratio = recentMed / baseline.contactResponseMedianHours
  let sense: -1 | 1 | 0 = 0
  if (ratio >= 1.5) sense = -1        // le contact répond nettement plus lentement qu'à son habitude
  else if (ratio <= 0.67) sense = 1   // nettement plus vite
  if (sense === 0) return []
  return [{
    markerId: 'R01', scope: 'person', sense, observedAt: new Date(nowMs).toISOString(),
    evidenceRef: lastId,
    evidenceText: `Latence de réponse du contact ${sense < 0 ? 'dégradée' : 'améliorée'} (${recentMed.toFixed(0)}h vs baseline ${baseline.contactResponseMedianHours.toFixed(0)}h)`,
    measure: { baselineHours: baseline.contactResponseMedianHours, recentHours: recentMed, ratio: Number(ratio.toFixed(2)) },
    detectorVersion: DETECTOR_VERSION, confidence: 0.75, status: 'accepted',
  }]
}

// ── R02 : initiation qualifiée (candidate — « substantielle vs relance » exige le contenu) ──
export function detectR02(messages: DyadMessage[], nowMs: number, recentDays = 90): MarkerEventDraft[] {
  const from = nowMs - recentDays * DAY
  const byThread = new Map<string, DyadMessage[]>()
  for (const m of messages) byThread.set(m.threadId, [...(byThread.get(m.threadId) ?? []), m])
  let inboundStarts = 0
  let firstInboundId = ''
  for (const arr of byThread.values()) {
    const s = arr.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime())
    const first = s[0]!
    if (first.direction === 'inbound' && new Date(first.sentAt).getTime() >= from) { inboundStarts++; if (!firstInboundId) firstInboundId = first.id }
  }
  if (inboundStarts === 0) return []
  return [{
    markerId: 'R02', scope: 'person', sense: 1, observedAt: new Date(nowMs).toISOString(),
    evidenceRef: firstInboundId,
    evidenceText: `${inboundStarts} fil(s) initié(s) par le contact — substance à confirmer (contenu non stocké)`,
    measure: { inboundThreadStarts: inboundStarts },
    detectorVersion: DETECTOR_VERSION, confidence: 0.5, status: 'candidate',
  }]
}

// ── A01 : diversité de canaux instrumentés actifs (déterministe, bipolaire) ──
export function detectA01(messages: DyadMessage[], meetings: DyadMeeting[], nowMs: number, windowDays = 182): MarkerEventDraft[] {
  const from = nowMs - windowDays * DAY
  const hasEmail = messages.some((m) => new Date(m.sentAt).getTime() >= from)
  const hasMeeting = meetings.some((m) => new Date(m.startsAt).getTime() >= from)
  const channels = [hasEmail && 'email', hasMeeting && 'meeting'].filter(Boolean) as string[]
  if (channels.length === 0) return []
  const sense: -1 | 1 = channels.length >= 2 ? 1 : -1
  return [{
    markerId: 'A01', scope: 'person', sense, observedAt: new Date(nowMs).toISOString(),
    evidenceRef: 'channels',
    evidenceText: `${channels.length} canal/canaux actif(s) : ${channels.join(', ')}`,
    measure: { channelCount: channels.length, channels },
    detectorVersion: DETECTOR_VERSION, confidence: 0.8, status: 'accepted',
  }]
}

// ── A02 : continuité entre périodes (trimestres actifs, déterministe, bipolaire) ──
export function detectA02(messages: DyadMessage[], meetings: DyadMeeting[], nowMs: number): MarkerEventDraft[] {
  const times = [...messages.map((m) => new Date(m.sentAt).getTime()), ...meetings.map((m) => new Date(m.startsAt).getTime())]
  const activeQuarters = new Set<number>()
  for (let q = 0; q < 4; q++) {
    const start = nowMs - (q + 1) * 90 * DAY, end = nowMs - q * 90 * DAY
    if (times.some((t) => t > start && t <= end)) activeQuarters.add(q)
  }
  const n = activeQuarters.size
  if (n === 0) return []
  let sense: -1 | 1 | 0 = 0
  if (n >= 3) sense = 1
  else if (n <= 1) sense = -1
  if (sense === 0) return []
  return [{
    markerId: 'A02', scope: 'person', sense, observedAt: new Date(nowMs).toISOString(),
    evidenceRef: 'continuity',
    evidenceText: `${n}/4 trimestres actifs sur 12 mois`,
    measure: { activeQuarters: n },
    detectorVersion: DETECTOR_VERSION, confidence: 0.75, status: 'accepted',
  }]
}

// ── E05 : acceptation de sollicitations → CANDIDATE (pas d'accept/decline capté) ──
export function detectE05Candidate(meetings: DyadMeeting[]): MarkerEventDraft[] {
  const held = meetings.filter((m) => m.occurred && m.contactParticipated)
  if (held.length === 0) return []
  const last = held.sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime())[0]!
  return [{
    markerId: 'E05', scope: 'person', sense: 1, observedAt: last.startsAt,
    evidenceRef: last.id,
    evidenceText: `${held.length} réunion(s) tenue(s) avec le contact — acceptation présumée (statut accept/decline non capté)`,
    measure: { heldMeetings: held.length },
    detectorVersion: DETECTOR_VERSION, confidence: 0.5, status: 'candidate',
  }]
}

/** Orchestrateur : tous les détecteurs déterministes disponibles pour une dyade. */
export function runDeterministicDetectors(messages: DyadMessage[], meetings: DyadMeeting[], nowMs: number): { baseline: DyadBaseline; drafts: MarkerEventDraft[] } {
  const baseline = computeDyadBaseline(messages, meetings, nowMs)
  const drafts = [
    ...detectS04(messages),
    ...detectR01(baseline, messages, nowMs),
    ...detectR02(messages, nowMs),
    ...detectA01(messages, meetings, nowMs),
    ...detectA02(messages, meetings, nowMs),
    ...detectE05Candidate(meetings),
  ]
  return { baseline, drafts }
}
