import { describe, expect, it } from 'vitest'
import { scoreFreshness } from '../surface-state'

const NOW = new Date('2026-07-20T12:00:00Z')

describe('scoreFreshness — ne jamais présenter une vieille valeur comme à jour (SPEC-06 §18)', () => {
  it('reste ready sous le seuil de péremption', () => {
    expect(scoreFreshness('2026-07-19T12:00:00Z', NOW)).toBe('ready')
  })
  it('passe stale au-delà du seuil (48h par défaut)', () => {
    expect(scoreFreshness('2026-07-17T00:00:00Z', NOW)).toBe('stale')
  })
  it('respecte un seuil personnalisé', () => {
    expect(scoreFreshness('2026-07-20T06:00:00Z', NOW, 4)).toBe('stale')
    expect(scoreFreshness('2026-07-20T10:00:00Z', NOW, 4)).toBe('ready')
  })
  it('sans date connue, ne déduit jamais stale', () => {
    expect(scoreFreshness(null, NOW)).toBe('ready')
    expect(scoreFreshness('date-invalide', NOW)).toBe('ready')
  })
})
