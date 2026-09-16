import { describe, expect, it } from 'vitest'
import { decideRecommendation, isRecVisibleForUser, recommendationDedupKey } from '../recDedup'

describe('recommendationDedupKey — identité stable indépendante du texte', () => {
  it('même compte+catégorie+discriminant → même clé', () => {
    expect(recommendationDedupKey('c1', 'risque', 'fact-9')).toBe(recommendationDedupKey('c1', 'risque', 'fact-9'))
    expect(recommendationDedupKey('c1', 'risque', 'a')).not.toBe(recommendationDedupKey('c1', 'risque', 'b'))
  })
})

describe('decideRecommendation — une reco rejetée ne revient pas sans nouveau fait', () => {
  it('aucune existante → create', () => {
    expect(decideRecommendation(null, '2026-09-01')).toBe('create')
  })
  it('déjà ouverte → skip_open (pas de doublon)', () => {
    expect(decideRecommendation({ status: 'open' }, '2026-09-01')).toBe('skip_open')
  })
  it('terminée sans fait plus récent → skip_terminal (ne ressuscite pas)', () => {
    expect(decideRecommendation({ status: 'completed', terminatedAt: '2026-09-10' }, '2026-09-01')).toBe('skip_terminal')
  })
  it('terminée + fait significatif postérieur → recreate_new_fact', () => {
    expect(decideRecommendation({ status: 'dismissed', terminatedAt: '2026-09-01' }, '2026-09-15')).toBe('recreate_new_fact')
  })
  it('rejet d’équipe explicite → jamais recréée', () => {
    expect(decideRecommendation({ status: 'dismissed', feedbackReason: 'not_relevant_for_account', terminatedAt: '2026-09-01' }, '2026-12-01')).toBe('skip_team_rejected')
  })
})

describe('isRecVisibleForUser — × per-user distinct du global', () => {
  it('ouverte + non masquée par moi → visible', () => {
    expect(isRecVisibleForUser('open', null)).toBe(true)
  })
  it('ouverte mais masquée par moi (×) → invisible pour moi, toujours vivante pour l’équipe', () => {
    expect(isRecVisibleForUser('open', '2026-09-10')).toBe(false)
  })
  it('terminée globalement → invisible', () => {
    expect(isRecVisibleForUser('completed', null)).toBe(false)
  })
})
