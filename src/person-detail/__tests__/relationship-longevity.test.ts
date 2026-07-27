import { describe, expect, it } from 'vitest'
import {
  observedRelationshipAgeInDays,
  scoreLongevite,
} from '../../../supabase/functions/_shared/relationship-longevity'

const DAY_MS = 86_400_000
const NOW = Date.UTC(2026, 6, 24)

describe('longévité relationnelle fondée sur les interactions horodatées', () => {
  it('mesure l’ancienneté depuis le premier échange et non depuis l’import du contact', () => {
    const interactions = [
      NOW - 120 * DAY_MS,
      NOW - 45 * DAY_MS,
      NOW - 2 * DAY_MS,
    ]
    expect(observedRelationshipAgeInDays(interactions, NOW)).toBe(120)
  })

  it('une relation de plus de 30 jours avec des échanges datés ne vaut jamais zéro', () => {
    const result = scoreLongevite({
      ageInDays: 31,
      monthlyExchangeCounts: [1, 1, 0, 0, 0, 0],
      quartersWithMeetings: 0,
      totalInteractions: 2,
    })
    expect(Math.round(result.score * 100)).toBeGreaterThan(0)
    expect(result.factor).toBeGreaterThan(0)
  })

  it('les réunions participent à la continuité de la relation', () => {
    const withoutMeetings = scoreLongevite({
      ageInDays: 365,
      monthlyExchangeCounts: [1, 0, 1, 0, 1, 0],
      quartersWithMeetings: 0,
      totalInteractions: 3,
    })
    const withMeetings = scoreLongevite({
      ageInDays: 365,
      monthlyExchangeCounts: [2, 1, 2, 1, 2, 1],
      quartersWithMeetings: 4,
      totalInteractions: 7,
    })
    expect(withMeetings.score).toBeGreaterThan(withoutMeetings.score)
  })

  it('sans aucune interaction observée, aucune valeur n’est inventée', () => {
    expect(scoreLongevite({
      ageInDays: 365,
      monthlyExchangeCounts: [0, 0, 0, 0, 0, 0],
      quartersWithMeetings: 0,
      totalInteractions: 0,
    })).toEqual({ score: 0, factor: 0 })
  })
})
