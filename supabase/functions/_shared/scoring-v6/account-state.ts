/** Canonical V6 account aggregation. Pure: no database, LLM, or wall clock. */
import { calculateAccountWeatherCore } from './calculateAccountWeatherCore.ts'
import { eligibleAccountDyads, type RelationalState } from './foundation.ts'
import {
  buildAccountWeatherSnapshot,
  displayRule,
  RELIABILITY_PARAMS_V1,
} from './snapshots.ts'
import type {
  AccountDynamicsInput,
  AccountKEvent,
  CoverageTarget,
  DialId,
  MarkerRegistry,
  ScoringParams,
} from './types.ts'

export const ACCOUNT_SCORING_VERSION = 'v6-account-1'

export interface AccountHistoryPoint {
  observedAt: string
  score: number | null
  dials: Partial<Record<DialId, number | null>>
  scoringVersion: string
  paramsVersion: string
  registryVersion: string
}

export interface CanonicalAccountInput {
  organizationId: string
  accountId: string
  at: string
  computedAt: string
  relationType: string
  dyads: RelationalState[]
  coverageTargets: CoverageTarget[]
  equilibreShares: number[]
  carriers: number
  kEvents: AccountKEvent[]
  dynamics: AccountDynamicsInput
  params: ScoringParams
  registry: MarkerRegistry
  history?: AccountHistoryPoint[]
}

export interface AccountCause {
  kind: 'calculated'
  dimension: DialId | 'rounding'
  points: number
}

