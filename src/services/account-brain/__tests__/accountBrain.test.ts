import { describe, expect, it } from 'vitest'
import { rankDelta, rankSignals, toRelationType } from '../accountBrain'
import type { AccountBrainDTO, BrainFact } from '../accountBrain'

const NOW = new Date('2026-09-14T00:00:00Z')
const f = (o: Partial<BrainFact>): BrainFact => ({
  id: Math.random().toString(36).slice(2), fact_type: 'event', title: 't', detail: null, impact: 'neutral',
  occurred_at: '2026-09-13T00:00:00Z', first_seen_at: '2026-09-13T00:00:00Z', is_overdue: false, due_window_end: null,
  confidence: 80, inference_level: 'strong_inference', subject_contact_id: null, evidence_count: 2, has_verbatim: false, kind: 'inference', ...o,
})
const dto = (facts: BrainFact[], relation = 'client', delta?: BrainFact[]): AccountBrainDTO => ({
  generated_at: NOW.toISOString(), account: { id: 'a', name: 'Acme', relation_type: relation },
  weather: { status: 'insufficient_data' }, dimensions: { status: 'insufficient_data' }, situation: { status: 'insufficient_data' },
  delta_since_last: delta ? { status: 'available', personal: true, t0: '2026-09-10T00:00:00Z', facts: delta } : { status: 'no_personal_interaction', message: 'x' },
  active_facts: facts, engagements: [], recommendations: [], history: [], availability: {},
})

describe('toRelationType', () => {
  it('mappe les libellés FR', () => {
    expect(toRelationType('Client')).toBe('client')
    expect(toRelationType('Collègue')).toBe('interne')
    expect(toRelationType('inconnu')).toBe('autre')
  })
})

describe('rankSignals — pertinence explicable, changements d’abord', () => {
  it('un engagement en retard lié passe devant un vieil événement neutre', () => {
    const overdue = f({ fact_type: 'commitment', impact: 'friction', is_overdue: true, inference_level: 'fact', confidence: 95 })
    const old = f({ fact_type: 'event', impact: 'neutral', occurred_at: '2026-01-01T00:00:00Z', first_seen_at: '2026-01-01T00:00:00Z' })
    const ranked = rankSignals(dto([old, overdue]), { now: NOW })
    expect(ranked[0]!.fact.id).toBe(overdue.id)
    expect(ranked[0]!.relevance.priority).toBeGreaterThan(ranked[1]!.relevance.priority)
    expect(ranked[0]!.relevance.breakdown.score).toBe(ranked[0]!.relevance.priority) // explicable
  })
  it('un état permanent (rôle) est déprioritisé (§37)', () => {
    const role = f({ fact_type: 'role', impact: 'neutral', title: 'relai unique' })
    const change = f({ fact_type: 'risk', impact: 'friction', occurred_at: '2026-09-13T00:00:00Z' })
    const ranked = rankSignals(dto([role, change]), { now: NOW })
    expect(ranked[0]!.fact.id).toBe(change.id)
  })
  it('topN limite la sortie', () => {
    expect(rankSignals(dto([f({}), f({}), f({}), f({})]), { topN: 2, now: NOW })).toHaveLength(2)
  })
})

describe('rankDelta — depuis votre dernier échange', () => {
  it('sans interaction personnelle → statut propagé, aucun signal inventé', () => {
    const r = rankDelta(dto([f({})]))
    expect(r.status).toBe('no_personal_interaction')
    expect(r.signals).toHaveLength(0)
  })
  it('avec t0 personnel → classe les faits postérieurs', () => {
    const r = rankDelta(dto([], 'client', [f({ fact_type: 'decision', impact: 'reinforce' }), f({ fact_type: 'risk', impact: 'friction', is_overdue: true })]), { now: NOW })
    expect(r.status).toBe('available')
    expect(r.signals).toHaveLength(2)
    expect(r.signals[0]!.relevance.priority).toBeGreaterThanOrEqual(r.signals[1]!.relevance.priority)
  })
})
