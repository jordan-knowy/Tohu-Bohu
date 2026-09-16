import { describe, expect, it } from 'vitest'
import { calculateDyadScoreCore } from '../calculateDyadScoreCore'
import { PARAMS_V6_PALIER, PARAMS_V6_SPEC, REGISTRY_V6 } from '../registry-v6'
import type { DyadRole, MarkerEvent } from '../types'

const DIRECTION: DyadRole = { label: 'Direction', volontariteProfile: 'standard' }
const EXECUTION: DyadRole = { label: 'Exécution', volontariteProfile: 'execution' }

let seq = 0
function ev(markerId: string, sense: -1 | 1 = 1, n = 1, observedAt = '2026-06-01T00:00:00Z'): MarkerEvent[] {
  return Array.from({ length: n }, () => ({ markerId, sense, observedAt, evidenceRef: `ref-${seq++}` }))
}
const run = (events: MarkerEvent[], role = DIRECTION, params = PARAMS_V6_PALIER) =>
  calculateDyadScoreCore(events, role, params, REGISTRY_V6)

// Marqueurs exacts du test de référence V6 (mode Palier).
const REFERENCE_EVENTS: MarkerEvent[] = [
  ...ev('C01', 1, 1),
  ...ev('C04', 1, 3),
  ...ev('S01'), ...ev('S02'), ...ev('S03'), ...ev('S08'),
  ...ev('E01'),
  ...ev('E05', 1, 2),
  ...ev('R01', -1), // défavorable
  ...ev('R02', 1),  // favorable
  ...ev('A01', 1), ...ev('A02', 1),
]

describe('reference_person_v6 — test bloquant (mode Palier) → 55', () => {
  const r = run(REFERENCE_EVENTS)

  it('produit les 5 axes attendus', () => {
    expect(r.axes.confiance.value).toBe(82)
    expect(r.axes.satisfaction.value).toBe(17)
    expect(r.axes.engagement.value).toBe(72)
    expect(r.axes.reciprocite.value).toBe(38)
    expect(r.axes.ancrage.value).toBe(78)
  })

  it('produit le score final 55', () => {
    expect(r.score).toBe(55)
  })

  it('expose les contributions intermédiaires (« Pourquoi 82 ? »)', () => {
    const c = r.axes.confiance.contributions
    const c01 = c.find((x) => x.markerId === 'C01')!
    const c04 = c.find((x) => x.markerId === 'C04')!
    // C01 : Important +20, vol 1.0, rép 1.0 → magnitude 20, rang 1, decay 1.0
    expect(c01.pointsEffectifs).toBe(20)
    expect(c01.rank).toBe(1)
    expect(c01.decayMultiplier).toBe(1.0)
    expect(c01.contributionFinale).toBeCloseTo(20, 6)
    // C04 : Moyen +12 (PALIER, pas +14 SPEC), vol 1.0, 3 occ → rép 1.4, magnitude 16.8, rang 2, decay 0.7
    expect(c04.occurrences).toBe(3)
    expect(c04.pointsEffectifs).toBe(12)
    expect(c04.repetitionMultiplier).toBe(1.4)
    expect(c04.magnitude).toBeCloseTo(16.8, 6)
    expect(c04.rank).toBe(2)
    expect(c04.decayMultiplier).toBe(0.7)
    expect(c04.contributionFinale).toBeCloseTo(11.76, 6)
  })

  it('rapporte les versions et le mode (reproductibilité)', () => {
    expect(r.mode).toBe('palier')
    expect(r.paramsVersion).toBe('params-v6.0-palier')
    expect(r.registryVersion).toBe('reg-v6.0')
  })
})

describe('mécanisme — répétition 1 / 2-3 / 4+', () => {
  it('1 → ×1.0, 3 → ×1.4, 5 → ×1.7', () => {
    const get = (n: number) => run(ev('C04', 1, n)).axes.confiance.contributions[0]!
    expect(get(1).repetitionMultiplier).toBe(1.0)
    expect(get(3).repetitionMultiplier).toBe(1.4)
    expect(get(5).repetitionMultiplier).toBe(1.7)
  })
})

describe('mécanisme — décroissance appliquée APRÈS tri par magnitude', () => {
  it('le rang suit la magnitude, pas l’ordre d’entrée', () => {
    // C02 (faible +6, vol 0.6 → mag 3.6) fourni AVANT C01 (important +20 → mag 20)
    const r = run([...ev('C02'), ...ev('C01')])
    const c01 = r.axes.confiance.contributions.find((x) => x.markerId === 'C01')!
    const c02 = r.axes.confiance.contributions.find((x) => x.markerId === 'C02')!
    expect(c01.rank).toBe(1)
    expect(c01.decayMultiplier).toBe(1.0)
    expect(c02.rank).toBe(2)
    expect(c02.decayMultiplier).toBe(0.7)
  })
})

describe('mécanisme — regroupement par (marker_id, sense)', () => {
  it('même marqueur + même sens = 1 groupe (occurrences cumulées)', () => {
    const c = run(ev('R01', 1, 3)).axes.reciprocite.contributions
    expect(c).toHaveLength(1)
    expect(c[0]!.occurrences).toBe(3)
  })
  it('même marqueur bipolaire, sens opposés = 2 groupes', () => {
    const c = run([...ev('R01', 1), ...ev('R01', -1)]).axes.reciprocite.contributions
    expect(c).toHaveLength(2)
    expect(c.map((x) => x.sense).sort()).toEqual([-1, 1])
  })
})

