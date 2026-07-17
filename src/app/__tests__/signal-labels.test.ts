import { describe, expect, it } from 'vitest'
import { recentActivityTitle, signalTitle, signalTypeLabel } from '../signal-labels'

describe('libellés des signaux recent_activity', () => {
  it('nomme une nomination', () => {
    expect(recentActivityTitle('Nomination en tant que directeur général')).toBe('Nomination détectée')
  })

  it('nomme un partenariat', () => {
    expect(recentActivityTitle('La société prolonge son partenariat jusqu’en 2030')).toBe('Nouveau partenariat')
  })

  it('nomme une publication', () => {
    expect(recentActivityTitle('Article : guide pratique pour les PME')).toBe('Nouvelle publication')
  })

  it('conserve une inférence explicite', () => {
    expect(signalTitle('recent_activity', 'Levée de fonds confirmée', 'Texte')).toBe('Levée de fonds confirmée')
  })

  it('ne montre jamais le code technique dans le badge', () => {
    expect(signalTypeLabel('recent_activity')).toBe('Actualité')
  })
})
