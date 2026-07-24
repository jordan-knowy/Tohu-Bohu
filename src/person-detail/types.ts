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

export type PersonCognitiveProfile = {
  schemaVersion: number
  maturity: 'none' | 'emerging' | 'usable' | 'consolidated' | 'refined'
  interpersonal: {
    assertiveness: PersonCognitiveTheme
    warmth: PersonCognitiveTheme
  }
  exchangeStyles: PersonCognitiveTheme[]
  speechActs: PersonCognitiveTheme[]
  observableMarkers: PersonCognitiveTheme[]
  posture: PersonCognitiveTheme
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
  type: 'email' | 'phone' | 'linkedin' | 'website' | 'other'
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
  visibility: string
  createdAt: string
}

export type PersonSourceStatus = {
  provider: string
  label: string
  status: string
  lastSyncedAt: string | null
  interactionCount: number | null
  error: string | null
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
    createdAt: string | null
    updatedAt: string | null
    locked: boolean
    lockedByMe: boolean
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
    dimensions: {
      intensity: number | null
      reciprocity: number | null
      longevity: number | null
    }
  }

  scoreHistory: PersonScorePoint[]

  behavior: {
    executiveSummary: string | null
    globalConfidence: number | null
    cognitiveMode: string | null
    analyzedInteractions: number
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
  history: PersonHistoryEvent[]
  nameSuggestion: PersonNameSuggestion | null
  mergeSuggestions: PersonMergeSuggestion[]
}

export const RELATIONSHIP_TYPES = [
  'Prospect', 'Client', 'Partenaire', 'Fournisseur / Prestataire', 'Investisseur', 'Interne', 'Réseau',
] as const

export const DECISION_ROLES = [
  'Initiateur', 'Utilisateur', 'Influenceur', 'Filtre', 'Décideur', 'Acheteur',
] as const

export const MIN_BEHAVIOR_INTERACTIONS = 10
export const MIN_COGNITIVE_PROFILE_INTERACTIONS = 3
