// Contrat de données de la fiche Personne.
// Tout champ incertain est nullable : l'interface affiche « À confirmer »
// ou un état vide, jamais une valeur inventée.

export interface DataSourceReference {
  sourceType: string
  sourceId: string | null
  sourceLabel: string
  sourceUrl: string | null
  observedAt: string | null
  importedAt: string | null
  lastVerifiedAt: string | null
  confidence: number | null
  inferenceLevel: 'fact' | 'strong_inference' | 'weak_inference' | 'manual' | 'observed' | 'inferred' | null
}

export type RelationshipPhase = 'growing' | 'stable' | 'declining' | 'unknown'

export type PersonRecommendationStatus = 'open' | 'in_progress' | 'completed' | 'dismissed' | 'postponed'

export type PersonRecommendation = {
  id: string
  kind: 'coaching' | 'action'
  category: string
  actionType: string | null
  priority: number
  title: string
  justification: string
  recommendedAction: string | null
  triggerSignal: string | null
  leanOn: string[]
  avoid: string[]
  evolutions: Array<{ direction: 'new' | 'up' | 'down'; text: string }>
  dueAt: string | null
  status: PersonRecommendationStatus
  feedbackType: 'useful' | 'incorrect' | null
  provenance: DataSourceReference
}

export type PersonSignal = {
  id: string
  type: string
  title: string
  summary: string | null
  validationStatus: 'confirmed' | 'dismissed' | null
  provenance: DataSourceReference
}

export type PersonBehavioralInsight = {
  id: string
  trait: string
  observation: string
  confidence: number | null
  provenance: DataSourceReference
}

export type PersonEvidence = {
  id: string
  trait: string | null
  text: string
  sourceLabel: string
  observedAt: string | null
  confidence: number | null
  inferenceLevel: string | null
}

export type CognitiveThemeStatus = 'observed' | 'emerging' | 'insufficient'
export type CognitiveEvolution = 'rising' | 'stable' | 'declining' | 'mixed' | null

export type PersonCognitiveTheme = {
  id: string
  status: CognitiveThemeStatus
  score: number | null
  label: string | null
  observation: string | null
  confidence: number | null
  evidenceCount: number
  sourceTypes: string[]
  evolution: CognitiveEvolution
}

export type PrimaryAxisId = 'rythme' | 'argumentation' | 'engagement' | 'registre' | 'tonalite' | 'espace_parole'
export type SecondaryAxisId = 'orientation' | 'certainty' | 'novelty' | 'initiative'
export type AxisPole = 'left' | 'right'
export type AxisTrend = 'rising' | 'stable' | 'declining' | null

export type PersonPrimaryAxis = {
  id: PrimaryAxisId
  label: string
  poleLeft: string
  poleRight: string
  status: CognitiveThemeStatus
  rawScore: number | null
  marginPts: number | null
  trendPts: number | null
  trendLabel: AxisTrend
  predominancePct: number | null
  activePole: AxisPole | null
  observation: string | null
  confidence: number | null
  evidence: string[]
  evidenceCount: number
  sourceTypes: string[]
}

export type PersonSecondaryAxis = {
  id: SecondaryAxisId
  label: string
  poleLeft: string
  poleRight: string
  status: CognitiveThemeStatus
  score: number | null
  predominancePct: number | null
  activePole: AxisPole | null
  observation: string | null
  confidence: number | null
  evidenceCount: number
  sourceTypes: string[]
}

/** Scénario « comment aborder cette personne » : do/don't contextuels déduits
 *  de l'analyse comportementale (moteur v3+). Vide tant que non ré-analysé. */
export type PersonApproachScenario = {
  context: string
  summary: string | null
  do: string[]
  dont: string[]
}

