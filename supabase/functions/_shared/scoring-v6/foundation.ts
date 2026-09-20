/** Canonical Phase 1 boundary. Pure, no database, no LLM, no current-time reads. */
import { calculateDyadScoreCore } from './calculateDyadScoreCore.ts'
import { statusFromCadence, RELIABILITY_PARAMS_V1 } from './snapshots.ts'
import type { AxisId, DyadRole, MarkerEvent, MarkerRegistry, ScoringParams, MarkerContribution } from './types.ts'
export const SCORING_VERSION = 'v6-foundation-1'
export type IdentityQuality = 'verified' | 'inferred' | 'ambiguous' | 'unknown'
export type Completeness = 'complete' | 'partial' | 'unknown' | 'error'
export type Voluntariness = 'spontaneous' | 'requested' | 'reactive' | 'forced' | 'unknown'
export interface DyadIdentity { organizationId: string; collaboratorUserId: string; contactId: string }
export function dyadKey(d: DyadIdentity): string {
  if (![d.organizationId, d.collaboratorUserId, d.contactId].every(x => typeof x === 'string' && x.trim())) throw new Error('INVALID_DYAD')
  return JSON.stringify([d.organizationId, d.collaboratorUserId, d.contactId])
}
export interface Revision { id: string; recordedAt: string; effectiveFrom: string; effectiveUntil?: string | null }
export interface RelationalEvent extends Revision {
  dyad: DyadIdentity; accountId: string | null; sourceEventId: string; sourceType: string; channel: string
  eventTime: string; ingestedAt: string; state: 'observed' | 'scheduled' | 'cancelled' | 'corrected' | 'deleted'
  internalActorId: string | null; externalActorId: string | null; participants: string[]; ownerUserId: string | null
  evidenceRef: string; evidenceUnitId: string; identityQuality: IdentityQuality; completeness: Completeness
  sourceVersion: string; evidenceText?: string; participationObserved: boolean; direction?: 'inbound' | 'outbound'; threadId?: string
}
export interface MarkerRevision extends Revision {
  dyad: DyadIdentity; markerId: string; sense: -1 | 1; observedAt: string
  sourceEventIds: string[]; state: 'active' | 'resolved' | 'superseded' | 'obsolete'
  resolvedAt?: string | null; supersededAt?: string | null
  criticalValidated?: boolean; evidenceQuote?: string
  status: 'accepted' | 'candidate'; registryVersion: string; detectorVersion: string
  voluntariness: Voluntariness; intensity: 'low' | 'medium' | 'high' | 'critical' | 'unknown'
}
export interface QualityRevision extends Revision {
  reliability: number | null; reliabilityEvidence: string[]; identity: IdentityQuality; diarization: IdentityQuality
  completeness: Completeness; expectedChannels: string[] | null; observedChannels: string[]
  periodStart: string | null; periodEnd: string | null
}
export interface RoleRevision extends Revision { origin: 'declared' | 'inferred'; role: DyadRole | null; authority: number | null; evidence: string[] }
export type ReplayMode = 'state_as_known_at_T' | 'historical_state_recomputed_with_current_truth'
export interface FoundationInput {
  dyad: DyadIdentity; at: string; computedAt: string; mode?: ReplayMode; knowledgeAt?: string
  events: RelationalEvent[]; markers: MarkerRevision[]; qualities: QualityRevision[]; roles: RoleRevision[]
  params: ScoringParams; registry: MarkerRegistry
}
const time = (s: string | null | undefined) => s ? Date.parse(s) : NaN
const ratio = (n: number | null | undefined): number | null => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1 ? n : null
const activeAt = (r: Revision, t: number) => time(r.effectiveFrom) <= t && (!r.effectiveUntil || time(r.effectiveUntil) > t)
/** Latest known revision first, then valid-time filter: a deletion must not resurrect an old row. */
export function revisionsAt<T extends Revision>(rows: T[], known: number, errors: string[]): T[] {
  const grouped = new Map<string, T[]>()
  for (const r of rows) {
    if (Number.isFinite(time(r.recordedAt)) && time(r.recordedAt) > known) continue
    if (!r.id || !Number.isFinite(time(r.recordedAt)) || !Number.isFinite(time(r.effectiveFrom)) || (r.effectiveUntil != null && (!Number.isFinite(time(r.effectiveUntil)) || time(r.effectiveUntil) <= time(r.effectiveFrom)))) { errors.push('INVALID_REVISION'); continue }
    if (time(r.recordedAt) > known) continue
    grouped.set(r.id, [...(grouped.get(r.id) ?? []), r])
  }
  return [...grouped.entries()].sort(([a],[b]) => a.localeCompare(b)).flatMap(([id, items]) => {
    const latest = Math.max(...items.map(r => time(r.recordedAt)))
    const top = items.filter(r => time(r.recordedAt) === latest)
    if (new Set(top.map(r => stable(r))).size > 1) { errors.push(`CONFLICTING_REVISION:${id}`); return [] }
    return [top[0]!]
  })
}
function stable(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']'
  if (v && typeof v === 'object') return '{' + Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+stable(x)).join(',') + '}'
  return JSON.stringify(v) ?? 'null'
}
// Le score et les 6 indicateurs sont TOUJOURS calculés et affichés, dès
// qu'une dyade existe — une nouvelle relation démarre neutre (50) et évolue
// avec les preuves. Le manque de données ne cache plus jamais le score :
// il se traduit uniquement par une `reliability` basse (fiabilité), portée
// séparément. `reasons` reste informatif (explique POURQUOI la fiabilité est
// ce qu'elle est) mais ne bloque plus `display`. Seule une vraie anomalie
// d'intégrité (`errors` — revisions conflictuelles, contexte temporel
// ambigu, etc., détectées ailleurs dans buildRelationalState) est un cas où
// un calcul serait techniquement invalide — celui-là seul empêche `display`.
export function evaluateDyadAdmissibility(i: {
  coldStart: boolean; evidenceCount: number; reliability: number | null; coverage: number | null
  identity: IdentityQuality; completeness: Completeness; status: string; errors: string[]
}) {
  const reasons: string[] = [...i.errors]
  if (i.coldStart) reasons.push('COLD_START')
  if (i.evidenceCount < RELIABILITY_PARAMS_V1.p7MarkersMin) reasons.push('INSUFFICIENT_INDEPENDENT_EVIDENCE')
  if (i.identity !== 'verified') reasons.push('IDENTITY_NOT_VERIFIED')
  if (i.completeness !== 'complete') reasons.push('INCOMPLETE_DATA')
  if (ratio(i.coverage) == null || i.coverage === 0) reasons.push('UNKNOWN_OR_ZERO_COVERAGE')
  if (ratio(i.reliability) == null || i.reliability! < RELIABILITY_PARAMS_V1.thresholds.amber) reasons.push('INSUFFICIENT_RELIABILITY')
  // display: TOUJOURS vrai. Un marqueur individuel invalide (i.errors) est
  // déjà exclu du calcul en amont (buildRelationalState ne l'admet jamais) —
  // ça n'invalide pas le reste de la dyade. Une dyade elle-même invalide
  // (temps de rejeu incohérent, identifiants malformés) lève déjà une
  // exception AVANT d'atteindre cette fonction — ça n'a donc jamais besoin
  // d'être représenté ici par un score caché.
  const display = true
  const verdict = (i.reliability ?? 0) >= RELIABILITY_PARAMS_V1.thresholds.verdict
  // Le rollup compte n'a plus besoin du verdict de fiabilité (seuil 0.60) —
  // sinon, comme quasiment aucune dyade n'atteint ce seuil au démarrage,
  // AUCUN compte n'aurait jamais de météo. La fiabilité du compte se déduit
  // déjà, séparément, du minimum des fiabilités de ses dyades (account-state.ts) —
  // c'est elle qui porte l'incertitude, pas un blocage total du score.
  const account = i.status !== 'insufficient_evidence'
  return { display, verdict, account, recommendation: verdict,
    trend: verdict, reasons: [...new Set(reasons)].sort() }
}
export interface RelationalState {
  entity: DyadIdentity; scope: 'individual_dyad'; status: string; observedAt: string; computedAt: string; knowledgeAt: string; replayMode: ReplayMode
  score: number | null; exploratoryScore: number | null; axes: Partial<Record<AxisId, number | null>>
  reliability: number | null; coverage: { value: number | null; completeness: Completeness; expectedChannels: string[] | null; observedChannels: string[] }
  authority: number | null; declaredRole: DyadRole | null; inferredRole: DyadRole | null
  admissibility: ReturnType<typeof evaluateDyadAdmissibility>; evidence: RelationalEvent[]; contributions: Array<MarkerContribution & { axis: AxisId }>
  history: Array<{ at: string; score: number | null }>; delta: number | null; causes: Array<{ kind: 'calculated'; cause: string; points: number }>
  scoringVersion: string; paramsVersion: string; registryVersion: string; errors: string[]
}
export function buildRelationalState(input: FoundationInput): RelationalState {
  const key = dyadKey(input.dyad), t = time(input.at)
  const mode = input.mode ?? 'state_as_known_at_T'
  const knowledgeAt = mode === 'state_as_known_at_T' ? input.at : input.knowledgeAt
  if (!Number.isFinite(t) || !knowledgeAt || !Number.isFinite(time(knowledgeAt)) || !Number.isFinite(time(input.computedAt))) throw new Error('INVALID_REPLAY_TIME')
  const known = time(knowledgeAt), errors: string[] = []
  const matches = (d: DyadIdentity) => dyadKey(d) === key
  const events = revisionsAt(input.events.filter(e => matches(e.dyad)), known, errors).filter(e =>
    activeAt(e,t) && e.state === 'observed' && time(e.eventTime) <= t && time(e.ingestedAt) <= known &&
    e.identityQuality === 'verified' && e.completeness === 'complete' && e.participationObserved &&
    !!e.evidenceRef && !!e.evidenceUnitId && !!e.sourceVersion &&
    (e.internalActorId === input.dyad.collaboratorUserId || e.ownerUserId === input.dyad.collaboratorUserId) &&
    (e.externalActorId === input.dyad.contactId || e.participants.includes(input.dyad.contactId)))
  const byId = new Map(events.map(e => [e.id,e]))
  const markers = revisionsAt(input.markers.filter(e => matches(e.dyad)),known,errors)
  const consumedUnits = new Map<string, Set<string>>()
  const admitted: MarkerEvent[] = [], usedEvents = new Map<string, RelationalEvent>()
  for (const m of markers) {
    if (time(m.observedAt)>t || time(m.effectiveFrom)>t) continue
    const entry = input.registry.markers[m.markerId]
    if (!entry || entry.scope !== 'person' || !entry.axis || entry.deprecatedAt) { errors.push(`UNKNOWN_OR_INVALID_MARKER:${m.markerId}`); continue }
    if (m.registryVersion !== input.registry.version) { errors.push(`REGISTRY_MISMATCH:${m.id}`); continue }
    if (!activeAt(m,t) || m.state !== 'active' || m.status !== 'accepted' || time(m.observedAt) > t || !Number.isFinite(time(m.observedAt)) || (m.resolvedAt && time(m.resolvedAt) <= t) || (m.supersededAt && time(m.supersededAt) <= t)) continue
    if (![1,-1].includes(m.sense)) { errors.push(`INVALID_SENSE:${m.id}`); continue }
    const support = m.sourceEventIds.map(id => byId.get(id))
    if (!support.length || support.some(e=>!e)) { errors.push(`INADMISSIBLE_EVIDENCE:${m.id}`); continue }
    if (entry.tier==='critique' && (m.criticalValidated!==true || !m.evidenceQuote?.trim() || !support.some(e=>e!.evidenceText?.includes(m.evidenceQuote!)))) { errors.push(`UNVALIDATED_CRITICAL_EVIDENCE:${m.id}`); continue }
    if (support.some(e=>time(e!.eventTime)>time(m.observedAt))) { errors.push(`EVIDENCE_AFTER_OBSERVATION:${m.id}`); continue }
    const units = [...new Set(support.map(e=>e!.evidenceUnitId))].sort()
    const family = `${m.markerId}:${m.sense}`
    const seen = consumedUnits.get(family) ?? new Set<string>()
    if (units.some(u=>seen.has(u))) continue // overlapping interpretations are not independent repetitions
    units.forEach(u=>seen.add(u)); consumedUnits.set(family,seen)
    // A compound measurement is one occurrence, never N repetitions.
    admitted.push({markerId:m.markerId,sense:m.sense,observedAt:m.observedAt,evidenceUnitId:JSON.stringify(units),evidenceRef:m.id})
    for (const e of support) usedEvents.set(e!.id,e!)
  }
  // Connected support sets count once for P7: an aggregate cadence marker
  // supported by 100 emails is one observation, not 100 independent markers.
  const components: Set<string>[] = []
  for (const marker of admitted) {
    const group = new Set<string>(JSON.parse(marker.evidenceUnitId!))
    for (let i=components.length-1;i>=0;i--) {
      if ([...components[i]!].some(unit=>group.has(unit))) {
        components[i]!.forEach(unit=>group.add(unit)); components.splice(i,1)
      }
    }
    components.push(group)
  }
  const choose = <T extends Revision>(rows:T[]): T | undefined => {
    const active = revisionsAt(rows,known,errors).filter(r=>activeAt(r,t)).sort((a,b)=>time(b.effectiveFrom)-time(a.effectiveFrom)||time(b.recordedAt)-time(a.recordedAt)||a.id.localeCompare(b.id))
    if (active.length>1 && time(active[0]!.effectiveFrom)===time(active[1]!.effectiveFrom) && time(active[0]!.recordedAt)===time(active[1]!.recordedAt)) {
      errors.push('AMBIGUOUS_TEMPORAL_CONTEXT'); return undefined
    }
    return active[0]
  }
  const quality = choose(input.qualities)
  const declared = choose(input.roles.filter(r=>r.origin==='declared'))
  const inferred = choose(input.roles.filter(r=>r.origin==='inferred'))
  const role = declared?.role ?? null // inference is kept, not silently promoted
  // Volontarité renormalization needs *a* profile to run the arithmetic, but a
  // missing declared role must never fabricate who someone is. 'standard' is
  // the common-case table (the doctrine's only named exception is 'execution'
  // roles) — it is a computation default, not a claim about this person.
  const DEFAULT_ROLE: DyadRole = { label: 'Rôle non renseigné', volontariteProfile: 'standard' }
  const datesByUnit = new Map<string,number>()
  for (const e of events) {
    if (datesByUnit.has(e.evidenceUnitId) && datesByUnit.get(e.evidenceUnitId)!==time(e.eventTime)) errors.push(`CONFLICTING_EVENT_TIME:${e.evidenceUnitId}`)
    datesByUnit.set(e.evidenceUnitId,Math.min(datesByUnit.get(e.evidenceUnitId) ?? Infinity,time(e.eventTime)))
  }
  const eventTimes = [...datesByUnit.values()].sort((a,b)=>a-b)
  const gaps = eventTimes.slice(1).map((n,i)=>(n-eventTimes[i]!)/86400000).sort((a,b)=>a-b)
  const cadence = gaps.length ? (gaps[Math.floor((gaps.length-1)/2)]! + gaps[Math.floor(gaps.length/2)]!)/2 : 0
  const coldStart = eventTimes.length < 5 || (t-(eventTimes[0] ?? t))/86400000 < 30
  const status = !admitted.length ? 'insufficient_evidence' : coldStart ? 'cold_start' : statusFromCadence((t-eventTimes.at(-1)!)/86400000,cadence,false)
  const expected = quality?.expectedChannels ? [...new Set(quality.expectedChannels)].sort() : null
  const observed = [...new Set(events.filter(e=>quality?.periodStart && quality.periodEnd && time(e.eventTime)>=time(quality.periodStart) && time(e.eventTime)<=time(quality.periodEnd)).map(e=>e.channel))].sort()
  const coverage = expected?.length && quality?.periodStart && quality.periodEnd && time(quality.periodStart) <= time(quality.periodEnd) && time(quality.periodEnd) <= t
    ? expected.filter(c=>observed.includes(c)).length/expected.length : null
  // Fiabilité toujours calculable (jamais null) : un volume nul de preuves
  // donne 0 (fiabilité très faible), pas l'absence d'indicateur. C'est CE
  // chiffre qui porte « on ne sait pas encore », jamais le score lui-même.
  const volumeFactor = Math.min(components.length / RELIABILITY_PARAMS_V1.p7MarkersMin, 1)
  const identityFactor = quality?.identity === 'verified' ? 1 : quality ? 0.6 : 1
  const completenessFactor = quality?.completeness === 'complete' ? 1 : quality ? 0.6 : 1
  const reliability = Math.max(0, Math.min(1, volumeFactor * identityFactor * completenessFactor))
  // Le core est TOUJOURS calculé, même sans aucun marqueur admis : une dyade
  // sans preuve démarre à 50 sur chaque axe (cf. calculateDyadScoreCore) —
  // jamais de score caché faute de contexte.
  const core = calculateDyadScoreCore(admitted,role ?? DEFAULT_ROLE,input.params,input.registry)
  const admissibility = evaluateDyadAdmissibility({coldStart,evidenceCount:components.length,reliability,coverage,identity:quality?.identity ?? 'unknown',completeness:quality?.completeness ?? 'unknown',status,errors})
  const axes = Object.fromEntries(Object.values(core.axes).map(a=>[a.axis,a.value]))
  return {entity:input.dyad,scope:'individual_dyad',status,score:admissibility.display ? core.score : null,exploratoryScore:core.score,axes,
    reliability,coverage:{value:coverage,completeness:quality?.completeness ?? 'unknown',expectedChannels:expected,observedChannels:observed},
    authority:declared?.authority != null && declared.authority > 0 ? declared.authority : null,declaredRole:role,inferredRole:inferred?.role ?? null,
    admissibility,evidence:[...usedEvents.values()].sort((a,b)=>a.id.localeCompare(b.id)),contributions:Object.values(core.axes).flatMap(a=>a.contributions.map(c=>({...c,axis:a.axis}))),
    observedAt:input.at,computedAt:input.computedAt,knowledgeAt,replayMode:mode,history:[],delta:null,causes:[],scoringVersion:SCORING_VERSION,paramsVersion:input.params.version,registryVersion:input.registry.version,errors:[...new Set(errors)].sort()}
}
/** Prepared account boundary: no guessed team-person aggregation or authority. */
// L'autorité manquante (rôle non déclaré) ne doit plus exclure une dyade du
// rollup compte, même principe que pour le score personne : account-state.ts
// applique un poids neutre par défaut, jamais une exclusion silencieuse.
export function eligibleAccountDyads(states: RelationalState[]) {
  return states.filter(s=>s.admissibility.account && s.score !== null)
}
export type CommitmentOutcome = 'open'|'held_on_time'|'held_late'|'cancelled'|'waived'|'broken'|'unknown'
export function commitmentOutcome(c: {dueAt?:string|null;completedAt?:string|null;resolvedAt?:string|null;disposition?:'cancelled'|'waived'|'broken'|null},at:string): CommitmentOutcome {
  if ([c.dueAt,c.completedAt,c.resolvedAt].some(v=>v != null && !Number.isFinite(time(v))) || !Number.isFinite(time(at))) return 'unknown'
  if (c.disposition) return c.disposition
  if (c.completedAt && time(c.completedAt)<=time(at)) return c.dueAt ? time(c.completedAt)<=time(c.dueAt) ? 'held_on_time':'held_late' : 'unknown'
  if (c.resolvedAt && time(c.resolvedAt)<=time(at)) return 'unknown'
  return 'open' // overdue does not prove broken; no 90-day exclusion
}
