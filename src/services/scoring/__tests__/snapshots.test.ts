import { describe, expect, it } from 'vitest'
import { PARAMS_V6_PALIER, REGISTRY_V6 } from '../registry-v6'
import {
  buildDyadScoreSnapshot, displayRule, reliabilityDyad, statusFromCadence,
} from '../snapshots'
import { computeDelta30, monthlySteps, replayDyadMonthly } from '../replay'
import type { DyadRole, MarkerEvent } from '../types'
import type { DyadSnapshotInput } from '../snapshots'

const ROLE: DyadRole = { label: 'Direction', volontariteProfile: 'standard' }
let seq = 0
const ev = (markerId: string, observedAt: string, sense: -1 | 1 = 1): MarkerEvent =>
  ({ markerId, sense, observedAt, evidenceRef: `r-${seq++}` })

// 15 événements de référence, tous en 2026-05 (assez pour P7).
const REF_EVENTS: MarkerEvent[] = [
  ev('C01', '2026-05-01T00:00:00Z'),
  ...[1, 2, 3].map((d) => ev('C04', `2026-05-0${d}T00:00:00Z`)),
  ev('S01', '2026-05-02T00:00:00Z'), ev('S02', '2026-05-02T00:00:00Z'), ev('S03', '2026-05-02T00:00:00Z'), ev('S08', '2026-05-02T00:00:00Z'),
  ev('E01', '2026-05-03T00:00:00Z'), ev('E05', '2026-05-03T00:00:00Z', 1), ev('E05', '2026-05-04T00:00:00Z', 1),
  ev('R01', '2026-05-03T00:00:00Z', -1), ev('R02', '2026-05-03T00:00:00Z', 1),
  ev('A01', '2026-05-03T00:00:00Z', 1), ev('A02', '2026-05-03T00:00:00Z', 1),
]
const base = (over: Partial<DyadSnapshotInput> = {}): DyadSnapshotInput => ({
  markerEvents: REF_EVENTS, role: ROLE, at: '2026-06-01T00:00:00Z',
  context: { ageDays: 200, episodes: 20, daysSinceLast: 10, cadenceMedian: 9, hasX02: false },
  reliabilityInputs: { channelCoverage: 1, identityResolution: 1, diarizationQuality: 1, hasX01: false },
  params: PARAMS_V6_PALIER, registry: REGISTRY_V6, ...over,
})

describe('S6 — P5 cold start', () => {
  it('âge < 30 j → score null, verdict false, statut cold_start', () => {
    const s = buildDyadScoreSnapshot(base({ context: { ageDays: 10, episodes: 20, daysSinceLast: 2, cadenceMedian: 5, hasX02: false } }))
    expect(s.score).toBeNull()
    expect(s.coldStart).toBe(true)
    expect(s.verdictAllowed).toBe(false)
    expect(s.status).toBe('cold_start')
  })
  it('< 5 épisodes → cold start', () => {
    expect(buildDyadScoreSnapshot(base({ context: { ageDays: 200, episodes: 3, daysSinceLast: 2, cadenceMedian: 5, hasX02: false } })).coldStart).toBe(true)
  })
})

describe('S6 — P7 verdict', () => {
  it('≥ 5 marqueurs datés → verdict autorisé, score calculé (55)', () => {
    const s = buildDyadScoreSnapshot(base())
    expect(s.markerCount).toBe(15)
    expect(s.verdictAllowed).toBe(true)
    expect(s.score).toBe(55)
  })
  it('< 5 marqueurs → score possible mais verdict refusé', () => {
    const few = [ev('C01', '2026-05-01T00:00:00Z'), ev('C04', '2026-05-02T00:00:00Z')]
    const s = buildDyadScoreSnapshot(base({ markerEvents: few }))
    expect(s.markerCount).toBe(2)
    expect(s.verdictAllowed).toBe(false)
    expect(typeof s.score).toBe('number') // technique
  })
})

