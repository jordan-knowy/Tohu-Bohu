import { describe, expect, it } from 'vitest'
import { uniqueProgressLabel } from '../render'

describe('uniqueProgressLabel — stepper de détection des comptes', () => {
  const labels = [
    'Connexion au fournisseur',
    'Lecture des métadonnées autorisées',
    'Détection des organisations',
    'Regroupement et déduplication',
    'Préparation des résultats',
  ]

  it('ignore un statut backend déjà affiché par une autre étape', () => {
    expect(uniqueProgressLabel(labels, 1, 'Connexion au fournisseur')).toBeNull()
  })

  it('conserve un statut intermédiaire qui apporte une information nouvelle', () => {
    expect(uniqueProgressLabel(labels, 1, 'Traitement des messages (20/80)')).toBe('Traitement des messages (20/80)')
  })
})
