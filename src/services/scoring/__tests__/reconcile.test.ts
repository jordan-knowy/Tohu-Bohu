import { describe, expect, it } from 'vitest'
import { isFactOrphaned, reconcileFacts } from '../reconcile'
import type { ReconcilableFact } from '../reconcile'

const f = (o: Partial<ReconcilableFact>): ReconcilableFact =>
  ({ id: 'x', producer: 'promote_moments', status: 'active', sourceRef: { person_key_moment_id: 'm1' }, ...o })

describe('réconciliation — un dérivé ne survit pas à sa preuve', () => {
  it('source disparue → orphelin', () => {
    expect(isFactOrphaned(f({ sourceRef: { person_key_moment_id: 'gone' } }), new Set(['m1']))).toBe(true)
  })
  it('source encore présente → conservé', () => {
    expect(isFactOrphaned(f({ sourceRef: { person_key_moment_id: 'm1' } }), new Set(['m1']))).toBe(false)
  })
  it('fait NON promu (saisie manuelle) → jamais orphelin', () => {
    expect(isFactOrphaned(f({ producer: 'user', sourceRef: null }), new Set())).toBe(false)
  })
  it('déjà obsolète → stable (idempotent)', () => {
    expect(isFactOrphaned(f({ status: 'obsolete', sourceRef: { person_key_moment_id: 'gone' } }), new Set())).toBe(false)
  })
  it('plusieurs preuves, une seule disparaît → seul l’orphelin sort', () => {
    const facts = [
      f({ id: 'a', sourceRef: { person_key_moment_id: 'm1' } }),
      f({ id: 'b', sourceRef: { person_memory_entry_id: 'e1' } }),
      f({ id: 'c', sourceRef: { person_key_moment_id: 'gone' } }),
    ]
    const r = reconcileFacts(facts, new Set(['m1', 'e1']))
    expect(r.obsolete).toEqual(['c'])
    expect(r.keep.sort()).toEqual(['a', 'b'])
  })
  it('rejeu après réconciliation : mêmes sources → 0 nouveau obsolète', () => {
    const facts = [f({ id: 'a', status: 'obsolete', sourceRef: { person_key_moment_id: 'gone' } }), f({ id: 'b', sourceRef: { person_key_moment_id: 'm1' } })]
    expect(reconcileFacts(facts, new Set(['m1'])).obsolete).toEqual([])
  })
})
