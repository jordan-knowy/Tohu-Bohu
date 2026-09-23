// Canonical V6 module: shared by browser and edge.
// Classificateur sémantique — DÉTECTEUR (jamais un score). Opère sur des EXTRAITS
// déjà dérivés et persistés (person_key_moments.summary / commitments.source_excerpt) —
// les corps bruts n'étant pas stockés. Le LLM choisit dans un REGISTRE FERMÉ ou
// répond NO_MARKER ; il ne produit jamais de nombre d'axe. Preuve + date obligatoires.
// Garde-fous : marqueur hors registre rejeté ; S07/K06 exigent un verbatim ;
// confiance faible ou doute → candidate_only (jamais scoré tant que non validé).
// La partie ci-dessous est PURE et testable ; l'appel LLM vit dans l'edge function.

export const SEMANTIC_REGISTRY: Record<string, { axis: string; sense: -1 | 0 | 1; requiresVerbatim: boolean; definition: string }> = {
  C01: { axis: 'confiance', sense: 1, requiresVerbatim: false, definition: 'divulgation interne/personnelle non nécessaire à la tâche' },
  C05: { axis: 'confiance', sense: 1, requiresVerbatim: false, definition: 'jugement personnel partagé sur un tiers absent' },
  C06: { axis: 'confiance', sense: 1, requiresVerbatim: false, definition: 'nous confie une tâche, une décision ou une responsabilité (délègue, donne son accord pour procéder, « je vous laisse faire »)' },
  C07: { axis: 'confiance', sense: 1, requiresVerbatim: false, definition: 'sollicite notre avis, notre expertise ou notre conseil' },
  C08: { axis: 'confiance', sense: 1, requiresVerbatim: false, definition: 'prend un engagement ferme envers nous (action précise avec échéance ou confirmation nette)' },
  C09: { axis: 'confiance', sense: -1, requiresVerbatim: false, definition: 'remet en cause notre fiabilité ou notre parole, ou exige des garanties (doute explicite)' },
  S03: { axis: 'satisfaction', sense: -1, requiresVerbatim: false, definition: 'appréciation négative explicite' },
  S06: { axis: 'satisfaction', sense: -1, requiresVerbatim: false, definition: 'désintermédiation / contournement direct' },
  S07: { axis: 'satisfaction', sense: -1, requiresVerbatim: true, definition: 'dénonciation auprès d’un tiers (CRITIQUE : verbatim obligatoire)' },
  S08: { axis: 'satisfaction', sense: 1, requiresVerbatim: false, definition: 'retour positif exprimé par le contact — remerciement, satisfaction, appréciation, même simple ou de politesse habituelle' },
  E01: { axis: 'engagement', sense: 1, requiresVerbatim: false, definition: 'mise en relation avec un tiers de son réseau' },
  E02: { axis: 'engagement', sense: 1, requiresVerbatim: false, definition: 'ouverture d’organigramme / accès à collègues ou hiérarchie' },
  E03: { axis: 'engagement', sense: 1, requiresVerbatim: false, definition: 'projection au-delà de l’engagement courant (planifie la suite, propose un prochain échange, anticipe une prochaine étape)' },
  E04: { axis: 'engagement', sense: 1, requiresVerbatim: false, definition: 'artefact / livrable transmis (document, information, ressource), même partiellement en réponse à une demande' },
}
export const SEMANTIC_MARKER_IDS = Object.keys(SEMANTIC_REGISTRY)

/** Confiance minimale pour un marqueur scoré (accepted). En dessous → candidate. */
export const CLASSIFIER_ACCEPT_CONFIDENCE = 0.75

export interface ClassifierInput {
  extractId: string          // id du moment / commitment (evidence_ref)
  extractText: string        // summary / source_excerpt
  hasVerbatim: boolean       // vrai si extractText est un verbatim exact (commitment.source_excerpt)
  observedAt: string | null
  contactId: string
  source: string             // 'person_key_moment' | 'person_memory_entry'
}

export interface ClassifierRawResponse {
  marker_id?: string
  sense?: number
  confidence?: number
  rationale?: string
}

export interface SemanticMarkerDraft {
  markerId: string; scope: 'person'; sense: -1 | 1; observedAt: string | null
  evidenceRef: string; evidenceText: string; confidence: number
  isCandidate: boolean; detectorVersion: string; rationale: string
}

export const SEMANTIC_DETECTOR_VERSION = 'semantic-classifier-v1'

/** Construit le prompt à REGISTRE FERMÉ. Le modèle ne peut choisir que dans la liste. */
export function buildClassifierPrompt(input: ClassifierInput): string {
  const registry = SEMANTIC_MARKER_IDS.map((id) => `- ${id} : ${SEMANTIC_REGISTRY[id]!.definition} (sens ${SEMANTIC_REGISTRY[id]!.sense >= 0 ? '+' : '−'})`).join('\n')
  return `Tu es un DÉTECTEUR de marqueurs relationnels. Tu ne produis JAMAIS de score.
À partir de l'extrait ci-dessous (déjà extrait d'un échange réel), indique s'il correspond EXACTEMENT à l'un des marqueurs du REGISTRE FERMÉ suivant, sinon réponds NO_MARKER.
Tu ne peux choisir QUE dans cette liste (aucun autre identifiant, aucune invention) :
${registry}

Extrait : « ${input.extractText} »

Réponds en JSON strict : {"marker_id":"<ID du registre>|NO_MARKER","sense":-1|1,"confidence":0..1,"rationale":"<1 phrase>"}
Règle : si tu hésites, réponds NO_MARKER. Ne force jamais un marqueur.`
}

/**
 * Valide la réponse du LLM et produit un draft, ou null. Applique TOUS les garde-fous :
 * registre fermé, verbatim obligatoire (S07…), seuil de confiance → candidate.
 */
export function parseClassifierResponse(input: ClassifierInput, raw: ClassifierRawResponse): SemanticMarkerDraft | null {
  const id = (raw.marker_id ?? '').trim()
  if (!id || id === 'NO_MARKER') return null
  const entry = SEMANTIC_REGISTRY[id]
  if (!entry) return null                            // hors registre fermé → rejet
  if (!input.observedAt) return null                 // pas de date → pas de marqueur
  const confidence = Number.isFinite(Number(raw.confidence)) ? Math.max(0, Math.min(1, Number(raw.confidence))) : 0
  // sens : signe fixe du registre (les marqueurs sémantiques ici ne sont pas bipolaires)
  const sense: -1 | 1 = entry.sense === 0 ? (raw.sense as -1 | 1 ?? 1) : (entry.sense as -1 | 1)
  // Verbatim obligatoire (S07/K06…) : sans preuve verbatim → candidate au mieux, jamais scoré
  let isCandidate = confidence < CLASSIFIER_ACCEPT_CONFIDENCE
  if (entry.requiresVerbatim && !input.hasVerbatim) isCandidate = true
  return {
    markerId: id, scope: 'person', sense, observedAt: input.observedAt,
    evidenceRef: input.extractId, evidenceText: input.extractText, confidence,
    isCandidate, detectorVersion: SEMANTIC_DETECTOR_VERSION, rationale: String(raw.rationale ?? '').slice(0, 240),
  }
}