export interface CanonicalAccountState {
  entity: { organizationId: string; accountId: string }
  scope: 'account'
  status: 'available' | 'insufficient_evidence'
  score: number | null
  exploratoryScore: number | null
  dials: ReturnType<typeof calculateAccountWeatherCore>['dials']
  weakestDial: DialId | null
  reliability: number
  verdictAllowed: boolean
  display: ReturnType<typeof displayRule>
  coverage: { targetCount: number; coveredCount: number }
  dyads: Array<{
    collaboratorUserId: string
    contactId: string
    score: number
    reliability: number | null
    authority: number
  }>
  observedAt: string
  computedAt: string
  history: AccountHistoryPoint[]
  delta: number | null
  causes: AccountCause[]
  scoringVersion: string
  paramsVersion: string
  registryVersion: string
  reliabilityParamsVersion: string
  errors: string[]
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function compatibleHistory(input: CanonicalAccountInput): AccountHistoryPoint[] {
  return (input.history ?? [])
    .filter((point) => point.observedAt < input.at && point.scoringVersion === ACCOUNT_SCORING_VERSION &&
      point.paramsVersion === input.params.version && point.registryVersion === input.registry.version)
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
}

function reconcileCauses(
  current: ReturnType<typeof calculateAccountWeatherCore>,
  previous: AccountHistoryPoint | undefined,
  delta: number | null,
): AccountCause[] {
  if (delta === null || !previous) return []
  const causes: AccountCause[] = []
  for (const [dimension, dial] of Object.entries(current.dials) as Array<[DialId, typeof current.dials[DialId]]>) {
    const before = previous.dials[dimension]
    if (!finite(before) || !finite(dial.value)) continue
    const points = (dial.value - before) * dial.effectiveWeight
    if (Math.abs(points) >= 1e-9) causes.push({ kind: 'calculated', dimension, points })
  }
  const allocated = causes.reduce((sum, cause) => sum + cause.points, 0)
  const residual = delta - allocated
  if (Math.abs(residual) >= 1e-9) causes.push({ kind: 'calculated', dimension: 'rounding', points: residual })
  return causes
}

/**
 * Builds an account state only from already-admissible dyads and explicit
 * account observations. Unknown dimensions remain null in the core.
 */
export function buildCanonicalAccountState(input: CanonicalAccountInput): CanonicalAccountState {
  if (![input.at, input.computedAt].every((value) => Number.isFinite(Date.parse(value)))) throw new Error('INVALID_ACCOUNT_TIME')
  if (!input.organizationId || !input.accountId) throw new Error('INVALID_ACCOUNT')

  const errors: string[] = []
  const eligible = eligibleAccountDyads(input.dyads).filter((state) => {
    if (state.entity.organizationId !== input.organizationId) { errors.push('CROSS_ORGANIZATION_DYAD'); return false }
    const axes = state.axes
    return finite(axes.satisfaction) && finite(axes.confiance) && finite(axes.reciprocite)
  })
  // Rôle non déclaré → poids neutre (0.3, le palier le plus bas du barème),
  // jamais une exclusion silencieuse du rollup compte : cf. eligibleAccountDyads.
  const activeDyads = eligible.map((state) => ({
    contactId: state.entity.contactId,
    authority: state.authority ?? 0.3,
    satisfaction: state.axes.satisfaction!,
    confiance: state.axes.confiance!,
    reciprocite: state.axes.reciprocite!,
  }))
  const weather = calculateAccountWeatherCore({
    relationType: input.relationType,
    activeDyads,
    coverage: { targets: input.coverageTargets },
    equilibreShares: input.equilibreShares,
    carriers: input.carriers,
    kEvents: input.kEvents,
    dynamics: input.dynamics,
    at: input.at,
  }, input.params, input.registry)

  const dyadReliabilities = eligible.map((state) => state.reliability).filter(finite)
  const dyadReliability = dyadReliabilities.length === eligible.length && eligible.length
    ? Math.min(...dyadReliabilities) : 0
  const explicitCoverage = input.coverageTargets.length > 0
  const dialReliabilities: Partial<Record<DialId, number>> = {
    d_satisfaction: dyadReliability,
    d_confiance_recip: dyadReliability,
    d_couverture: explicitCoverage ? dyadReliability : 0,
    d_equilibre: input.equilibreShares.length >= 2 ? dyadReliability : 0,
    d_ancrage: input.carriers > 0 ? dyadReliability : 0,
    d_dynamique: input.dynamics.available === false ? 0 : dyadReliability,
  }
  const snapshot = buildAccountWeatherSnapshot({ weather, at: input.at, dialReliabilities, activeDyadCount: eligible.length })
  const presentation = displayRule(snapshot.reliability, snapshot.verdictAllowed)
  // Le score compte est toujours affiché (même principe qu'au niveau personne :
  // une météo démarre neutre et s'affine avec les preuves, jamais cachée faute
  // de contexte). `presentation` reste calculé pour étiqueter la fiabilité
  // (amber/greyed/verdict) dans l'UI, mais ne masque plus le chiffre lui-même.
  const score = snapshot.score
  const history = compatibleHistory(input)
  const previous = history.at(-1)
  const delta = previous?.score != null && score != null ? score - previous.score : null
  const causes = reconcileCauses(weather, previous, delta)

  return {
    entity: { organizationId: input.organizationId, accountId: input.accountId },
    scope: 'account',
    status: score === null ? 'insufficient_evidence' : 'available',
    score,
    exploratoryScore: weather.score,
    dials: weather.dials,
    weakestDial: weather.weakestDial,
    reliability: snapshot.reliability,
    verdictAllowed: snapshot.verdictAllowed && snapshot.reliability >= RELIABILITY_PARAMS_V1.thresholds.verdict,
    display: presentation,
    coverage: {
      targetCount: input.coverageTargets.length,
      coveredCount: input.coverageTargets.filter((target) => target.covered).length,
    },
    dyads: eligible.map((state) => ({
      collaboratorUserId: state.entity.collaboratorUserId,
      contactId: state.entity.contactId,
      score: state.score!,
      reliability: state.reliability,
      authority: state.authority!,
    })),
    observedAt: input.at,
    computedAt: input.computedAt,
    history,
    delta,
    causes,
    scoringVersion: ACCOUNT_SCORING_VERSION,
    paramsVersion: input.params.version,
    registryVersion: input.registry.version,
    reliabilityParamsVersion: RELIABILITY_PARAMS_V1.version,
    errors: [...new Set(errors)].sort(),
  }
}
