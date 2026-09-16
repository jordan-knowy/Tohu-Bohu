// Chaîne de pertinence de bout en bout (§9) : account_fact → 6 dimensions 0-1 →
// computeRelevance → priority + breakdown. DÉTERMINISTE : aucun LLM ne produit
// priority=88. Chaque dimension est justifiée par des champs du fact.
// Le contexte type de relation (§33) ajuste la DÉRIVATION (pas les poids de la formule).

import { computeRelevance } from './computeRelevance'
import type { RelevanceDimensions, RelevanceResult } from './computeRelevance'

export interface FactForRelevance {
  factType: string           // event|risk|opportunity|blocker|commitment|deadline|decision|open_topic|objective|milestone|...
  impact: 'friction' | 'reinforce' | 'milestone' | 'neutral' | null
  occurredAt: string | null
  firstSeenAt: string
  dueWindowEnd?: string | null
  isOverdue?: boolean
  confidence: number | null  // 0-100
  inferenceLevel: 'fact' | 'strong_inference' | 'inferred'
  linkedToObjective: boolean
  isPermanentState?: boolean // un état structurel (ex. relai unique) n'est pas un « changement »
}

export type RelationType = 'prospect' | 'client' | 'partenaire' | 'fournisseur' | 'investisseur' | 'interne' | 'autre'

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const DAY = 86_400_000

/** Familles d'impact/actionnabilité par type de fait (provisional). */
const IMPACT_BASE: Record<string, number> = {
  risk: 0.9, blocker: 0.9, objection: 0.8, contradiction: 0.8, opportunity: 0.75,
  commitment: 0.7, deadline: 0.7, decision: 0.6, open_topic: 0.5, event: 0.4,
  milestone: 0.4, role: 0.4, unknown: 0.5, objective: 0.5,
}
const ACTIONABLE = new Set(['commitment', 'blocker', 'risk', 'opportunity', 'deadline', 'open_topic', 'objection'])

/** Contexte type de relation → prioriser certaines familles (§33), sans toucher les poids. */
const RELATION_BOOST: Record<RelationType, Record<string, number>> = {
  prospect: { objection: 1.15, decision: 1.15, deadline: 1.1, opportunity: 1.1 },
  client: { risk: 1.15, blocker: 1.15, commitment: 1.1 },
  partenaire: { commitment: 1.15, blocker: 1.1, contradiction: 1.1 },
  fournisseur: { risk: 1.1, commitment: 1.1 },
  investisseur: { deadline: 1.15, decision: 1.1 },
  interne: {},
  autre: {},
}

export function deriveRelevanceDimensions(fact: FactForRelevance, relationType: RelationType, now = new Date()): RelevanceDimensions {
  const nowMs = now.getTime()
  const boost = RELATION_BOOST[relationType]?.[fact.factType] ?? 1

  // impact : famille du fait × amplitude (friction/risque pèsent plus) × contexte relation
  const amp = fact.impact === 'friction' ? 1 : fact.impact === 'reinforce' ? 0.75 : fact.impact === 'milestone' ? 0.6 : 0.7
  const impact = clamp01((IMPACT_BASE[fact.factType] ?? 0.4) * amp * boost)

  // urgence : fenêtre d'échéance (en retard = max), sinon léger biais deadline
  let urgency = fact.factType === 'deadline' ? 0.5 : 0.3
  if (fact.isOverdue) urgency = 1
  else if (fact.dueWindowEnd) {
    const days = (new Date(fact.dueWindowEnd).getTime() - nowMs) / DAY
    urgency = days <= 0 ? 1 : days <= 2 ? 0.9 : days <= 7 ? 0.7 : days <= 30 ? 0.4 : 0.2
  }

  // nouveauté : basée sur occurred_at (réel), plancher ; un état PERMANENT n'est pas un changement
  const ref = fact.occurredAt ?? fact.firstSeenAt
  const ageDays = (nowMs - new Date(ref).getTime()) / DAY
  let novelty = ageDays <= 3 ? 1 : ageDays <= 7 ? 0.8 : ageDays <= 30 ? 0.5 : ageDays <= 90 ? 0.3 : 0.15
  if (fact.isPermanentState) novelty = Math.min(novelty, 0.15) // §37 : un état permanent n'est pas un signal récent

  // fiabilité : confiance × niveau d'inférence (plancher > 0)
  const lvl = fact.inferenceLevel === 'fact' ? 1 : fact.inferenceLevel === 'strong_inference' ? 0.8 : 0.6
  const reliability = clamp01(0.5 * ((fact.confidence ?? 50) / 100) + 0.5 * lvl)

  const actionability = ACTIONABLE.has(fact.factType) ? clamp01(1 * boost) : 0.4
  const objectiveLink = fact.linkedToObjective ? 1 : 0.45

  return { impact, urgency, novelty, reliability, actionability, objectiveLink }
}

/** account_fact → priorité 0-100 explicable (deriveDimensions ∘ computeRelevance). */
export function factToPriority(fact: FactForRelevance, relationType: RelationType, now = new Date()): RelevanceResult {
  return computeRelevance(deriveRelevanceDimensions(fact, relationType, now))
}