describe('S6 — fiabilité', () => {
  it('X01 (canal non instrumenté) plafonne la fiabilité', () => {
    const withoutX01 = reliabilityDyad({ channelCoverage: 1, identityResolution: 1, diarizationQuality: 1, markerCount: 10, hasX01: false })
    const withX01 = reliabilityDyad({ channelCoverage: 1, identityResolution: 1, diarizationQuality: 1, markerCount: 10, hasX01: true })
    expect(withoutX01).toBe(1)
    expect(withX01).toBeLessThanOrEqual(0.6)
  })
  it('boîte partagée (identité ≤ 0.60) réduit la fiabilité', () => {
    const clean = reliabilityDyad({ channelCoverage: 1, identityResolution: 1, diarizationQuality: 1, markerCount: 10, hasX01: false })
    const shared = reliabilityDyad({ channelCoverage: 1, identityResolution: 0.6, diarizationQuality: 1, markerCount: 10, hasX01: false })
    expect(shared).toBeLessThan(clean)
    expect(shared).toBeCloseTo(0.6, 6)
  })
  it('faible volume réduit la fiabilité', () => {
    const low = reliabilityDyad({ channelCoverage: 1, identityResolution: 1, diarizationQuality: 1, markerCount: 2, hasX01: false })
    expect(low).toBeCloseTo(2 / 8, 6)
  })
})

describe('S6 — statut cadence (jamais un seuil absolu)', () => {
  it('mappe selon la cadence propre', () => {
    expect(statusFromCadence(10, 9, false)).toBe('actif')      // 1.11×
    expect(statusFromCadence(20, 9, false)).toBe('ralenti')    // 2.22×
    expect(statusFromCadence(40, 9, false)).toBe('dormant')    // 4.4×
    expect(statusFromCadence(60, 9, false)).toBe('rompu')      // 6.7×
    expect(statusFromCadence(1, 9, true)).toBe('rompu')        // X02
  })
})

describe('S6 — règle d’affichage fiabilité', () => {
  it('< .50 → grisé sans verdict ; .50–.59 → ambre ; ≥ .60 + verdict → complet', () => {
    expect(displayRule(0.4, true)).toBe('score_greyed_no_verdict')
    expect(displayRule(0.55, true)).toBe('score_amber')
    expect(displayRule(0.7, true)).toBe('score_and_verdict')
    expect(displayRule(0.9, false)).toBe('score_greyed_no_verdict') // P7 faux
  })
})

describe('S7 — rejeu temporel (escalier mensuel, observed_at ≤ T)', () => {
  it('monthlySteps produit des 1ers de mois chronologiques', () => {
    const steps = monthlySteps(new Date('2026-06-15T00:00:00Z'), 3)
    expect(steps.map((s) => s.slice(0, 10))).toEqual(['2026-04-01', '2026-05-01', '2026-06-01'])
  })
  it('un marqueur observé après T est exclu (pas d’anticipation)', () => {
    // C01 en mars, un second lot en juin
    const events = [ev('C01', '2026-03-10T00:00:00Z'), ev('C05', '2026-06-10T00:00:00Z')]
    const b = { ...base({ markerEvents: events }) }
    const { at, ...rest } = b
    const april = buildDyadScoreSnapshot({ ...rest, at: '2026-04-01T00:00:00Z' })
    const july = buildDyadScoreSnapshot({ ...rest, at: '2026-07-01T00:00:00Z' })
    expect(april.markerCount).toBe(1)   // seul C01
    expect(july.markerCount).toBe(2)    // C01 + C05
    expect(july.score!).toBeGreaterThan(april.score!) // C05 ajoute de la confiance
  })
  it('replayDyadMonthly : chaque marche est un calcul réel, sans interpolation', () => {
    const events = [ev('C01', '2026-03-10T00:00:00Z'), ev('C04', '2026-05-10T00:00:00Z')]
    const { at, ...rest } = base({ markerEvents: events })
    const points = replayDyadMonthly(rest, monthlySteps(new Date('2026-06-01T00:00:00Z'), 4))
    // mars: 1 marqueur ; avril: idem ; mai: 2 ; juin: 2 — score non décroissant ici
    expect(points).toHaveLength(4)
    expect(points[0]!.snapshotMonth).toBe('2026-03-01')
    expect(points[3]!.snapshotMonth).toBe('2026-06-01')
  })
  it('delta 30 j = score(T) − score(T−30j)', () => {
    const events = [ev('C01', '2026-03-10T00:00:00Z'), ev('C05', '2026-05-20T00:00:00Z')]
    const { at, ...rest } = base({ markerEvents: events })
    const delta = computeDelta30(rest, '2026-06-01T00:00:00Z')
    // à T-30 (2 mai) seul C01 ; à T (1 juin) C01+C05 → delta > 0
    expect(delta!).toBeGreaterThan(0)
  })
  it('reproductibilité : mêmes versions + mêmes events ≤ T → score identique', () => {
    const a = buildDyadScoreSnapshot(base())
    const b = buildDyadScoreSnapshot(base())
    expect(a.score).toBe(b.score)
    expect(a.paramsVersion).toBe('params-v6.0-palier')
  })
})
