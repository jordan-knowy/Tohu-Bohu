// Copie exacte de src/services/scoring/registry-v6.ts — voir le commentaire
// de types.ts dans ce même dossier pour la raison de cette duplication.
// Fixtures V6 — registre des marqueurs (22 personne + K01–K09 + X01–X03) et
// paramètres. Statique, versionné, IMMUABLE : un changement = nouvelle version.

import type { DialId, MarkerRegistry, MarkerRegistryEntry, ScoringParams } from './types.ts'

function m(
  markerId: string, axis: MarkerRegistryEntry['axis'], tier: MarkerRegistryEntry['tier'],
  ptsSpec: number | null, sign: -1 | 0 | 1, volBase: number,
  manipulable: MarkerRegistryEntry['manipulable'], rule?: string,
): MarkerRegistryEntry {
  return { markerId, scope: axis ? 'person' : 'out_of_score', axis, dial: null, tier, ptsSpec, sign, volBase, manipulable, cost: tier, rule }
}
function k(
  markerId: string, dial: DialId, tier: MarkerRegistryEntry['tier'], ptsSpec: number, sign: -1 | 0,
  rule: string,
): MarkerRegistryEntry {
  return { markerId, scope: 'account', axis: null, dial, tier, ptsSpec, sign, volBase: 1.0, manipulable: 'non', cost: tier, rule }
}

const PERSON_MARKERS: MarkerRegistryEntry[] = [
  m('C01', 'confiance', 'important', +20, +1, 1.0, 'non'),
  m('C02', 'confiance', 'faible', +6, +1, 0.6, 'oui'),
  m('C03', 'confiance', 'moyen', +10, +1, 1.0, 'oui'),
  m('C04', 'confiance', 'moyen', +14, +1, 1.0, 'oui'),
  m('C05', 'confiance', 'important', +18, +1, 1.0, 'non'),
  m('S01', 'satisfaction', 'moyen', -14, -1, 1.0, 'non'),
  m('S02', 'satisfaction', 'important', -16, -1, 1.0, 'non'),
  m('S03', 'satisfaction', 'moyen', -12, -1, 1.0, 'non'),
  m('S04', 'satisfaction', 'faible', -8, -1, 1.0, 'non'),
  m('S05', 'satisfaction', 'faible', -8, -1, 1.0, 'oui'),
  m('S06', 'satisfaction', 'important', -14, -1, 1.0, 'non'),
  m('S07', 'satisfaction', 'critique', -30, -1, 1.0, 'non', 'Satisfaction ≤ 20 après calcul'),
  m('S08', 'satisfaction', 'moyen', +12, +1, 1.0, 'difficile'),
  m('E01', 'engagement', 'important', +20, +1, 1.0, 'non'),
  m('E02', 'engagement', 'important', +18, +1, 1.0, 'non'),
  m('E03', 'engagement', 'moyen', +10, +1, 0.6, 'oui'),
  m('E04', 'engagement', 'important', +18, +1, 1.0, 'difficile'),
  m('E05', 'engagement', 'faible', 6, 0, 0.3, 'oui'),
  m('R01', 'reciprocite', 'important', 16, 0, 1.0, 'non', 'toujours contre la baseline de la dyade — jamais un seuil universel'),
  m('R02', 'reciprocite', 'moyen', 14, 0, 1.0, 'difficile', 'la relance ne compte pas positivement'),
  m('A01', 'ancrage', 'important', 16, 0, 1.0, 'non'),
  m('A02', 'ancrage', 'moyen', 14, 0, 1.0, 'non'),
  m('X01', null, 'neutre', 0, 0, 0, 'non', 'canal non instrumenté → baisse la fiabilité, jamais un point'),
  m('X02', null, 'neutre', 0, 0, 0, 'non', 'rupture typée → force le statut Rompu'),
  m('X03', null, 'neutre', 0, 0, 0, 'non', 'rupture de rituel subie → engagements/contexte'),
]

