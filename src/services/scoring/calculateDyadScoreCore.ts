// Scoring V6 — NOYAU personne. Fonction PURE : mêmes entrées → mêmes sorties.
// Aucune DB, aucun LLM, aucune fenêtre temporelle, aucune fiabilité, aucun P4/P5/P7.
// Ces règles obligatoires vivent dans buildDyadScoreSnapshot() (couche ultérieure).
// Voir SCORING_V6_S0_DESIGN.md §F et SCORING_DOCTRINE.md.

import type {
  AxisId, DyadRole, DyadScoreCoreResult, MarkerContribution, MarkerEvent,
  MarkerRegistry, MarkerRegistryEntry, ScoringParams,
} from './types'

const AXES: AxisId[] = ['confiance', 'satisfaction', 'engagement', 'reciprocite', 'ancrage']
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
const signOf = (v: number): -1 | 0 | 1 => (v > 0 ? 1 : v < 0 ? -1 : 0)

/** Points signés d'un marqueur selon le mode. PALIER : le palier décide (ptsSpec
 *  ignoré). SPEC : ptsSpec (signé pour fixe-signe, |ptsSpec|×sens pour bipolaire). */
function effectivePoints(entry: MarkerRegistryEntry, sense: -1 | 1, params: ScoringParams): number {
  const effSign: -1 | 1 = entry.sign !== 0 ? entry.sign : sense
  if (params.mode === 'spec') {
    const spec = entry.ptsSpec ?? 0
    return entry.sign !== 0 ? spec : Math.abs(spec) * effSign
  }
  const tier = params.tiers[entry.tier]
  return effSign > 0 ? tier.pos : tier.neg
}

/** Renormalisation de la volontarité par rôle (exception Exécution du registre V6). */
function renormVolontarite(volBase: number, role: DyadRole, params: ScoringParams): number {
  const table = role.volontariteProfile === 'execution' ? params.volontarite.execution : params.volontarite
  if (volBase === 0.3) return table.prescrit
  if (volBase === 0.6) return table.semi
  if (volBase === 1.0) return table.volontaire
  return volBase // valeur hors barème : renvoyée telle quelle (jamais fabriquée)
}

function repetitionMultiplier(occurrences: number, params: ScoringParams): number {
  if (occurrences >= 4) return params.repetition.occ4plus
  if (occurrences >= 2) return params.repetition.occ2to3
  return params.repetition.occ1
}

/**
 * Calcule les 5 axes C/S/E/R/A d'une dyade à partir de marker_events déjà
 * admissibles. `params` et `registry` sont des objets RÉSOLUS (le core ne
 * résout jamais une version depuis une DB) ; leurs versions sont rapportées
 * dans le résultat pour la reproductibilité.
 */
export function calculateDyadScoreCore(
  markerEvents: MarkerEvent[],
  role: DyadRole,
  params: ScoringParams,
  registry: MarkerRegistry,
): DyadScoreCoreResult {
  const axes = {} as DyadScoreCoreResult['axes']

  for (const axis of AXES) {
    // Ne retenir que les events dont le marqueur existe, appartient à CET axe,
    // et n'est pas déprécié. Un marker_id inconnu du registre est ignoré (jamais
    // scoré) — le rejet dur se fait à l'insertion du marker_event, pas ici.
    const axisEvents = markerEvents.filter((event) => {
      const entry = registry.markers[event.markerId]
      return entry && !entry.deprecatedAt && entry.axis === axis
    })

    if (axisEvents.length === 0) {
      // Axe observé sans marqueur → base 50 (le null « hors fenêtre » est décidé
      // par la couche snapshot, jamais ici).
      axes[axis] = { axis, base: 50, value: 50, weight: params.axisWeights[axis], cappedByS07: false, contributions: [] }
      continue
    }

    // Regroupement par (marker_id, sens effectif). Fixe-signe : sens = entry.sign,
    // donc une seule clé par marqueur. Bipolaire : +1 et -1 sont deux groupes.
    const groups = new Map<string, { entry: MarkerRegistryEntry; sense: -1 | 1; count: number }>()
    for (const event of axisEvents) {
      const entry = registry.markers[event.markerId]!
      const sense: -1 | 1 = entry.sign !== 0 ? (entry.sign as -1 | 1) : event.sense
      const key = `${event.markerId}|${sense}`
      const g = groups.get(key)
      if (g) g.count += 1
      else groups.set(key, { entry, sense, count: 1 })
    }

    // Contributions (avant décroissance)
    const raw: Array<Omit<MarkerContribution, 'rank' | 'decayMultiplier' | 'contributionFinale'>> = []
    for (const { entry, sense, count } of groups.values()) {
      const pts = effectivePoints(entry, sense, params)
      const vol = renormVolontarite(entry.volBase, role, params)
      const rep = repetitionMultiplier(count, params)
      const magnitude = Math.abs(pts) * vol * rep
      raw.push({ markerId: entry.markerId, sense, occurrences: count, pointsEffectifs: pts, volontarite: vol, repetitionMultiplier: rep, magnitude })
    }

    // Tri par magnitude décroissante. Départage déterministe par marker_id (n'affecte
    // PAS la somme : deux marqueurs de magnitude égale reçoivent {decay[i], decay[i+1]}
    // dont le total appliqué est identique quel que soit l'ordre) — assure des rangs stables.
    raw.sort((a, b) => (b.magnitude - a.magnitude) || a.markerId.localeCompare(b.markerId))

    const contributions: MarkerContribution[] = raw.map((c, index) => {
      const decayMultiplier = params.decay[Math.min(index, params.decay.length - 1)] ?? params.decay[params.decay.length - 1] ?? 1
      const contributionFinale = signOf(c.pointsEffectifs) * c.magnitude * decayMultiplier
      return { ...c, rank: index + 1, decayMultiplier, contributionFinale }
    })

    const total = contributions.reduce((sum, c) => sum + c.contributionFinale, 0)
    let value = clamp(Math.round(50 + total), 0, 100)

    // Plafond critique S07 : Satisfaction ≤ 20, appliqué APRÈS le calcul normal.
    const cappedByS07 = axis === 'satisfaction' && axisEvents.some((e) => e.markerId === 'S07')
    if (cappedByS07) value = Math.min(value, 20)

    axes[axis] = { axis, base: 50, value, weight: params.axisWeights[axis], cappedByS07, contributions }
  }

  // Score final = Σ (valeur d'axe ARRONDIE × poids), puis arrondi (reproduit l'exemple V6).
  const score = Math.round(AXES.reduce((sum, axis) => sum + axes[axis].value * axes[axis].weight, 0))

  return {
    score,
    axes,
    role,
    paramsVersion: params.version,
    registryVersion: registry.version,
    mode: params.mode,
  }
}
