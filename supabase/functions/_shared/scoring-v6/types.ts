// Canonical V6 module: shared by browser and edge.
// Scoring V6 — types du NOYAU mathématique (shadow, aucune DB, aucun LLM).
// Séparation stricte des responsabilités (décision produit) :
//   • calculateDyadScoreCore()   = ce fichier : C/S/E/R/A à partir de marker_events
//                                  DÉJÀ admissibles. Ne connaît ni fenêtre, ni P4/P5/P7,
//                                  ni fiabilité, ni statut, ni DB.
//   • buildDyadScoreSnapshot()   = couche ultérieure (S1+) : applique fenêtre d'extraction,
//                                  P4/P5/P7, fiabilité, statut cadence, versions → snapshot.
// Ne jamais afficher en production la sortie brute du core sans passer par la couche snapshot.

export type AxisId = 'confiance' | 'satisfaction' | 'engagement' | 'reciprocite' | 'ancrage'
/** Cadrans de la Météo compte (V6 §12). Préfixe d_ pour ne pas collisionner avec les axes personne. */
export type DialId = 'd_satisfaction' | 'd_confiance_recip' | 'd_couverture' | 'd_equilibre' | 'd_ancrage' | 'd_dynamique'
export type Tier = 'faible' | 'moyen' | 'important' | 'critique' | 'neutre'
export type Manipulable = 'non' | 'oui' | 'difficile'
export type MarkerScope = 'person' | 'account' | 'out_of_score'

/** Profil de volontarité de la dyade — seule l'exception « rôle Exécution » du
 *  registre V6 change la renormalisation (0.3→0.5, 0.6→1.0). */
export type VolontariteProfile = 'standard' | 'execution'
export interface DyadRole {
  label: string                 // libellé lisible (ex. 'Direction') — pour l'explicabilité
  volontariteProfile: VolontariteProfile
}

/** Statut d'un paramètre : ce que le code DOIT reproduire (reference) vs sa
 *  validité prédictive (calibration). Ne jamais confondre « reference » avec
 *  « scientifiquement validé » (cf. spec §36 : tout est provisoire, r≈0.72 n=25). */
export interface ParamStatus {
  implementation: 'current_reference' | 'proposed'   // règle V6 que le code DOIT reproduire, ou proposition
  calibration: 'provisional' | 'tested' | 'blocked'  // JAMAIS 'scientifically_validated'
}

export interface MarkerRegistryEntry {
  markerId: string              // 'C01'…'A02', 'K01'…'K09', 'X01'…'X03' ; jamais recyclé
  scope: MarkerScope
  axis: AxisId | null           // marqueur personne → axe ; null sinon
  dial?: DialId | null          // marqueur compte (K) → cadran ; null sinon
  tier: Tier
  ptsSpec: number | null        // mode SPEC. Fixe-signe : valeur signée. Bipolaire : magnitude (>0).
  sign: -1 | 0 | 1              // 0 = bipolaire (le sens vient de la mesure)
  volBase: number               // 0.3 | 0.6 | 1.0
  manipulable: Manipulable
  cost: Tier                    // = tier (non-manipulabilité et coût : même propriété)
  rule?: string                 // ex. S07 → Satisfaction ≤ 20
  deprecatedAt?: string | null
}

export interface MarkerRegistry {
  version: string               // ex. 'reg-v6.0'
  markers: Record<string, MarkerRegistryEntry>
}

export interface TierPoints { pos: number; neg: number }

