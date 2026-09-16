import { describe, expect, it } from 'vitest'
import { deriveRelevanceDimensions, factToPriority } from '../deriveDimensions'
import type { FactForRelevance } from '../deriveDimensions'

const NOW = new Date('2026-09-14T00:00:00Z')
const fact = (o: Partial<FactForRelevance> = {}): FactForRelevance => ({
  factType: 'event', impact: 'neutral', occurredAt: '2026-09-13T00:00:00Z', firstSeenAt: '2026-09-13T00:00:00Z',
  confidence: 80, inferenceLevel: 'strong_inference', linkedToObjective: false, ...o,
})

describe('deriveRelevanceDimensions — chaque dimension justifiée par le fact', () => {
  it('un engagement en retard → urgence 1', () => {
    expect(deriveRelevanceDimensions(fact({ factType: 'commitment', isOverdue: true }), 'client', NOW).urgency).toBe(1)
  })
  it('un risque a plus d’impact qu’un milestone', () => {
    const risk = deriveRelevanceDimensions(fact({ factType: 'risk', impact: 'friction' }), 'client', NOW).impact
    const ms = deriveRelevanceDimensions(fact({ factType: 'milestone', impact: 'milestone' }), 'client', NOW).impact
    expect(risk).toBeGreaterThan(ms)
  })
  it('lien avec l’objectif courant relève objectiveLink', () => {
    expect(deriveRelevanceDimensions(fact({ linkedToObjective: true }), 'client', NOW).objectiveLink).toBe(1)
    expect(deriveRelevanceDimensions(fact({ linkedToObjective: false }), 'client', NOW).objectiveLink).toBeLessThan(1)
  })
  it('inference_level=fact → fiabilité plus forte que inferred', () => {
    const f = deriveRelevanceDimensions(fact({ inferenceLevel: 'fact', confidence: 100 }), 'client', NOW).reliability
    const i = deriveRelevanceDimensions(fact({ inferenceLevel: 'inferred', confidence: 100 }), 'client', NOW).reliability
    expect(f).toBeGreaterThan(i)
  })
})

describe('§37/§40 — un état permanent n’est pas un signal récent', () => {
  it('même fait : version permanente < version changement frais', () => {
    const change = factToPriority(fact({ factType: 'risk', impact: 'friction', isPermanentState: false }), 'client', NOW)
    const permanent = factToPriority(fact({ factType: 'risk', impact: 'friction', isPermanentState: true, occurredAt: '2026-08-01T00:00:00Z', firstSeenAt: '2026-08-01T00:00:00Z' }), 'client', NOW)
    expect(permanent.breakdown.novelty).toBeLessThanOrEqual(0.15)
    expect(permanent.priority).toBeLessThan(change.priority)
  })
})

describe('factToPriority — chaîne complète, échelle 0-100', () => {
  it('risque actionnable en retard lié à l’objectif → priorité élevée', () => {
    const r = factToPriority(fact({ factType: 'risk', impact: 'friction', isOverdue: true, linkedToObjective: true, inferenceLevel: 'fact', confidence: 95 }), 'client', NOW)
    expect(r.priority).toBeGreaterThan(70)
    expect(r.priority).toBeLessThanOrEqual(100)
  })
  it('événement neutre ancien et permanent → priorité basse', () => {
    const r = factToPriority(fact({ factType: 'event', impact: 'neutral', occurredAt: '2026-01-01T00:00:00Z', firstSeenAt: '2026-01-01T00:00:00Z', isPermanentState: true, linkedToObjective: false }), 'client', NOW)
    expect(r.priority).toBeLessThan(50)
  })
  it('déterministe', () => {
    const f = fact({ factType: 'opportunity' })
    expect(factToPriority(f, 'prospect', NOW)).toEqual(factToPriority(f, 'prospect', NOW))
  })
})
