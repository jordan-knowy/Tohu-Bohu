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

describe('libellés des signaux comportementaux', () => {
  it('ne réaffiche jamais la clé technique comme titre (register_distance)', () => {
    // En base, inference répète souvent la clé brute — on ne la montre jamais.
    expect(signalTitle('register_distance', 'register_distance', 'Adopte un ton professionnel et direct.')).toBe('Registre & distance')
  })

  it('titre lisible même sans inférence (mobility)', () => {
    expect(signalTitle('mobility', null, 'Changement de poste : Directrice générale.')).toBe('Mobilité professionnelle')
  })

  it('classe les traits comportementaux dans une catégorie lisible', () => {
    expect(signalTypeLabel('register_distance')).toBe('Communication')
    expect(signalTypeLabel('rythme')).toBe('Style d’échange')
    expect(signalTypeLabel('engagement')).toBe('Posture')
  })

  it('ignore une inférence qui est une clé technique et humanise en dernier recours', () => {
    expect(signalTitle('unknown_marker', 'unknown_marker', 'x')).toBe('Unknown marker')
  })
})