export interface ScoringParams {
  version: string               // ex. 'params-v6.0'
  mode: 'palier' | 'spec'       // fait partie de la version : reproductibilité
  tiers: Record<Tier, TierPoints>
  repetition: { occ1: number; occ2to3: number; occ4plus: number }
  decay: number[]               // par magnitude (PAS temporel) ; rang > longueur → dernier
  volontarite: {
    prescrit: number; semi: number; volontaire: number
    execution: { prescrit: number; semi: number; volontaire: number }
  }
  axisWeights: Record<AxisId, number>
  // ── Côté compte (Météo, §12–22) ──
  dialWeights: Record<string, Record<DialId, number>>   // par type de relation
  authority: Record<string, number>                     // rôle (clé normalisée) → poids
  anchoring: { 0: number; 1: number; 2: number; threePlus: number }
  coverage: { capDeciderNoDyad: number; malusRcsUnreflected: number }
  dynamics: {
    weights: { pente: number; silence: number; solde: number }
    penteAnchors: { deltaHigh: number; vHigh: number; deltaMid: number; vMid: number; deltaLow: number; vLow: number }
    silenceAnchors: { r1: number; v1: number; r2: number; v2: number; r3: number; v3: number }
    solde: { base: number; step: number }
    k01CapMonths: number; k01Cap: number; k06Cap: number
  }
  status: Record<string, ParamStatus>   // par famille de paramètre
}

// ── Météo compte (S2) ──────────────────────────────────────────────────────
/** Dyade DÉJÀ active (≥5 échanges/12 mois + score dispo — décidé en amont) avec
 *  ses axes personne et l'autorité de son rôle. */
export interface AccountDyadInput {
  contactId: string
  authority: number             // 0.2 | 0.3 | 0.6 | 1.0
  satisfaction: number          // axe S de la dyade (0-100)
  confiance: number             // axe C
  reciprocite: number           // axe R
}
/** relationalLevel : niveau relationnel réel 0..1 (0=aucune interaction,
 *  0.5=interaction directe réelle, 0.75=plusieurs échanges substantiels,
 *  1=relation active/récente/récurrente). Optionnel pour rétro-compatibilité :
 *  si absent, dérivé de `covered` (true→1, false→0) — aucun test existant cassé. */
export interface CoverageTarget { role: string; authority: number; covered: boolean; isDecider: boolean; relationalLevel?: number }
/** K appliqué (occurrence compte). Seuls les non résolus (resolvedAt null) pèsent. */
export interface AccountKEvent {
  markerId: string
  occurrences?: number
  resolvedAt?: string | null
  openMonths?: number           // pour K01 (> 12 mois → plafond Dynamique)
  observedAt: string
  evidenceRef: string
  evidenceText?: string | null  // citation/extrait — jamais utilisé dans le calcul, uniquement pour « Preuves »
  isVerbatim?: boolean          // true si evidenceText est un extrait garanti fidèle (pas une paraphrase LLM)
}
export interface AccountDynamicsInput {
  /** false when cadence, trend, and outcome evidence are not observable. */
  available?: boolean
  delta30OtherDials: number     // Δ 30j de la moyenne des 5 autres cadrans
  daysSinceLast: number
  cadenceMedian: number
  engagementsHeld: number       // sur 90j
  engagementsSlipped: number    // sur 90j
}
export interface AccountWeatherInput {
  relationType: string          // clé dans dialWeights (ex. 'Client/Prospect')
  activeDyads: AccountDyadInput[]
  coverage: { targets: CoverageTarget[]; rcsChangeUnreflected?: boolean }
  equilibreShares: number[]     // volume d'échanges par interlocuteur (tous, actifs ou non)
  carriers: number              // porteurs internes actifs
  kEvents: AccountKEvent[]
  dynamics: AccountDynamicsInput
  at?: string
}