describe('mécanisme — Palier et SPEC tirent leurs points de sources différentes', () => {
  it('C03 : Palier +12 (moyen) vs SPEC +10 (pts_spec)', () => {
    expect(run(ev('C03'), DIRECTION, PARAMS_V6_PALIER).axes.confiance.contributions[0]!.pointsEffectifs).toBe(12)
    expect(run(ev('C03'), DIRECTION, PARAMS_V6_SPEC).axes.confiance.contributions[0]!.pointsEffectifs).toBe(10)
  })
  it('C04 : Palier +12 vs SPEC +14', () => {
    expect(run(ev('C04'), DIRECTION, PARAMS_V6_PALIER).axes.confiance.contributions[0]!.pointsEffectifs).toBe(12)
    expect(run(ev('C04'), DIRECTION, PARAMS_V6_SPEC).axes.confiance.contributions[0]!.pointsEffectifs).toBe(14)
  })
})

describe('mécanisme — S07 plafonne Satisfaction à 20 APRÈS calcul', () => {
  it('avec S07, même avec des positifs, Satisfaction ≤ 20', () => {
    const r = run([...ev('S08', 1, 5), ...ev('S07')])
    expect(r.axes.satisfaction.cappedByS07).toBe(true)
    expect(r.axes.satisfaction.value).toBeLessThanOrEqual(20)
  })
  it('sans S07, les mêmes positifs dépassent 20', () => {
    const r = run(ev('S08', 1, 5))
    expect(r.axes.satisfaction.cappedByS07).toBe(false)
    expect(r.axes.satisfaction.value).toBeGreaterThan(20)
  })
})

describe('mécanisme — clamp des axes à [0, 100]', () => {
  it('surcharge positive → 100', () => {
    const r = run([...ev('C01', 1, 4), ...ev('C05', 1, 4)])
    expect(r.axes.confiance.value).toBe(100)
  })
  it('surcharge négative (sans S07) → 0', () => {
    const r = run([...ev('S02', 1, 4), ...ev('S01', 1, 4), ...ev('S03', 1, 4), ...ev('S06', 1, 4)])
    expect(r.axes.satisfaction.cappedByS07).toBe(false)
    expect(r.axes.satisfaction.value).toBe(0)
  })
})

describe('mécanisme — volontarité 0.3 / 0.6 / 1.0 + exception Exécution', () => {
  it('standard : E05→0.3, E03→0.6, E01→1.0', () => {
    const c = run([...ev('E01'), ...ev('E03'), ...ev('E05', 1)]).axes.engagement.contributions
    expect(c.find((x) => x.markerId === 'E05')!.volontarite).toBe(0.3)
    expect(c.find((x) => x.markerId === 'E03')!.volontarite).toBe(0.6)
    expect(c.find((x) => x.markerId === 'E01')!.volontarite).toBe(1.0)
  })
  it('rôle Exécution : 0.3→0.5 et 0.6→1.0', () => {
    const c = run([...ev('E03'), ...ev('E05', 1)], EXECUTION).axes.engagement.contributions
    expect(c.find((x) => x.markerId === 'E05')!.volontarite).toBe(0.5)
    expect(c.find((x) => x.markerId === 'E03')!.volontarite).toBe(1.0)
  })
})

describe('invariants — aucun decay temporel, ordre indifférent, déterminisme', () => {
  it('des dates anciennes ou récentes donnent le même résultat (pas de decay temporel)', () => {
    const old = REFERENCE_EVENTS.map((e) => ({ ...e, observedAt: '2001-01-01T00:00:00Z' }))
    const recent = REFERENCE_EVENTS.map((e) => ({ ...e, observedAt: '2026-09-01T00:00:00Z' }))
    expect(run(old).score).toBe(run(recent).score)
    expect(run(old).axes.satisfaction.value).toBe(run(recent).axes.satisfaction.value)
  })
  it('l’ordre des marker_events n’influence pas le résultat', () => {
    const shuffled = [...REFERENCE_EVENTS].reverse()
    const a = run(REFERENCE_EVENTS)
    const b = run(shuffled)
    expect(b.score).toBe(a.score)
    expect(b.axes.confiance.value).toBe(a.axes.confiance.value)
    expect(b.axes.satisfaction.value).toBe(a.axes.satisfaction.value)
  })
  it('même entrée + mêmes versions = sortie strictement identique', () => {
    expect(run(REFERENCE_EVENTS)).toEqual(run(REFERENCE_EVENTS))
  })
})

describe('invariants — axe sans marqueur = base 50, marqueur inconnu ignoré', () => {
  it('un axe sans marqueur vaut 50 (pas null ici : le null est la couche snapshot)', () => {
    const r = run(ev('C01'))
    expect(r.axes.confiance.value).toBe(70) // 50 + 20
    expect(r.axes.ancrage.value).toBe(50)
    expect(r.axes.ancrage.contributions).toHaveLength(0)
  })
  it('un marker_id absent du registre est ignoré (jamais scoré)', () => {
    const r = run([...ev('C01'), { markerId: 'S99', sense: 1, observedAt: '2026-01-01T00:00:00Z', evidenceRef: 'x' }])
    expect(r.axes.confiance.value).toBe(70)
    // S99 n'existe pas → aucune contribution nulle part
    expect(Object.values(r.axes).every((a) => a.contributions.every((c) => c.markerId !== 'S99'))).toBe(true)
  })
})
