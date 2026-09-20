// Moteur de PERTINENCE — distinct du scoring relationnel.
// Pure, déterministe. « Est-ce que cela mérite mon attention maintenant ? »
// N'est JAMAIS une Météo, ne mesure JAMAIS la santé relationnelle.
// §31–38 du prompt de mission. relevance_params-v1 = provisional.

export interface RelevanceDimensions {
  impact: number         // 0-1 : conséquence si ignoré
  urgency: number        // 0-1 : nécessité temporelle
  novelty: number        // 0-1 : changement nouveau vs état permanent
  reliability: number    // 0-1 : solidité des preuves
  actionability: number  // 0-1 : existence d'une action réelle
  objectiveLink: number  // 0-1 : lien avec l'objectif courant du compte
}

export interface RelevanceParams {
  version: string
  status: 'provisional' | 'tested'
  weights: { impact: number; urgency: number; actionability: number; objectiveLink: number; reliability: number; novelty: number }
}

/** relevance_params-v1 — version PRODUIT, statut provisional (§32). Somme = 1.
 *  Somme pondérée (jamais un produit : un axe faible ne doit pas annuler le reste). */
export const RELEVANCE_PARAMS_V1: RelevanceParams = {
  version: 'relevance_params-v1',
  status: 'provisional',
  weights: { impact: 0.25, urgency: 0.20, actionability: 0.20, objectiveLink: 0.15, reliability: 0.10, novelty: 0.10 },
}

export interface RelevanceResult {
  priority: number       // 0-100, échelle COMMUNE
  paramsVersion: string
  breakdown: {
    impact: number; urgency: number; actionability: number; objectiveLink: number; reliability: number; novelty: number
    contributions: { impact: number; urgency: number; actionability: number; objectiveLink: number; reliability: number; novelty: number }
    score: number
  }
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0))

/**
 * Priorité 0-100 = somme pondérée normalisée des 6 dimensions. Le CONTEXTE de
 * type de relation (§33) n'altère PAS ces poids : il ajuste la façon dont
 * l'appelant dérive impact / objectiveLink / actionability en amont.
 */
export function computeRelevance(dims: RelevanceDimensions, params: RelevanceParams = RELEVANCE_PARAMS_V1): RelevanceResult {
  const d = {
    impact: clamp01(dims.impact), urgency: clamp01(dims.urgency), actionability: clamp01(dims.actionability),
    objectiveLink: clamp01(dims.objectiveLink), reliability: clamp01(dims.reliability), novelty: clamp01(dims.novelty),
  }
  const w = params.weights
  const contributions = {
    impact: w.impact * d.impact,
    urgency: w.urgency * d.urgency,
    actionability: w.actionability * d.actionability,
    objectiveLink: w.objectiveLink * d.objectiveLink,
    reliability: w.reliability * d.reliability,
    novelty: w.novelty * d.novelty,
  }
  const raw = contributions.impact + contributions.urgency + contributions.actionability
    + contributions.objectiveLink + contributions.reliability + contributions.novelty
  const priority = Math.round(100 * raw)
  return { priority, paramsVersion: params.version, breakdown: { ...d, contributions, score: priority } }
}

/** Somme des poids — doit valoir 1 (garde-fou testé). */
export function weightsSum(params: RelevanceParams = RELEVANCE_PARAMS_V1): number {
  const w = params.weights
  return w.impact + w.urgency + w.actionability + w.objectiveLink + w.reliability + w.novelty
}
