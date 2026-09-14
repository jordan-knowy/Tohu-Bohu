import { describe, expect, it } from 'vitest'
import { suggestedActionFor, weightOf } from '../factCard'
import type { HomePriorityAction } from '../types'

function action(overrides: Partial<HomePriorityAction>): HomePriorityAction {
  return {
    actionId: 'relance:a1',
    type: 'relance',
    title: 'Silence prolongé',
    explanation: '',
    priority: 50,
    accountId: 'a1',
    accountName: 'CSJC',
    personId: null,
    personName: null,
    source: 'Historique des interactions',
    observedAt: '2026-07-10T00:00:00Z',
    confidence: 80,
    sourceSignalId: null,
    recommended: 'Reprendre contact cette semaine',
    sourceUrl: null,
    sourceExcerpt: null,
    sourceOccurredAt: null,
    sourceDirection: null,
    ...overrides,
  }
}

describe('weightOf — même palier que la carte et la pastille ticker', () => {
  it('classe >=70 high, 40-69 medium, <40 low', () => {
    expect(weightOf(100)).toBe('high')
    expect(weightOf(70)).toBe('high')
    expect(weightOf(69)).toBe('medium')
    expect(weightOf(40)).toBe('medium')
    expect(weightOf(39)).toBe('low')
    expect(weightOf(0)).toBe('low')
  })
})

describe('suggestedActionFor — action déterministe par type, aucun appel IA', () => {
  it("couverture propose d'identifier un second contact, rattachée au compte", () => {
    const suggested = suggestedActionFor(action({ type: 'couverture', accountId: 'a1' }))
    expect(suggested).toEqual({ kind: 'add-person', label: 'Identifier un second contact' })
  })
  it("couverture sans compte identifié ne propose rien (on ne devine pas de cible)", () => {
    expect(suggestedActionFor(action({ type: 'couverture', accountId: null }))).toBeNull()
  })
  it.each(['relance', 'risque', 'mouvement', 'opportunite'] as const)('%s ouvre le compte quand il est connu', (type) => {
    const suggested = suggestedActionFor(action({ type, accountId: 'a1', personId: null }))
    expect(suggested).toEqual({ kind: 'open-account', label: 'Ouvrir le compte' })
  })
  it('relance sans compte mais avec une personne ouvre la fiche personne', () => {
    const suggested = suggestedActionFor(action({ type: 'relance', accountId: null, personId: 'p1' }))
    expect(suggested).toEqual({ kind: 'open-person', label: 'Ouvrir la fiche' })
  })
  it.each(['engagement', 'validation'] as const)('%s ouvre la fiche personne en priorité quand elle est connue', (type) => {
    const suggested = suggestedActionFor(action({ type, accountId: 'a1', personId: 'p1' }))
    expect(suggested).toEqual({ kind: 'open-person', label: 'Ouvrir la fiche' })
  })
  it('sans compte ni personne, aucune action suggérée (jamais de destination inventée)', () => {
    expect(suggestedActionFor(action({ type: 'relance', accountId: null, personId: null }))).toBeNull()
  })
})
