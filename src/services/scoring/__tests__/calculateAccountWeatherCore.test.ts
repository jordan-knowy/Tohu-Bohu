import { describe, expect, it } from 'vitest'
import { calculateAccountWeatherCore } from '../calculateAccountWeatherCore'
import { PARAMS_V6_PALIER, REGISTRY_V6 } from '../registry-v6'
import type { AccountKEvent, AccountWeatherInput } from '../types'

const run = (input: AccountWeatherInput) => calculateAccountWeatherCore(input, PARAMS_V6_PALIER, REGISTRY_V6)
const kEv = (markerId: string, extra: Partial<AccountKEvent> = {}): AccountKEvent =>
  ({ markerId, observedAt: '2026-06-01T00:00:00Z', evidenceRef: `k-${markerId}`, ...extra })

// Scénario de référence V6 (Client/Prospect) — §24.
const REFERENCE: AccountWeatherInput = {
  relationType: 'Client/Prospect',
  activeDyads: [{ contactId: 'christele', authority: 0.3, satisfaction: 46, confiance: 62, reciprocite: 58 }],
  coverage: {
    targets: [
      { role: 'utilisateur', authority: 0.3, covered: true, isDecider: false },
      { role: 'decideur', authority: 1.0, covered: false, isDecider: true },
    ],
  },
  equilibreShares: [180, 4],
  carriers: 1,
  kEvents: [kEv('K04')],
  dynamics: { delta30OtherDials: -6, daysSinceLast: 21, cadenceMedian: 9, engagementsHeld: 1, engagementsSlipped: 2 },
}

describe('reference_account_v6 — test bloquant (mode Palier) → Météo 33', () => {
  const r = run(REFERENCE)
  it('produit les 6 cadrans attendus', () => {
    expect(r.dials.d_satisfaction.value).toBe(46)
    expect(r.dials.d_confiance_recip.value).toBe(60)
    expect(r.dials.d_couverture.value).toBe(23)
    expect(r.dials.d_equilibre.value).toBe(4)
    expect(r.dials.d_ancrage.value).toBe(25)
    expect(r.dials.d_dynamique.value).toBe(17)
  })
  it('produit la Météo 33 et le cadran le plus faible = Équilibre', () => {
    expect(r.score).toBe(33)
    expect(r.weakestDial).toBe('d_equilibre')
  })
  it('Client/Prospect est current_reference (les autres types sont provisional)', () => {
    expect(r.relationTypeStatus).toBe('current_reference')
    expect(run({ ...REFERENCE, relationType: 'Partenaire' }).relationTypeStatus).toBe('provisional')
  })
  it('la Dynamique expose ses sous-composantes (pente/silence/solde)', () => {
    expect(r.dials.d_dynamique.note).toContain('pente=20')
    expect(r.dials.d_dynamique.note).toContain('silence=33')
    expect(r.dials.d_dynamique.note).toContain('solde=40')
    expect(r.dials.d_dynamique.modifiers.map((m) => m.markerId)).toContain('K04')
  })
  it('la Dynamique expose le Δ 30j réel (jamais un texte de debug) — UI', () => {
    expect(r.dials.d_dynamique.trendDelta30d).toBe(-6)
  })
  it('un K appliqué conserve sa preuve (evidenceRef/observedAt) pour l’UI « Preuves »', () => {
    const k04 = r.dials.d_dynamique.modifiers.find((m) => m.markerId === 'K04')!
    expect(k04.evidenceRef).toBe('k-K04')
    expect(k04.observedAt).toBe('2026-06-01T00:00:00Z')
  })
})

describe('mécanisme — redistribution du poids si un cadran est null', () => {
  it('sans dyade active, Satisfaction et C&R sont null et leur poids est redistribué', () => {
    const r = run({ ...REFERENCE, activeDyads: [] })
    expect(r.dials.d_satisfaction.value).toBeNull()
    expect(r.dials.d_confiance_recip.value).toBeNull()
    expect(r.dials.d_satisfaction.effectiveWeight).toBe(0)
    const totalEff = (['d_couverture', 'd_equilibre', 'd_ancrage', 'd_dynamique'] as const)
      .reduce((s, d) => s + r.dials[d].effectiveWeight, 0)
    expect(totalEff).toBeCloseTo(1, 6)
    expect(typeof r.score).toBe('number')
  })
})

describe('mécanisme — HHI / Équilibre', () => {
  it('deux contacts égaux → HHI 0.5 → Équilibre 50', () => {
    expect(run({ ...REFERENCE, equilibreShares: [100, 100] }).dials.d_equilibre.value).toBe(50)
  })
  it('un seul interlocuteur → Équilibre 0', () => {
    expect(run({ ...REFERENCE, equilibreShares: [200] }).dials.d_equilibre.value).toBe(0)
  })
})

