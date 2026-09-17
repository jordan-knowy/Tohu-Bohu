// Canonical V6 module: shared by browser and edge.
// Scoring V6 — S6 : couche SNAPSHOT (applique ce que le noyau mathématique ignore).
// Fenêtre d'extraction, P5 (cold start), P7 (verdict), fiabilité, statut cadence.
// Pur (aucune DB/LLM). Les coefficients de fiabilité sont PROVISIONAL et versionnés
// (jamais inventés silencieusement — §28). Voir SCORING_DOCTRINE.md / SCORING_V6_S0_DESIGN.md.

import { calculateDyadScoreCore } from './calculateDyadScoreCore.ts'
import type {
  AccountWeatherCoreResult, DyadRole, DyadScoreCoreResult, MarkerEvent, MarkerRegistry, ScoringParams,
} from './types.ts'

/** Paramètres de fiabilité — provisional, versionnés (§28). */
export const RELIABILITY_PARAMS_V1 = {
  version: 'reliability_params-v1',
  status: 'provisional' as const,
  volumeSaturationMarkers: 8,   // nb de marqueurs au-delà duquel le facteur volume = 1
  x01Cap: 0.6,                  // canal non instrumenté (X01) → plafond de fiabilité
  significantDialWeight: 0.15,  // cadran « significatif » pour le min compte
  thresholds: { verdict: 0.60, amber: 0.50 },
  // P5 / P7
  p5AgeMinDays: 30, p5EpisodesMin: 5, p7MarkersMin: 5,
  // Statut cadence
  cadence: { actif: 1.5, ralenti: 3, rompu: 6 },
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0))

export type RelationalStatus = 'actif' | 'ralenti' | 'dormant' | 'rompu' | 'cold_start' | 'insufficient_evidence'

/** Statut = cadence PROPRE de la dyade, jamais un seuil absolu (§29). */
export function statusFromCadence(daysSinceLast: number, cadenceMedian: number, hasX02: boolean): RelationalStatus {
  if (hasX02) return 'rompu'
  if (cadenceMedian <= 0) return 'actif'
  const ratio = daysSinceLast / cadenceMedian
  const c = RELIABILITY_PARAMS_V1.cadence
  if (ratio > c.rompu) return 'rompu'
  if (ratio > c.ralenti) return 'dormant'
  if (ratio >= c.actif) return 'ralenti'
  return 'actif'
}

export interface DyadReliabilityInputs {
  channelCoverage: number      // 0-1 : part des canaux plausibles réellement captés
  identityResolution: number   // 0-1 : 1 = identité nette ; boîte partagée non scindée → ≤ 0.60 (P3)
  diarizationQuality: number   // 0-1
  markerCount: number
  hasX01: boolean
}

/** Fiabilité dyade = couverture_canal × volume × identité × diarisation (§28), tous 0-1.
 *  X01 (canal non instrumenté) plafonne. Provisional. */
export function reliabilityDyad(r: DyadReliabilityInputs): number {
  const volume = clamp01(r.markerCount / RELIABILITY_PARAMS_V1.volumeSaturationMarkers)
  let rel = clamp01(r.channelCoverage) * volume * clamp01(r.identityResolution) * clamp01(r.diarizationQuality)
  if (r.hasX01) rel = Math.min(rel, RELIABILITY_PARAMS_V1.x01Cap)
  return clamp01(rel)
}

export interface DyadSnapshotInput {
  markerEvents: MarkerEvent[]
  role: DyadRole
  at: string                   // date de rejeu T
  context: { ageDays: number; episodes: number; daysSinceLast: number; cadenceMedian: number; hasX02: boolean }
  reliabilityInputs: Omit<DyadReliabilityInputs, 'markerCount'>
  params: ScoringParams
  registry: MarkerRegistry
}

export interface DyadSnapshot {
  entityType: 'dyad'
  at: string
  score: number | null         // null si P5 (cold start)
  reliability: number
  verdictAllowed: boolean       // P7 : ≥5 marqueurs datés
  status: RelationalStatus
  coldStart: boolean
  markerCount: number
  core: DyadScoreCoreResult | null
  paramsVersion: string
  registryVersion: string
  reliabilityParamsVersion: string
}

