import { describe, expect, it } from 'vitest'
import {
  aggregateGlobalScore,
  atRiskAccounts,
  bestAccounts,
  buildDigest,
  deriveActions,
  priorityOf,
  riskScore,
  type ScoredAccount,
} from '../priority'
import { relationLevel, type HomeSignal } from '../types'

const NOW = new Date('2026-07-15T12:00:00Z')

function account(overrides: Partial<ScoredAccount>): ScoredAccount {
  return {
    id: 'a1',
    name: 'Compte',
    industry: null,
    score: null,
    confidence: null,
    lastInteractionAt: null,
    contactCount: 0,
    phase: null,
    delta30d: null,
    tracked: true,
    ...overrides,
  }
}

function signal(overrides: Partial<HomeSignal>): HomeSignal {
  return {
    id: 's1',
    kind: 'company',
    signalType: 'news',
    title: 'Signal',
    summary: null,
    accountId: 'a1',
    accountName: 'Compte',
    personId: null,
    personName: null,
    source: 'Presse',
    observedAt: '2026-07-10T00:00:00Z',
    confidence: 60,
    inferenceLevel: null,
    userVerdict: null,
    ...overrides,
  }
}

describe('relationLevel — seuils de la mission §3', () => {
  it('classe 70-100 Promoteur, 50-69 Passif, 0-49 Détracteur', () => {
    expect(relationLevel(100)).toBe('promoter')
    expect(relationLevel(70)).toBe('promoter')
    expect(relationLevel(69)).toBe('passive')
    expect(relationLevel(50)).toBe('passive')
    expect(relationLevel(49)).toBe('detractor')
    expect(relationLevel(0)).toBe('detractor')
  })
  it('retourne unavailable pour un score absent — jamais une valeur inventée', () => {
    expect(relationLevel(null)).toBe('unavailable')
    expect(relationLevel(Number.NaN)).toBe('unavailable')
  })
})

describe('aggregateGlobalScore — score global (scénarios 10 et 11)', () => {
  it('moyenne uniquement les scores valides des comptes suivis', () => {
    const result = aggregateGlobalScore([
      account({ id: 'a', score: 80 }),
      account({ id: 'b', score: 60 }),
      account({ id: 'c', score: null }),
      account({ id: 'd', score: 90, tracked: false }),
    ])
    expect(result.score).toBe(70)
    expect(result.includedAccounts).toBe(2)
    expect(result.excludedAccounts).toBe(1)
  })
  it('ne moyenne jamais les null comme des zéros', () => {
    const withNulls = aggregateGlobalScore([account({ id: 'a', score: 80 }), account({ id: 'b', score: null })])
    expect(withNulls.score).toBe(80)
  })
  it('retourne null (pas 0) sans aucune donnée', () => {
    const empty = aggregateGlobalScore([account({ id: 'a', score: null })])
    expect(empty.score).toBeNull()
    expect(empty.distribution).toBeNull()
    expect(empty.confidence).toBeNull()
  })
  it('calcule la répartition Promoteurs/Passifs/Détracteurs en pourcentages', () => {
    const result = aggregateGlobalScore([
      account({ id: 'a', score: 80 }),
      account({ id: 'b', score: 55 }),
      account({ id: 'c', score: 30 }),
      account({ id: 'd', score: 72 }),
    ])
    expect(result.distribution).toEqual({ promoters: 50, passives: 25, detractors: 25 })
  })
})

describe('bestAccounts — Top 5 Meilleurs (scénario 13)', () => {
  it('trie par score décroissant et exclut les scores null et non suivis', () => {
    const result = bestAccounts([
      account({ id: 'a', name: 'A', score: 55 }),
      account({ id: 'b', name: 'B', score: 90 }),
      account({ id: 'c', name: 'C', score: null }),
      account({ id: 'd', name: 'D', score: 99, tracked: false }),
    ])
    expect(result.map((item) => item.id)).toEqual(['b', 'a'])
  })
})

