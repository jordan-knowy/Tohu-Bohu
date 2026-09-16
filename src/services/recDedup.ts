// Correctif dédup des recommandations (§10) — logique PURE et testable, à brancher
// dans score-batch/account-strategic-reading. Une reco rejetée ne doit PAS revenir
// sans nouveau fait significatif. Distingue :
//   • état RÉEL global : open / completed / resolved / obsolete / dismissed(team)
//   • interaction PAR utilisateur : seen / acknowledged / dismissed → account_recommendation_user_state
// Un × utilisateur (per-user) ne supprime jamais la reco pour l'équipe.

/** Identité stable d'une reco, indépendante de son texte (qui peut être reformulé). */
export function recommendationDedupKey(companyId: string, category: string, discriminator?: string | null): string {
  const disc = discriminator && discriminator.trim() ? discriminator.trim() : category
  return `${companyId}|${category}|${disc}`.slice(0, 300)
}

export type RecStatus = 'open' | 'postponed' | 'completed' | 'resolved' | 'obsolete' | 'dismissed'

export interface ExistingRec {
  status: RecStatus
  feedbackReason?: string | null   // 'not_relevant_for_account' = rejet d'équipe explicite
  terminatedAt?: string | null     // completed_at / dismissed_at / resolved_at
}

export type RecDecision =
  | 'create'                // aucune reco vivante ni terminale récente → créer
  | 'skip_open'             // déjà vivante (open/postponed) → ne pas dupliquer
  | 'skip_terminal'         // terminale, aucun fait plus récent → ne pas ressusciter
  | 'skip_team_rejected'    // rejet d'équipe explicite → jamais recréer
  | 'recreate_new_fact'     // terminale mais un fait significatif POSTÉRIEUR la rend à nouveau pertinente

/**
 * Décide si une reco (identifiée par dedup_key) doit être créée/recréée.
 * `newFactLastSeenAt` = date du fait le plus récent qui motiverait la reco.
 */
export function decideRecommendation(existing: ExistingRec | null, newFactLastSeenAt: string | null): RecDecision {
  if (!existing) return 'create'
  if (existing.status === 'open' || existing.status === 'postponed') return 'skip_open'
  // États terminaux :
  if (existing.status === 'dismissed' && existing.feedbackReason === 'not_relevant_for_account') return 'skip_team_rejected'
  if (!newFactLastSeenAt || !existing.terminatedAt) return 'skip_terminal'
  return new Date(newFactLastSeenAt).getTime() > new Date(existing.terminatedAt).getTime()
    ? 'recreate_new_fact'
    : 'skip_terminal'
}

/** Une reco est-elle visible pour CET utilisateur ? (masquage per-user distinct du global). */
export function isRecVisibleForUser(globalStatus: RecStatus, userDismissedAt: string | null | undefined): boolean {
  if (globalStatus !== 'open' && globalStatus !== 'postponed') return false
  if (userDismissedAt) return false // × par défaut = masquer pour moi, sans toucher l'équipe
  return true
}