export type PersonCognitiveProfile = {
  schemaVersion: number
  maturity: 'none' | 'emerging' | 'usable' | 'consolidated' | 'refined'
  interpersonal: {
    assertiveness: PersonCognitiveTheme
    warmth: PersonCognitiveTheme
  }
  primaryAxes: PersonPrimaryAxis[]
  /** Mêmes axes recalculés par source (P6.3). Vide tant que non ré-analysé. */
  primaryAxesBySource: { email: PersonPrimaryAxis[]; meeting: PersonPrimaryAxis[] }
  secondaryAxes: PersonSecondaryAxis[]
  posture: PersonCognitiveTheme
  approachGuidance: PersonApproachScenario[]
}

export type PersonCareerEntry = {
  id: string
  entryType: 'experience' | 'education' | 'detected_change'
  title: string
  organizationName: string
  accountId: string | null
  location: string | null
  startedAt: string | null
  endedAt: string | null
  current: boolean
  description: string | null
  verificationStatus: 'confirmed' | 'probable' | 'to_confirm' | 'rejected'
  provenance: DataSourceReference
}

export type PersonContactDetail = {
  id: string
  type: 'email' | 'phone' | 'linkedin' | 'website' | 'location' | 'other'
  value: string
  label: string | null
  primary: boolean
  verificationStatus: 'verified' | 'unverified' | 'invalid'
  visibility: 'private' | 'workspace'
  provenance: DataSourceReference | null
}

export type PersonMemoryEntry = {
  id: string
  entryType: string
  content: string
  fileName: string | null
  filePath: string | null
  transcription: string | null
  processingStatus: string
  authorName: string
  sourceType: string
  sourceLabel: string | null
  visibility: string
  resolvedAt: string | null
  createdAt: string
  // Preuve verbatim (renseignée à partir de l'analyse email v36+) : phrase source
  // exacte + date/direction du message d'origine. null pour les engagements
  // antérieurs (contenu des emails non conservé).
  sourceExcerpt: string | null
  sourceOccurredAt: string | null
  sourceDirection: 'inbound' | 'outbound' | null
}

export type PersonKeyMoment = {
  id: string
  occurredAt: string
  title: string
  summary: string | null
  impact: 'friction' | 'reinforce' | 'milestone'
  confidence: number | null
  sourceLabel: string
}

export type PersonSourceStatus = {
  provider: string
  label: string
  status: string
  lastSyncedAt: string | null
  interactionCount: number | null
  error: string | null
}

/** contacts.enrichment_data (recherche web) — jamais du contenu de messages,
 *  toujours sourcé (url/source par entrée). Null tant qu'aucun enrichissement n'a eu lieu. */
export type PersonEnrichmentActivity = { title: string; date: string | null; source: string | null; url: string | null }
export type PersonEnrichmentContact = { name: string; role: string | null; why: string | null }
export type PersonEnrichmentProfile = {
  summary: string | null
  currentRole: string | null
  currentCompany: string | null
  roleStartedAt: string | null
  roleConfidence: string | null
  location: string | null
  linkedinUrl: string | null
  talkingPoints: string[]
  relatedPeople: PersonEnrichmentContact[]
  recentActivity: PersonEnrichmentActivity[]
}

export type PersonHistoryEvent = {
  id: string
  type: 'meeting' | 'email' | 'signal' | 'note' | 'career' | 'score'
  title: string
  description: string | null
  occurredAt: string
  sourceLabel: string
}

export type PersonNameSuggestion = {
  id: string
  suggestedFullName: string
  source: 'enrichment_agent' | 'signature'
  evidence: string | null
  createdAt: string
}

export type PersonMergeSuggestion = {
  id: string
  otherContactId: string
  otherContactName: string
  otherContactEmail: string | null
  confidence: 'high' | 'medium'
  evidence: { name_similarity?: number; linkedin_match?: boolean; same_company?: boolean; shares_surname?: boolean }
  createdAt: string
}

export type PersonScorePoint = {
  monthKey: string
  score: number | null
  phase: string | null
  interactionCount: number | null
  confidence: number | null
}