/** Applique fenêtre + P5 + P7 + fiabilité + statut au noyau mathématique. */
export function buildDyadScoreSnapshot(input: DyadSnapshotInput): DyadSnapshot {
  const { at, params, registry } = input
  const atMs = new Date(at).getTime()
  // Fenêtre temporelle : seuls les marqueurs observés ≤ T (rejeu daté).
  const windowed = input.markerEvents.filter((e) => Number.isFinite(new Date(e.observedAt).getTime()) && new Date(e.observedAt).getTime() <= atMs && !!e.evidenceRef?.trim() && !!registry.markers[e.markerId]?.axis && !registry.markers[e.markerId]?.deprecatedAt && (e.sense === 1 || e.sense === -1))
  const markerCount = new Set(windowed.map(e => e.evidenceUnitId ?? e.evidenceRef)).size

  const reliability = reliabilityDyad({ ...input.reliabilityInputs, markerCount })
  const p5 = input.context.ageDays < RELIABILITY_PARAMS_V1.p5AgeMinDays || input.context.episodes < RELIABILITY_PARAMS_V1.p5EpisodesMin
  const status = p5 ? 'cold_start' : statusFromCadence(input.context.daysSinceLast, input.context.cadenceMedian, input.context.hasX02)

  if (p5 || markerCount === 0) {
    return {
      entityType: 'dyad', at, score: null, reliability, verdictAllowed: false, status: p5 ? status : 'insufficient_evidence', coldStart: p5,
      markerCount, core: null, paramsVersion: params.version, registryVersion: registry.version,
      reliabilityParamsVersion: RELIABILITY_PARAMS_V1.version,
    }
  }

  const core = calculateDyadScoreCore(windowed, input.role, params, registry)
  return {
    entityType: 'dyad', at, score: core.score, reliability,
    verdictAllowed: markerCount >= RELIABILITY_PARAMS_V1.p7MarkersMin, // P7
    status, coldStart: false, markerCount, core,
    paramsVersion: params.version, registryVersion: registry.version,
    reliabilityParamsVersion: RELIABILITY_PARAMS_V1.version,
  }
}

export interface AccountSnapshotInput {
  weather: AccountWeatherCoreResult
  at: string
  dialReliabilities: Partial<Record<string, number>>  // par dial (0-1)
  activeDyadCount: number
}
export interface AccountSnapshot {
  entityType: 'account'
  at: string
  score: number | null
  reliability: number
  verdictAllowed: boolean
  weakestDial: string | null
  paramsVersion: string
  registryVersion: string
  reliabilityParamsVersion: string
}

/** Fiabilité compte = min des fiabilités des cadrans significatifs (poids ≥ 15%) — §28. */
export function buildAccountWeatherSnapshot(input: AccountSnapshotInput): AccountSnapshot {
  const { weather } = input
  const significant = Object.values(weather.dials)
    .filter((d) => d.value !== null && d.weight >= RELIABILITY_PARAMS_V1.significantDialWeight)
    .map((d) => clamp01(input.dialReliabilities[d.dial] ?? 0))
  const reliability = significant.length ? Math.min(...significant) : 0
  // Verdict compte : au moins une dyade active et un score calculable.
  const verdictAllowed = input.activeDyadCount >= 1 && weather.score !== null
  return {
    entityType: 'account', at: input.at, score: weather.score, reliability, verdictAllowed,
    weakestDial: weather.weakestDial, paramsVersion: weather.paramsVersion,
    registryVersion: weather.registryVersion, reliabilityParamsVersion: RELIABILITY_PARAMS_V1.version,
  }
}

/** Règle d'affichage UI dérivée de la fiabilité (§28/§50) — décision déterministe, jamais un LLM. */
export function displayRule(reliability: number | null, verdictAllowed: boolean): 'score_and_verdict' | 'score_amber' | 'score_greyed_no_verdict' {
  if (reliability == null || !Number.isFinite(reliability) || reliability < RELIABILITY_PARAMS_V1.thresholds.amber) return 'score_greyed_no_verdict'
  if (!verdictAllowed) return 'score_greyed_no_verdict' // P7 : score possible, aucun verdict
  if (reliability < RELIABILITY_PARAMS_V1.thresholds.verdict) return 'score_amber'
  return 'score_and_verdict'
}
