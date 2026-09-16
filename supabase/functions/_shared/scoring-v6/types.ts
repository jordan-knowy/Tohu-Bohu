// Copie exacte de src/services/scoring/types.ts — toute évolution de la
// formule doit être répercutée des deux côtés ; les tests de référence
// restent dans src/services/scoring/__tests__ (Deno ne peut pas importer
// hors de supabase/functions au déploiement, cf. convention _shared/).
//
// Scoring V6 — types du NOYAU mathématique (shadow, aucune DB, aucun LLM).
// Voir SCORING_V6_S0_DESIGN.md et SCORING_DOCTRINE.md.

export type AxisId = 'confiance' | 'satisfaction' | 'engagement' | 'reciprocite' | 'ancrage'
export type DialId = 'd_satisfaction' | 'd_confiance_recip' | 'd_couverture' | 'd_equilibre' | 'd_ancrage' | 'd_dynamique'
export type Tier = 'faible' | 'moyen' | 'important' | 'critique' | 'neutre'
export type Manipulable = 'non' | 'oui' | 'difficile'
export type MarkerScope = 'person' | 'account' | 'out_of_score'

export type VolontariteProfile = 'standard' | 'execution'
export interface DyadRole {
  label: string
  volontariteProfile: VolontariteProfile
}

export interface ParamStatus {
  implementation: 'current_reference' | 'proposed'
  calibration: 'provisional' | 'tested' | 'blocked'
}

export interface MarkerRegistryEntry {
  markerId: string
  scope: MarkerScope
  axis: AxisId | null
  dial?: DialId | null
  tier: Tier
  ptsSpec: number | null
  sign: -1 | 0 | 1
  volBase: number
  manipulable: Manipulable
  cost: Tier
  rule?: string
  deprecatedAt?: string | null
}

export interface MarkerRegistry {
  version: string
  markers: Record<string, MarkerRegistryEntry>
}

export interface TierPoints { pos: number; neg: number }

export interface ScoringParams {
  version: string
  mode: 'palier' | 'spec'
  tiers: Record<Tier, TierPoints>
  repetition: { occ1: number; occ2to3: number; occ4plus: number }
  decay: number[]
  volontarite: {
    prescrit: number; semi: number; volontaire: number
    execution: { prescrit: number; semi: number; volontaire: number }
  }
  axisWeights: Record<AxisId, number>
  dialWeights: Record<string, Record<DialId, number>>
  authority: Record<string, number>
  anchoring: { 0: number; 1: number; 2: number; threePlus: number }
  coverage: { capDeciderNoDyad: number; malusRcsUnreflected: number }
  dynamics: {
    weights: { pente: number; silence: number; solde: number }
    penteAnchors: { deltaHigh: number; vHigh: number; deltaMid: number; vMid: number; deltaLow: number; vLow: number }
    silenceAnchors: { r1: number; v1: number; r2: number; v2: number; r3: number; v3: number }
    solde: { base: number; step: number }
    k01CapMonths: number; k01Cap: number; k06Cap: number
  }
  status: Record<string, ParamStatus>
}

export interface AccountDyadInput {
  contactId: string
  authority: number
  satisfaction: number
  confiance: number
  reciprocite: number
}
export interface CoverageTarget { role: string; authority: number; covered: boolean; isDecider: boolean }
export interface AccountKEvent {
  markerId: string
  occurrences?: number
  resolvedAt?: string | null
  openMonths?: number
  observedAt: string
  evidenceRef: string
}
export interface AccountDynamicsInput {
  delta30OtherDials: number
  daysSinceLast: number
  cadenceMedian: number
  engagementsHeld: number
  engagementsSlipped: number
}
export interface AccountWeatherInput {
  relationType: string
  activeDyads: AccountDyadInput[]
  coverage: { targets: CoverageTarget[]; rcsChangeUnreflected?: boolean }
  equilibreShares: number[]
  carriers: number
  kEvents: AccountKEvent[]
  dynamics: AccountDynamicsInput
  at?: string
}

export interface DialContribution {
  markerId: string
  pointsEffectifs: number
  occurrences: number
  repetitionMultiplier: number
  contribution: number
  evidenceRef: string | null
  observedAt: string | null
}
export interface DialResult {
  dial: DialId
  base: number | null
  value: number | null
  weight: number
  effectiveWeight: number
  cappedBy: string | null
  modifiers: DialContribution[]
  note?: string
  trendDelta30d?: number | null
}
export interface AccountWeatherCoreResult {
  score: number | null
  dials: Record<DialId, DialResult>
  weakestDial: DialId | null
  relationType: string
  relationTypeStatus: 'current_reference' | 'provisional'
  paramsVersion: string
  registryVersion: string
  mode: 'palier' | 'spec'
}

export interface MarkerEvent {
  markerId: string
  sense: -1 | 1
  observedAt: string
  evidenceRef: string
}

export interface MarkerContribution {
  markerId: string
  sense: -1 | 1
  occurrences: number
  pointsEffectifs: number
  volontarite: number
  repetitionMultiplier: number
  magnitude: number
  rank: number
  decayMultiplier: number
  contributionFinale: number
}

export interface AxisResult {
  axis: AxisId
  base: number
  value: number
  weight: number
  cappedByS07: boolean
  contributions: MarkerContribution[]
}

export interface DyadScoreCoreResult {
  score: number
  axes: Record<AxisId, AxisResult>
  role: DyadRole
  paramsVersion: string
  registryVersion: string
  mode: 'palier' | 'spec'
}
