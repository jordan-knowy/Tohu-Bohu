import { describe, expect, it } from 'vitest'
import { RELEVANCE_PARAMS_V1, computeRelevance, weightsSum } from '../computeRelevance'
import type { RelevanceDimensions } from '../computeRelevance'

const dims = (o: Partial<RelevanceDimensions> = {}): RelevanceDimensions => ({
  impact: 0, urgency: 0, novelty: 0, reliability: 0, actionability: 0, objectiveLink: 0, ...o,
})

describe('relevance_params-v1', () => {
  it('les poids somment à 1', () => {
    expect(weightsSum()).toBeCloseTo(1, 9)
  })
  it('statut provisional (jamais présenté comme validé)', () => {
    expect(RELEVANCE_PARAMS_V1.status).toBe('provisional')
  })
})

describe('computeRelevance — échelle commune 0-100 + breakdown', () => {
  it('toutes les dimensions à 1 → priorité 100', () => {
    const r = computeRelevance(dims({ impact: 1, urgency: 1, novelty: 1, reliability: 1, actionability: 1, objectiveLink: 1 }))
    expect(r.priority).toBe(100)
  })
  it('toutes à 0 → priorité 0', () => {
    expect(computeRelevance(dims()).priority).toBe(0)
  })
  it('exemple §35 (0.8875 → 89 ; l’exemple illustratif du prompt indiquait 88, arrondi approximatif)', () => {
    const r = computeRelevance(dims({ impact: 0.95, urgency: 0.80, actionability: 1, objectiveLink: 0.90, reliability: 0.85, novelty: 0.70 }))
    // .25*.95 + .20*.80 + .20*1 + .15*.90 + .10*.85 + .10*.70 = 0.8875 → round(88.75) = 89
    expect(r.priority).toBe(89)
    expect(r.breakdown.score).toBe(89)
    expect(r.breakdown.contributions.actionability).toBeCloseTo(0.20, 6)
  })
})

describe('computeRelevance — un axe faible n’annule pas le reste (pas de produit)', () => {
  it('impact=0, tout le reste=1 → 75 (pas 0)', () => {
    const r = computeRelevance(dims({ impact: 0, urgency: 1, novelty: 1, reliability: 1, actionability: 1, objectiveLink: 1 }))
    expect(r.priority).toBe(75)
  })
  it('objectiveLink=0, reste=1 → 85', () => {
    const r = computeRelevance(dims({ impact: 1, urgency: 1, novelty: 1, reliability: 1, actionability: 1, objectiveLink: 0 }))
    expect(r.priority).toBe(85)
  })
})

describe('computeRelevance — priorité ≠ gravité (§36)', () => {
  it('événement grave mais non actionnable < événement neutre mais urgent+actionnable', () => {
    const severeButStuck = computeRelevance(dims({ impact: 1, reliability: 1, actionability: 0, urgency: 0.1, novelty: 0.1, objectiveLink: 0.2 }))
    const neutralButUrgent = computeRelevance(dims({ impact: 0.3, reliability: 0.8, actionability: 1, urgency: 1, novelty: 0.9, objectiveLink: 0.8 }))
    expect(neutralButUrgent.priority).toBeGreaterThan(severeButStuck.priority)
  })
})

describe('computeRelevance — robustesse', () => {
  it('clamp des entrées hors [0,1] et NaN', () => {
    const r = computeRelevance({ impact: 5, urgency: -3, novelty: NaN, reliability: 1, actionability: 0.5, objectiveLink: 2 })
    expect(r.breakdown.impact).toBe(1)
    expect(r.breakdown.urgency).toBe(0)
    expect(r.breakdown.novelty).toBe(0)
    expect(r.breakdown.objectiveLink).toBe(1)
    expect(r.priority).toBeGreaterThanOrEqual(0)
    expect(r.priority).toBeLessThanOrEqual(100)
  })
  it('déterministe + version rapportée', () => {
    const input = dims({ impact: 0.5, urgency: 0.5 })
    expect(computeRelevance(input)).toEqual(computeRelevance(input))
    expect(computeRelevance(input).paramsVersion).toBe('relevance_params-v1')
  })
})
