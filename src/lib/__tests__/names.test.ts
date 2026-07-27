import { describe, expect, it } from 'vitest'
import { formatPersonName } from '../names'

describe('formatPersonName', () => {
  it('met le prénom en casse titre et le nom en majuscules', () => {
    expect(formatPersonName('chayma ghrab')).toBe('Chayma GHRAB')
    expect(formatPersonName('Chayma Ghrab')).toBe('Chayma GHRAB')
    expect(formatPersonName('CHAYMA GHRAB')).toBe('Chayma GHRAB')
  })

  it('gère un nom de famille composé', () => {
    expect(formatPersonName('marie dupont-martin')).toBe('Marie DUPONT-MARTIN')
    expect(formatPersonName('jean de la fontaine')).toBe('Jean DE LA FONTAINE')
  })

  it('gère un prénom composé (tiret)', () => {
    expect(formatPersonName('marie-claire dupont')).toBe('Marie-Claire DUPONT')
  })

  it('gère un nom sans espace (un seul mot)', () => {
    expect(formatPersonName('chayma')).toBe('Chayma')
  })

  it('respecte les accents', () => {
    expect(formatPersonName('émilie garcía')).toBe('Émilie GARCÍA')
  })

  it('renvoie null pour une valeur vide, nulle ou blanche', () => {
    expect(formatPersonName(null)).toBeNull()
    expect(formatPersonName(undefined)).toBeNull()
    expect(formatPersonName('   ')).toBeNull()
  })

  it('normalise les espaces multiples', () => {
    expect(formatPersonName('chayma    ghrab')).toBe('Chayma GHRAB')
  })
})
