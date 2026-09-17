import { describe, expect, it } from 'vitest'
import { buildCanonicalAccountState, ACCOUNT_SCORING_VERSION } from './account-state.ts'
import { PARAMS_V6_PALIER, REGISTRY_V6 } from './registry-v6.ts'
import type { RelationalState } from './foundation.ts'

const state = (overrides: Partial<RelationalState> = {}): RelationalState => ({
  entity: { organizationId: 'org', collaboratorUserId: 'user', contactId: 'contact' },
  scope: 'individual_dyad', status: 'actif', observedAt: '2026-09-17T00:00:00Z', computedAt: '2026-09-17T00:00:00Z',
  knowledgeAt: '2026-09-17T00:00:00Z', replayMode: 'state_as_known_at_T', score: 70, exploratoryScore: 70,
  axes: { confiance: 70, satisfaction: 80, engagement: 60, reciprocite: 65, ancrage: 50 }, reliability: .8,
  coverage: { value: 1, completeness: 'complete', expectedChannels: ['email'], observedChannels: ['email'] },
  authority: 1, declaredRole: { label: 'Décideur', volontariteProfile: 'standard' }, inferredRole: null,
  admissibility: { display: true, verdict: true, account: true, recommendation: true, trend: true, reasons: [] },
  evidence: [], contributions: [], history: [], delta: null, causes: [], scoringVersion: 'v6-foundation-1',
  paramsVersion: PARAMS_V6_PALIER.version, registryVersion: REGISTRY_V6.version, errors: [], ...overrides,
})

const base = (dyads: RelationalState[]) => ({
  organizationId: 'org', accountId: 'account', at: '2026-09-17T00:00:00Z', computedAt: '2026-09-17T00:00:01Z',
  relationType: 'Client/Prospect', dyads, coverageTargets: [{ role: 'decideur', authority: 1, covered: true, isDecider: true, relationalLevel: 1 }],
  equilibreShares: [5, 5], carriers: 2, kEvents: [],
  dynamics: { delta30OtherDials: 0, daysSinceLast: 2, cadenceMedian: 7, engagementsHeld: 1, engagementsSlipped: 0 },
  params: PARAMS_V6_PALIER, registry: REGISTRY_V6,
})

describe('canonical account state', () => {
  it('does not turn absence of admissible dyads into authority', () => {
    const result = buildCanonicalAccountState(base([state({ score: null, admissibility: { display: false, verdict: false, account: false, recommendation: false, trend: false, reasons: ['UNKNOWN_ROLE'] } })]))
    expect(result.score).toBeNull()
    expect(result.dyads).toEqual([])
    expect(result.status).toBe('insufficient_evidence')
  })

  it('rejects amber reliability as an authoritative account score', () => {
    const result = buildCanonicalAccountState(base([state({ reliability: .55 })]))
    expect(result.exploratoryScore).not.toBeNull()
    expect(result.score).toBeNull()
    expect(result.display).toBe('score_amber')
  })

  it('keeps dynamics null when its evidence is unavailable', () => {
    const input = base([state()])
    const result = buildCanonicalAccountState({ ...input, dynamics: { ...input.dynamics, available: false } })
    expect(result.dials.d_dynamique.value).toBeNull()
  })

  it('publishes a score only from admissible, reliable dyads', () => {
    const result = buildCanonicalAccountState(base([state()]))
    expect(result.score).not.toBeNull()
    expect(result.verdictAllowed).toBe(true)
    expect(result.dyads).toHaveLength(1)
  })

  it('keeps incompatible history out and reconciles compatible delta causes', () => {
    const current = buildCanonicalAccountState({
      ...base([state()]),
      history: [
        { observedAt: '2026-08-17T00:00:00Z', score: 60, dials: { d_satisfaction: 60, d_confiance_recip: 60 }, scoringVersion: ACCOUNT_SCORING_VERSION, paramsVersion: PARAMS_V6_PALIER.version, registryVersion: REGISTRY_V6.version },
        { observedAt: '2026-08-18T00:00:00Z', score: 99, dials: {}, scoringVersion: 'old', paramsVersion: PARAMS_V6_PALIER.version, registryVersion: REGISTRY_V6.version },
      ],
    })
    expect(current.history).toHaveLength(1)
    expect(current.delta).toBe(current.score! - 60)
    expect(current.causes.reduce((sum, cause) => sum + cause.points, 0)).toBeCloseTo(current.delta!, 10)
  })

  it('excludes a cross-organization dyad', () => {
    const result = buildCanonicalAccountState(base([state({ entity: { organizationId: 'other', collaboratorUserId: 'user', contactId: 'contact' } })]))
    expect(result.dyads).toEqual([])
    expect(result.errors).toContain('CROSS_ORGANIZATION_DYAD')
  })
})