export interface DialContribution {
  markerId: string
  pointsEffectifs: number
  occurrences: number
  repetitionMultiplier: number
  contribution: number
  evidenceRef: string | null    // traçabilité de l'occurrence (la plus ancienne si agrégée) — pour l'UI « Preuves »
  observedAt: string | null     // idem, date — jamais utilisé dans le calcul, uniquement pour l'explicabilité
  evidenceText?: string | null  // citation/extrait — jamais utilisé dans le calcul, uniquement pour « Preuves »
  isVerbatim?: boolean          // true si evidenceText est un extrait garanti fidèle (pas une paraphrase LLM)
}
export interface DialResult {
  dial: DialId
  base: number | null           // null = cadran non calculable (pas de donnée)
  value: number | null          // null si non calculable ; sinon clamp(round(...),0,100)
  weight: number                // poids nominal (avant redistribution)
  effectiveWeight: number       // poids après redistribution des null
  cappedBy: string | null       // 'K06' | 'K01' | null
  modifiers: DialContribution[] // K appliqués
  note?: string                 // ex. redistribution, cap — détail technique, jamais affiché tel quel en carte
  trendDelta30d?: number | null // Δ 30j réel utilisé dans le calcul (aujourd'hui : d_dynamique uniquement)
}
export interface AccountWeatherCoreResult {
  score: number | null          // Météo 0-100 ; null si aucun cadran calculable
  dials: Record<DialId, DialResult>
  weakestDial: DialId | null
  relationType: string
  relationTypeStatus: 'current_reference' | 'provisional'
  paramsVersion: string
  registryVersion: string
  mode: 'palier' | 'spec'
  // AUCUN reliability / verdict / status : couche buildAccountWeatherSnapshot (S6).
}

/** Une occurrence observée, DÉJÀ admissible (preuve + date garanties en amont).
 *  Le core n'insère rien, ne filtre pas par date (pas de decay temporel) : il
 *  reçoit exactement les events à prendre en compte. */
export interface MarkerEvent {
  markerId: string
  sense: -1 | 1                 // sens mesuré ; pour un marqueur fixe-signe, ignoré (on prend entry.sign)
  observedAt: string            // conservé pour l'explicabilité ; JAMAIS utilisé pour pondérer
  evidenceUnitId?: string       // independent real event, not interpretation row
  evidenceRef: string           // traçabilité ; le core ne l'utilise pas dans le calcul
  evidenceText?: string | null  // citation/extrait — jamais utilisé dans le calcul, uniquement pour « Preuves »
  isVerbatim?: boolean          // true si evidenceText est un extrait garanti fidèle (pas une paraphrase LLM)
}

/** Détail intermédiaire d'une contribution — permet de répondre « Pourquoi 82 ? »
 *  sans reconstruire le raisonnement via un LLM. */
export interface MarkerContribution {
  markerId: string
  sense: -1 | 1
  occurrences: number
  evidenceUnitIds: string[]
  evidenceRefs: string[]
  pointsEffectifs: number       // points signés après mode (Palier tier | SPEC pts_spec)
  volontarite: number
  repetitionMultiplier: number
  magnitude: number             // |pointsEffectifs| × volontarite × repetitionMultiplier
  rank: number                  // rang après tri par magnitude décroissante
  decayMultiplier: number
  contributionFinale: number    // signe(pointsEffectifs) × magnitude × decayMultiplier
  // Preuve représentative du groupe (l'occurrence la plus récente qui en porte
  // une) — jamais utilisée dans le calcul, uniquement pour la carte « Preuves ».
  // null si aucune occurrence du groupe n'a de citation enregistrée (marqueurs
  // scorés avant ce champ, ou détecteur qui n'en produit structurellement pas).
  observedAt: string | null
  evidenceText: string | null
}

export interface AxisResult {
  axis: AxisId
  base: number | null           // 50 si observé ; null si aucun marqueur sur cet axe (jamais un 50 fabriqué)
  value: number | null          // clamp(round(50 + Σ contributions), 0, 100) si observé, sinon null
  weight: number
  cappedByS07: boolean
  contributions: MarkerContribution[]
}

export interface DyadScoreCoreResult {
  score: number                 // moyenne pondérée des SEULS axes observés (poids renormalisés), arrondi
  axes: Record<AxisId, AxisResult>
  role: DyadRole
  paramsVersion: string
  registryVersion: string
  mode: 'palier' | 'spec'
  // AUCUN champ reliability / verdict / status : c'est la couche snapshot.
}