describe('mécanisme — pondération par autorité', () => {
  it('Décideur (1.0, S=80) pèse plus qu’Utilisateur (0.3, S=40)', () => {
    const r = run({
      ...REFERENCE,
      activeDyads: [
        { contactId: 'd', authority: 1.0, satisfaction: 80, confiance: 80, reciprocite: 80 },
        { contactId: 'u', authority: 0.3, satisfaction: 40, confiance: 40, reciprocite: 40 },
      ],
    })
    // (1.0×80 + 0.3×40) / 1.3 = 70.77 → 71
    expect(r.dials.d_satisfaction.value).toBe(71)
  })
})

describe('mécanisme — plafonds K et résolution', () => {
  it('K06 ouvert → Satisfaction ≤ 20', () => {
    const r = run({
      ...REFERENCE,
      activeDyads: [{ contactId: 'c', authority: 0.3, satisfaction: 90, confiance: 90, reciprocite: 90 }],
      kEvents: [kEv('K06')],
    })
    expect(r.dials.d_satisfaction.cappedBy).toBe('K06')
    expect(r.dials.d_satisfaction.value!).toBeLessThanOrEqual(20)
  })
  it('K01 ouvert > 12 mois → Dynamique ≤ 15', () => {
    const r = run({ ...REFERENCE, kEvents: [kEv('K01', { openMonths: 13 })] })
    expect(r.dials.d_dynamique.cappedBy).toBe('K01>12mois')
    expect(r.dials.d_dynamique.value!).toBeLessThanOrEqual(15)
  })
  it('un K résolu cesse son effet (K04 résolu → pas de −14 sur Dynamique)', () => {
    const withK = run(REFERENCE).dials.d_dynamique.value!
    const resolved = run({ ...REFERENCE, kEvents: [kEv('K04', { resolvedAt: '2026-07-01T00:00:00Z' })] }).dials.d_dynamique.value!
    expect(withK).toBe(17)
    expect(resolved).toBe(31) // base sans le modificateur K04
    expect(resolved).toBeGreaterThan(withK)
  })
})

describe('mécanisme — Couverture : niveau relationnel continu (relationalLevel)', () => {
  it('rétro-compatible : sans relationalLevel, covered=true équivaut à relationalLevel=1', () => {
    const withCovered = run(REFERENCE).dials.d_couverture.value
    const withLevel = run({
      ...REFERENCE,
      coverage: { targets: [
        { role: 'utilisateur', authority: 0.3, covered: true, isDecider: false, relationalLevel: 1 },
        { role: 'decideur', authority: 1.0, covered: false, isDecider: true, relationalLevel: 0 },
      ] },
    }).dials.d_couverture.value
    expect(withLevel).toBe(withCovered)
  })
  it('un niveau relationnel intermédiaire (0.5) pèse moins qu’un niveau plein (1.0)', () => {
    const base = { role: 'utilisateur', authority: 0.3, covered: true, isDecider: false }
    const full = run({ ...REFERENCE, coverage: { targets: [{ ...base, relationalLevel: 1 }] } }).dials.d_couverture.value!
    const partial = run({ ...REFERENCE, coverage: { targets: [{ ...base, relationalLevel: 0.5 }] } }).dials.d_couverture.value!
    expect(partial).toBeLessThan(full)
    expect(partial).toBe(50)
  })
  it('relationalLevel=0 (aucune interaction réelle) équivaut à non couvert', () => {
    const target = { role: 'utilisateur', authority: 0.3, covered: false, isDecider: false, relationalLevel: 0 }
    expect(run({ ...REFERENCE, coverage: { targets: [target] } }).dials.d_couverture.value).toBe(0)
  })
})

describe('mécanisme — citation verbatim (evidenceText/isVerbatim) jusqu’aux Preuves', () => {
  it('un K conserve sa citation et son statut verbatim pour l’UI « Preuves »', () => {
    const r = run({ ...REFERENCE, kEvents: [kEv('K04', { evidenceText: 'Le livrable promis pour vendredi n’est toujours pas arrivé.', isVerbatim: true })] })
    const k04 = r.dials.d_dynamique.modifiers.find((m) => m.markerId === 'K04')!
    expect(k04.evidenceText).toBe('Le livrable promis pour vendredi n’est toujours pas arrivé.')
    expect(k04.isVerbatim).toBe(true)
  })
  it('sans evidenceText fourni, le modificateur reste exploitable (null, jamais inventé)', () => {
    const r = run(REFERENCE)
    const k04 = r.dials.d_dynamique.modifiers.find((m) => m.markerId === 'K04')!
    expect(k04.evidenceText).toBeNull()
    expect(k04.isVerbatim).toBe(false)
  })
})

describe('invariant — déterminisme + versions', () => {
  it('même entrée → même sortie ; versions rapportées', () => {
    expect(run(REFERENCE)).toEqual(run(REFERENCE))
    const r = run(REFERENCE)
    expect(r.mode).toBe('palier')
    expect(r.paramsVersion).toBe('params-v6.0-palier')
    expect(r.registryVersion).toBe('reg-v6.0')
  })
})