const ACCOUNT_MARKERS: MarkerRegistryEntry[] = [
  k('K01', 'd_dynamique', 'important', -20, -1, 'contrat signé sans flux ; si ouvert > 12 mois → Dynamique ≤ 15'),
  k('K02', 'd_dynamique', 'important', -25, -1, 'créance échue ; escalade Critique (-40 SPEC) si > 90 j — le détecteur fixe le tier applicable'),
  k('K03', 'd_satisfaction', 'important', -20, -1, 'demande formelle sans réponse ; par demande × répétition'),
  k('K04', 'd_dynamique', 'moyen', -15, -1, 'livrable contractuel en retard ; compte aussi comme engagement glissé'),
  k('K05', 'd_ancrage', 'important', -20, -1, 'porteur parti sans passation ; levé à la réattribution'),
  k('K06', 'd_satisfaction', 'critique', -40, -1, 'rétention de livrable ; Satisfaction ≤ 20 tant qu’ouvert'),
  k('K07', 'd_satisfaction', 'faible', -10, -1, 'incident ; escalade Important (-25 SPEC) si non résolu sous 7 j'),
  k('K08', 'd_ancrage', 'moyen', -15, -1, 'contact vers adresse morte ; par occurrence × répétition'),
  k('K09', 'd_couverture', 'neutre', 0, 0, 'décideur entré par escalade ; 0 point, état « couvert par escalade »'),
]

export const REGISTRY_V6: MarkerRegistry = {
  version: 'reg-v6.0',
  markers: Object.fromEntries([...PERSON_MARKERS, ...ACCOUNT_MARKERS].map((entry) => [entry.markerId, entry])),
}

const REF = { implementation: 'current_reference', calibration: 'provisional' } as const
const PROP = { implementation: 'proposed', calibration: 'provisional' } as const
const BLOCKED = { implementation: 'proposed', calibration: 'blocked' } as const
const STATUS = {
  tiers: REF, repetition: REF, decay: REF, volontarite: REF, axisWeights: REF,
  authority: REF, anchoring: REF, dynamics: REF,
  dialWeightsClientProspect: REF,
  dialWeightsOtherTypes: PROP,
  temporalDecay: BLOCKED,
} as const

export const PARAMS_V6_PALIER: ScoringParams = {
  version: 'params-v6.0-palier',
  mode: 'palier',
  tiers: {
    faible: { pos: +6, neg: -8 },
    moyen: { pos: +12, neg: -14 },
    important: { pos: +20, neg: -20 },
    critique: { pos: 0, neg: -30 },
    neutre: { pos: 0, neg: 0 },
  },
  repetition: { occ1: 1.0, occ2to3: 1.4, occ4plus: 1.7 },
  decay: [1.0, 0.7, 0.5, 0.35, 0.25, 0.2, 0.15, 0.1],
  volontarite: {
    prescrit: 0.3, semi: 0.6, volontaire: 1.0,
    execution: { prescrit: 0.5, semi: 1.0, volontaire: 1.0 },
  },
  axisWeights: { confiance: 0.25, satisfaction: 0.25, engagement: 0.20, reciprocite: 0.20, ancrage: 0.10 },
  dialWeights: {
    'Client/Prospect': { d_satisfaction: .25, d_confiance_recip: .20, d_couverture: .20, d_equilibre: .15, d_ancrage: .10, d_dynamique: .10 },
    Fournisseur: { d_satisfaction: .30, d_confiance_recip: .25, d_couverture: .05, d_equilibre: .05, d_ancrage: .15, d_dynamique: .20 },
    Partenaire: { d_satisfaction: .15, d_confiance_recip: .25, d_couverture: .15, d_equilibre: .15, d_ancrage: .10, d_dynamique: .20 },
    Investisseur: { d_satisfaction: .15, d_confiance_recip: .30, d_couverture: .20, d_equilibre: .05, d_ancrage: .20, d_dynamique: .10 },
    Interne: { d_satisfaction: .20, d_confiance_recip: .30, d_couverture: .05, d_equilibre: .05, d_ancrage: .30, d_dynamique: .10 },
  },
  authority: { decideur: 1.0, influenceur: 0.6, utilisateur: 0.3, filtre: 0.2 },
  anchoring: { 0: 0, 1: 25, 2: 60, threePlus: 100 },
  coverage: { capDeciderNoDyad: 40, malusRcsUnreflected: -15 },
  dynamics: {
    weights: { pente: 0.30, silence: 0.40, solde: 0.30 },
    penteAnchors: { deltaHigh: 5, vHigh: 100, deltaMid: 0, vMid: 50, deltaLow: -10, vLow: 0 },
    silenceAnchors: { r1: 1, v1: 100, r2: 2, v2: 50, r3: 3, v3: 0 },
    solde: { base: 50, step: 10 },
    k01CapMonths: 12, k01Cap: 15, k06Cap: 20,
  },
  status: STATUS,
}

export const PARAMS_V6_SPEC: ScoringParams = {
  ...PARAMS_V6_PALIER,
  version: 'params-v6.0-spec',
  mode: 'spec',
}

export function relationTypeStatus(relationType: string): 'current_reference' | 'provisional' {
  return relationType === 'Client/Prospect' ? 'current_reference' : 'provisional'
}
