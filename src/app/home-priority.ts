/**
 * Règles métier de la Home — module pur, sans accès réseau, testé unitairement.
 *
 * La Home ne recalcule aucun score relationnel : elle consomme les scores
 * persistés (companies.public_context.relationship_score,
 * relationship_snapshots.engagement_score). Ce module ne fait que :
 *
 * 1. classer les comptes « À risque » (multi-facteurs, pas l'inverse du score) ;
 * 2. dériver les actions du jour depuis des faits persistés (signaux, silences,
 *    couverture) et calculer leur priorité ;
 * 3. agréger le score global à partir des scores valides existants ;
 * 4. construire le digest « depuis ta dernière visite ».
 *
 * Barème de priorité (0-100), documenté et déterministe :
 *   priorité = urgence (0-40) + impact (0-30) + confiance (0-20) + fraîcheur (0-10)
 */

import { relationLevel, type HomeAccountSummary, type HomeAtRiskAccount, type HomePriorityAction, type HomeSignal } from './home-types'

export type ScoredAccount = {
  id: string
  name: string
  industry: string | null
  score: number | null
  confidence: number | null
  lastInteractionAt: string | null
  /** Nombre de contacts rattachés (couverture). */
  contactCount: number
  /** Phase du dernier snapshot agrégé si disponible (ex. « declining »). */
  phase: string | null
  /** Variation de score sur ~30 j si deux mesures existent, sinon null. */
  delta30d: number | null
  tracked: boolean
}

const DAY = 86_400_000

export function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const time = new Date(iso).getTime()
  if (!Number.isFinite(time)) return null
  return Math.floor((now.getTime() - time) / DAY)
}

function trendOf(delta: number | null): 'up' | 'down' | 'stable' | null {
  if (delta === null) return null
  if (delta >= 3) return 'up'
  if (delta <= -3) return 'down'
  return 'stable'
}

export function toSummary(account: ScoredAccount): HomeAccountSummary {
  return {
    id: account.id,
    name: account.name,
    industry: account.industry,
    score: account.score,
    level: relationLevel(account.score),
    confidence: account.confidence,
    trend: trendOf(account.delta30d),
    lastInteractionAt: account.lastInteractionAt,
  }
}

/** Top 5 « Meilleurs » : uniquement des scores valides, décroissant. */
export function bestAccounts(accounts: ScoredAccount[], limit = 5): HomeAccountSummary[] {
  return accounts
    .filter((account) => account.tracked && account.score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit)
    .map(toSummary)
}

/**
 * Classement « À risque » — cumul de facteurs de risque (0-100) :
 *   score faible (0-30) · variation négative (0-20) · silence prolongé (0-25)
 *   · phase en déclin (0-15) · couverture mono-contact (0-10)
 * Un compte sans aucune donnée n'apparaît pas (rien d'affirmable).
 */
export function riskScore(account: ScoredAccount, now: Date): { score: number; reasons: string[] } {
  let total = 0
  const reasons: string[] = []
  if (account.score !== null) {
    if (account.score < 50) { total += 30; reasons.push(`score détracteur (${account.score})`) }
    else if (account.score < 60) { total += 15; reasons.push(`score passif bas (${account.score})`) }
  }
  if (account.delta30d !== null && account.delta30d <= -3) {
    total += Math.min(20, Math.abs(account.delta30d) * 2)
    reasons.push(`en baisse de ${Math.abs(account.delta30d)} pts sur 30 j`)
  }
  const silence = daysSince(account.lastInteractionAt, now)
  if (silence !== null && silence > 30) {
    total += Math.min(25, 10 + Math.floor((silence - 30) / 10) * 3)
    reasons.push(`${silence} j sans contact`)
  }
  if (account.phase && /declin|down|cool|froid/i.test(account.phase)) {
    total += 15
    reasons.push('phase en déclin')
  }
  if (account.contactCount === 1) {
    total += 10
    reasons.push('un seul interlocuteur connu')
  }
  return { score: Math.min(100, total), reasons }
}

export function atRiskAccounts(accounts: ScoredAccount[], now: Date, limit = 5): HomeAtRiskAccount[] {
  return accounts
    .filter((account) => account.tracked)
    .map((account) => ({ account, risk: riskScore(account, now) }))
    .filter(({ risk }) => risk.score > 0)
    .sort((a, b) => b.risk.score - a.risk.score)
    .slice(0, limit)
    .map(({ account, risk }) => ({ ...toSummary(account), riskScore: risk.score, riskReasons: risk.reasons }))
}

