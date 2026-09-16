// Copie PARTIELLE (dyade uniquement) de src/services/scoring/snapshots.ts —
// voir le commentaire de types.ts dans ce même dossier pour la raison de
// cette duplication. Couche SNAPSHOT dyade : fenêtre, P5 (cold start), P7
// (verdict), fiabilité, statut cadence — jamais inventés silencieusement.

import { calculateDyadScoreCore } from './calculateDyadScoreCore.ts'
import type { DyadRole, DyadScoreCoreResult, MarkerEvent, MarkerRegistry, ScoringParams } from './types.ts'

export const RELIABILITY_PARAMS_V1 = {
  version: 'reliability_params-v1',
  status: 'provisional' as const,
  volumeSaturationMarkers: 8,
  x01Cap: 0.6,
  significantDialWeight: 0.15,
  thresholds: { verdict: 0.60, amber: 0.50 },
  p5AgeMinDays: 30, p5EpisodesMin: 5, p7MarkersMin: 5,
  cadence: { actif: 1.5, ralenti: 3, rompu: 6 },
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0))

export type RelationalStatus = 'actif' | 'ralenti' | 'dormant' | 'rompu' | 'cold_start'

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
  channelCoverage: number
  identityResolution: number
  diarizationQuality: number
  markerCount: number
  hasX01: boolean
}

export function reliabilityDyad(r: DyadReliabilityInputs): number {
  const volume = clamp01(r.markerCount / RELIABILITY_PARAMS_V1.volumeSaturationMarkers)
  let rel = clamp01(r.channelCoverage) * volume * clamp01(r.identityResolution) * clamp01(r.diarizationQuality)
  if (r.hasX01) rel = Math.min(rel, RELIABILITY_PARAMS_V1.x01Cap)
  return clamp01(rel)
}

export interface DyadSnapshotInput {
  markerEvents: MarkerEvent[]
  role: DyadRole
  at: string
  context: { ageDays: number; episodes: number; daysSinceLast: number; cadenceMedian: number; hasX02: boolean }
  reliabilityInputs: Omit<DyadReliabilityInputs, 'markerCount'>
  params: ScoringParams
  registry: MarkerRegistry
}

export interface DyadSnapshot {
  entityType: 'dyad'
  at: string
  score: number | null
  reliability: number
  verdictAllowed: boolean
  status: RelationalStatus
  coldStart: boolean
  markerCount: number
  core: DyadScoreCoreResult | null
  paramsVersion: string
  registryVersion: string
  reliabilityParamsVersion: string
}

export function buildDyadScoreSnapshot(input: DyadSnapshotInput): DyadSnapshot {
  const { at, params, registry } = input
  const atMs = new Date(at).getTime()
  const windowed = input.markerEvents.filter((e) => new Date(e.observedAt).getTime() <= atMs)
  const markerCount = windowed.length

  const reliability = reliabilityDyad({ ...input.reliabilityInputs, markerCount })
  const p5 = input.context.ageDays < RELIABILITY_PARAMS_V1.p5AgeMinDays || input.context.episodes < RELIABILITY_PARAMS_V1.p5EpisodesMin
  const status = p5 ? 'cold_start' : statusFromCadence(input.context.daysSinceLast, input.context.cadenceMedian, input.context.hasX02)

  if (p5) {
    return {
      entityType: 'dyad', at, score: null, reliability, verdictAllowed: false, status, coldStart: true,
      markerCount, core: null, paramsVersion: params.version, registryVersion: registry.version,
      reliabilityParamsVersion: RELIABILITY_PARAMS_V1.version,
    }
  }

  const core = calculateDyadScoreCore(windowed, input.role, params, registry)
  return {
    entityType: 'dyad', at, score: core.score, reliability,
    verdictAllowed: markerCount >= RELIABILITY_PARAMS_V1.p7MarkersMin,
    status, coldStart: false, markerCount, core,
    paramsVersion: params.version, registryVersion: registry.version,
    reliabilityParamsVersion: RELIABILITY_PARAMS_V1.version,
  }
}

export function displayRule(reliability: number, verdictAllowed: boolean): 'score_and_verdict' | 'score_amber' | 'score_greyed_no_verdict' {
  if (reliability < RELIABILITY_PARAMS_V1.thresholds.amber) return 'score_greyed_no_verdict'
  if (!verdictAllowed) return 'score_greyed_no_verdict'
  if (reliability < RELIABILITY_PARAMS_V1.thresholds.verdict) return 'score_amber'
  return 'score_and_verdict'
}