export interface PersonDetailData {
  generatedAt: string
  degradedReasons: string[]

  person: {
    id: string
    workspaceId: string
    fullName: string
    avatarUrl: string | null
    jobTitle: string | null
    location: string | null
    biography: string | null
    relationshipType: string | null
    decisionRole: string | null
    relationshipRole: string | null
    favorite: boolean
    watchEnabled: boolean
    archivedAt: string | null
    primaryOwnerName: string | null
    primaryOwnerUserId: string | null
    visibility: 'workspace' | 'restricted'
    createdAt: string | null
    updatedAt: string | null
    locked: boolean
    lockedByMe: boolean
    lockedByName: string | null
    lockedAt: string | null
  }

  summary: {
    text: string
    confidence: number | null
    generatedAt: string | null
    provenance: DataSourceReference | null
  } | null

  employment: {
    accountId: string
    accountName: string
    accountLogoUrl: string | null
    jobTitle: string | null
    sector: string | null
  } | null

  relationship: {
    score: number | null
    phase: RelationshipPhase
    phaseDelta: number | null
    confidence: number | null
    computedAt: string | null
    totalInteractions: number
    emailInteractions: number
    meetingInteractions: number
    firstInteractionAt: string | null
    lastInteractionAt: string | null
    // Ancienneté observée en jours (fait) — n'entre plus dans le calcul du
    // score composite (5 axes), affichée à titre de contexte.
    relationshipAgeDays: number | null
    // Score PERSONNE 5 axes (Confiance 25% / Satisfaction 25% / Engagement 20% /
    // Réciprocité 20% / Ancrage 10%). Confiance/Satisfaction viennent de
    // l'analyse IA du contenu des échanges (voir cognitive_profiles) : null tant
    // qu'aucune analyse n'a encore eu lieu pour ce contact — jamais fabriqué.
    dimensions: {
      confiance: number | null
      satisfaction: number | null
      engagement: number | null
      reciprocite: number | null
      ancrage: number | null
      ancrageCarriers: number | null
      confianceMeasured: boolean
      satisfactionMeasured: boolean
    }
    /** Phrase déterministe générée depuis les 5 axes (voir score-batch), jamais un simple "score/100". */
    axisInterpretation: string | null
  }

  scoreHistory: PersonScorePoint[]

  behavior: {
    executiveSummary: string | null
    globalConfidence: number | null
    cognitiveMode: string | null
    availableInteractions: number
    analyzedInteractions: number
    analyzedEmailInteractions: number
    analyzedMeetingInteractions: number
    profileMinimumInteractions: number
    minimumInteractions: number
    cognitiveProfile: PersonCognitiveProfile
    insights: PersonBehavioralInsight[]
    evidences: PersonEvidence[]
    updatedAt: string | null
  }

  sources: PersonSourceStatus[]
  recommendations: PersonRecommendation[]
  signals: PersonSignal[]
  contactDetails: PersonContactDetail[]
  careerEntries: PersonCareerEntry[]
  memoryEntries: PersonMemoryEntry[]
  keyMoments: PersonKeyMoment[]
  enrichment: PersonEnrichmentProfile | null
  history: PersonHistoryEvent[]
  nameSuggestion: PersonNameSuggestion | null
  mergeSuggestions: PersonMergeSuggestion[]
}

export const RELATIONSHIP_TYPES = [
  'Prospect', 'Client', 'Partenaire', 'Fournisseur / Prestataire', 'Investisseur', 'Collègue', 'Interne', 'Réseau',
] as const

export const DECISION_ROLES = [
  'Initiateur', 'Utilisateur', 'Influenceur', 'Filtre', 'Décideur', 'Acheteur',
] as const

export const MIN_BEHAVIOR_INTERACTIONS = 10
export const MIN_COGNITIVE_PROFILE_INTERACTIONS = 3