describe('atRiskAccounts — À risque multi-facteurs (scénario 13)', () => {
  it("n'est pas l'ordre inverse du score : le cumul de facteurs prime", () => {
    const lowScoreOnly = account({ id: 'low', score: 45 })
    const passiveButDying = account({
      id: 'dying',
      score: 55,
      delta30d: -10,
      lastInteractionAt: '2026-05-20T00:00:00Z', // 56 j de silence
      phase: 'declining',
      contactCount: 1,
    })
    const result = atRiskAccounts([lowScoreOnly, passiveButDying], NOW)
    expect(result[0]?.id).toBe('dying')
    expect(result[0]?.riskReasons.length).toBeGreaterThanOrEqual(3)
  })
  it("ignore les comptes sans aucun facteur affirmable", () => {
    const clean = account({ id: 'ok', score: 82, lastInteractionAt: '2026-07-14T00:00:00Z', contactCount: 3 })
    expect(atRiskAccounts([clean], NOW)).toHaveLength(0)
  })
  it('documente chaque facteur dans riskReasons', () => {
    const { reasons } = riskScore(account({ score: 40, lastInteractionAt: '2026-06-01T00:00:00Z', contactCount: 1 }), NOW)
    expect(reasons.join(' ')).toMatch(/détracteur/)
    expect(reasons.join(' ')).toMatch(/44 j sans contact/)
    expect(reasons.join(' ')).toMatch(/seul interlocuteur/)
  })
})

describe('priorityOf — barème documenté (urgence + impact + confiance + fraîcheur)', () => {
  it('reste borné à 0-100', () => {
    expect(priorityOf({ urgency: 999, impact: 999, confidence: 100, ageDays: 0 })).toBe(100)
    expect(priorityOf({ urgency: 0, impact: 0, confidence: 0, ageDays: 60 })).toBe(0)
  })
  it('utilise des valeurs neutres quand la donnée manque, sans inventer', () => {
    expect(priorityOf({ urgency: 10, impact: 10, confidence: null, ageDays: null })).toBe(35)
  })
})

describe('deriveActions — actions dérivées de faits persistés (scénario 17)', () => {
  it('crée une relance pour un silence prolongé sur un compte suivi', () => {
    const actions = deriveActions([account({ id: 'a', name: 'CSJC', score: 60, lastInteractionAt: '2026-06-01T00:00:00Z' })], [], NOW)
    const relance = actions.find((action) => action.type === 'relance')
    expect(relance).toBeDefined()
    expect(relance?.actionId).toBe('relance:a')
    expect(relance?.explanation).toMatch(/44 j sans contact/)
  })
  it('ne crée rien pour un compte non suivi', () => {
    const actions = deriveActions([account({ id: 'a', tracked: false, lastInteractionAt: '2026-01-01T00:00:00Z' })], [], NOW)
    expect(actions).toHaveLength(0)
  })
  it('transforme un signal de mouvement récent en action, avec sa source et sa date', () => {
    const actions = deriveActions([], [signal({ id: 's9', signalType: 'job_change', title: 'Nouveau rôle détecté', confidence: 55 })], NOW)
    const mouvement = actions.find((action) => action.type === 'mouvement')
    expect(mouvement?.sourceSignalId).toBe('s9')
    expect(mouvement?.source).toBe('Presse')
    expect(mouvement?.observedAt).toBe('2026-07-10T00:00:00Z')
  })
  it('ignore les signaux trop anciens (> 21 j)', () => {
    const actions = deriveActions([], [signal({ signalType: 'job_change', observedAt: '2026-05-01T00:00:00Z' })], NOW)
    expect(actions).toHaveLength(0)
  })
  it('trie par priorité décroissante et dédoublonne par actionId', () => {
    const accounts = [
      account({ id: 'a', name: 'A', score: 60, lastInteractionAt: '2026-07-01T00:00:00Z', contactCount: 1 }),
      account({ id: 'b', name: 'B', score: 30, delta30d: -12, lastInteractionAt: '2026-04-01T00:00:00Z', phase: 'declining', contactCount: 1 }),
    ]
    const actions = deriveActions(accounts, [], NOW)
    const priorities = actions.map((action) => action.priority)
    expect([...priorities].sort((x, y) => y - x)).toEqual(priorities)
    expect(new Set(actions.map((action) => action.actionId)).size).toBe(actions.length)
  })
})

describe('buildDigest — depuis la dernière visite (bloc 2)', () => {
  const signals = [
    signal({ id: 's1', observedAt: '2026-07-14T00:00:00Z', signalType: 'job_change' }),
    signal({ id: 's2', observedAt: '2026-07-01T00:00:00Z' }),
  ]
  it('retourne null sans horodatage persisté — jamais un digest inventé', () => {
    expect(buildDigest({ since: null, signals, accounts: [], peopleCreatedAt: [], now: NOW })).toBeNull()
  })
  it('compte uniquement les faits postérieurs à la dernière visite', () => {
    const digest = buildDigest({
      since: '2026-07-10T00:00:00Z',
      signals,
      accounts: [],
      peopleCreatedAt: ['2026-07-12T00:00:00Z', '2026-06-01T00:00:00Z'],
      now: NOW,
    })
    expect(digest?.newSignals).toBe(1)
    expect(digest?.jobChanges).toBe(1)
    expect(digest?.newPeople).toBe(1)
  })
})