/**
 * Agrégat du score global : moyenne des derniers scores valides des comptes
 * suivis. Les comptes sans score sont exclus et comptés (jamais moyennés à 0).
 */
export function aggregateGlobalScore(accounts: ScoredAccount[]): {
  score: number | null
  includedAccounts: number
  excludedAccounts: number
  distribution: { promoters: number; passives: number; detractors: number } | null
  confidence: number | null
} {
  const tracked = accounts.filter((account) => account.tracked)
  const scored = tracked.filter((account) => account.score !== null)
  if (!scored.length) {
    return { score: null, includedAccounts: 0, excludedAccounts: tracked.length, distribution: null, confidence: null }
  }
  const score = Math.round(scored.reduce((sum, account) => sum + (account.score ?? 0), 0) / scored.length)
  const promoters = scored.filter((account) => relationLevel(account.score) === 'promoter').length
  const passives = scored.filter((account) => relationLevel(account.score) === 'passive').length
  const detractors = scored.length - promoters - passives
  const confidences = scored.map((account) => account.confidence).filter((value): value is number => value !== null)
  return {
    score,
    includedAccounts: scored.length,
    excludedAccounts: tracked.length - scored.length,
    distribution: {
      promoters: Math.round((promoters / scored.length) * 100),
      passives: Math.round((passives / scored.length) * 100),
      detractors: Math.round((detractors / scored.length) * 100),
    },
    confidence: confidences.length ? Math.round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length) : null,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Barème documenté en tête de fichier. */
export function priorityOf(input: { urgency: number; impact: number; confidence: number | null; ageDays: number | null }): number {
  const urgency = clamp(input.urgency, 0, 40)
  const impact = clamp(input.impact, 0, 30)
  const confidence = input.confidence === null ? 10 : clamp(Math.round(input.confidence / 5), 0, 20)
  const freshness = input.ageDays === null ? 5 : clamp(10 - Math.floor(input.ageDays / 3), 0, 10)
  return urgency + impact + confidence + freshness
}

const MOVEMENT_PATTERN = /job.?change|mouvement|gouvernance|governance|leadership|poste|nomination/i
const OPPORTUNITY_PATTERN = /reprise|opportun|funding|levée|growth|expansion/i

/**
 * Dérive les actions du jour depuis des faits persistés uniquement :
 * - silence prolongé sur un compte suivi → relance ;
 * - signal de mouvement/gouvernance récent → validation de mouvement ;
 * - signal d'opportunité récent → opportunité ;
 * - compte suivi mono-contact → couverture ;
 * - compte à risque élevé → risque.
 * Chaque action garde la référence de son fait d'origine (signal, date, source).
 */
export function deriveActions(accounts: ScoredAccount[], signals: HomeSignal[], now: Date): HomePriorityAction[] {
  const actions: HomePriorityAction[] = []
  const nowIso = now.toISOString()

  for (const account of accounts.filter((item) => item.tracked)) {
    const silence = daysSince(account.lastInteractionAt, now)
    if (silence !== null && silence > 30) {
      actions.push({
        actionId: `relance:${account.id}`,
        type: 'relance',
        title: `Silence prolongé — relancer ${account.name}`,
        explanation: `${silence} j sans contact${account.score !== null ? ` · score ${account.score}` : ''}. Reprends langue avant que la relation ne refroidisse.`,
        priority: priorityOf({ urgency: clamp(Math.floor(silence / 3), 0, 40), impact: account.score !== null && account.score >= 50 ? 25 : 15, confidence: 90, ageDays: 0 }),
        accountId: account.id,
        accountName: account.name,
        personId: null,
        personName: null,
        source: 'Historique des interactions',
        observedAt: account.lastInteractionAt ?? nowIso,
        confidence: 90,
        sourceSignalId: null,
        recommended: 'Reprendre contact cette semaine',
      })
    }
    if (account.contactCount === 1 && account.score !== null && account.score >= 50) {
      actions.push({
        actionId: `couverture:${account.id}`,
        type: 'couverture',
        title: `Un seul interlocuteur chez ${account.name}`,
        explanation: 'La relation repose sur une seule personne : élargis la couverture pour sécuriser le compte.',
        priority: priorityOf({ urgency: 12, impact: 20, confidence: 85, ageDays: null }),
        accountId: account.id,
        accountName: account.name,
        personId: null,
        personName: null,
        source: 'Couverture des contacts',
        observedAt: nowIso,
        confidence: 85,
        sourceSignalId: null,
        recommended: 'Identifier un second contact',
      })
    }
    const risk = riskScore(account, now)
    if (risk.score >= 55) {
      actions.push({
        actionId: `risque:${account.id}`,
        type: 'risque',
        title: `${account.name} cumule des facteurs de risque`,
        explanation: risk.reasons.join(' · '),
        priority: priorityOf({ urgency: clamp(Math.round(risk.score / 3), 0, 40), impact: 28, confidence: account.confidence, ageDays: 0 }),
        accountId: account.id,
        accountName: account.name,
        personId: null,
        personName: null,
        source: 'Analyse de risque Tohu',
        observedAt: nowIso,
        confidence: account.confidence,
        sourceSignalId: null,
        recommended: 'Ouvrir le compte et planifier une reprise',
      })
    }
  }

  for (const signal of signals) {
    const age = daysSince(signal.observedAt, now)
    if (age !== null && age > 21) continue
    const base = {
      accountId: signal.accountId,
      accountName: signal.accountName,
      personId: signal.personId,
      personName: signal.personName,
      source: signal.source,
      observedAt: signal.observedAt,
      confidence: signal.confidence,
      sourceSignalId: signal.id,
    }
    if (MOVEMENT_PATTERN.test(`${signal.signalType} ${signal.title}`)) {
      actions.push({
        ...base,
        actionId: `mouvement:${signal.id}`,
        type: 'mouvement',
        title: signal.title,
        explanation: signal.summary ?? 'Mouvement détecté — à confirmer avant d’agir.',
        priority: priorityOf({ urgency: 28, impact: 26, confidence: signal.confidence, ageDays: age }),
        recommended: 'Confirmer le mouvement puis adapter la couverture',
      })
    } else if (OPPORTUNITY_PATTERN.test(`${signal.signalType} ${signal.title}`)) {
      actions.push({
        ...base,
        actionId: `opportunite:${signal.id}`,
        type: 'opportunite',
        title: signal.title,
        explanation: signal.summary ?? 'Fenêtre d’opportunité détectée.',
        priority: priorityOf({ urgency: 24, impact: 24, confidence: signal.confidence, ageDays: age }),
        recommended: 'Saisir la fenêtre tant qu’elle est ouverte',
      })
    } else if (signal.userVerdict === null && signal.confidence !== null && signal.confidence < 70) {
      actions.push({
        ...base,
        actionId: `validation:${signal.id}`,
        type: 'validation',
        title: `À valider : ${signal.title}`,
        explanation: signal.summary ?? 'Signal à confiance limitée — ta validation améliore l’analyse.',
        priority: priorityOf({ urgency: 10, impact: 12, confidence: signal.confidence, ageDays: age }),
        recommended: 'Confirmer ou infirmer ce signal',
      })
    }
  }

  // Tri mission §9 : urgence/impact/confiance/fraîcheur sont déjà fusionnés
  // dans le barème ; à priorité égale, le plus récent d'abord.
  const unique = new Map<string, HomePriorityAction>()
  for (const action of actions) {
    const existing = unique.get(action.actionId)
    if (!existing || action.priority > existing.priority) unique.set(action.actionId, action)
  }
  return [...unique.values()].sort((a, b) => b.priority - a.priority || b.observedAt.localeCompare(a.observedAt))
}

/** Digest « depuis ta dernière visite » — uniquement des faits datés persistés. */
export function buildDigest(input: {
  since: string | null
  signals: HomeSignal[]
  accounts: ScoredAccount[]
  peopleCreatedAt: string[]
  now: Date
}): { since: string | null; newSignals: number; coolingAccounts: number; jobChanges: number; newPeople: number; overdueActions: number } | null {
  if (!input.since) return null
  const since = new Date(input.since).getTime()
  if (!Number.isFinite(since)) return null
  const fresh = input.signals.filter((signal) => new Date(signal.observedAt).getTime() > since)
  const cooling = input.accounts.filter((account) => {
    if (!account.tracked) return false
    const silence = daysSince(account.lastInteractionAt, input.now)
    if (silence === null || silence <= 30) return false
    // le compte a « refroidi » depuis la dernière visite si le seuil de 30 j a
    // été franchi entre la dernière visite et maintenant
    const sinceDays = Math.floor((input.now.getTime() - since) / DAY)
    return silence - sinceDays <= 30
  })
  return {
    since: input.since,
    newSignals: fresh.length,
    coolingAccounts: cooling.length,
    jobChanges: fresh.filter((signal) => MOVEMENT_PATTERN.test(`${signal.signalType} ${signal.title}`)).length,
    newPeople: input.peopleCreatedAt.filter((iso) => new Date(iso).getTime() > since).length,
    overdueActions: 0,
  }
}
