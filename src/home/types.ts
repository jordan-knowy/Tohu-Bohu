/**
 * Contrat de données de la Home.
 *
 * Règle « zéro hallucination » : toute valeur dont la source n'existe pas en
 * base est `null` (jamais une valeur inventée). L'interface affiche alors
 * « Données insuffisantes » ou masque la sous-section.
 */

export type HomeRelationLevel = 'strong' | 'intermediate' | 'fragile' | 'unavailable'

/** Bandes du score relationnel (doctrine anti-NPS) : 70-100 Solide, 50-69 Intermédiaire, 0-49 Fragile. */
export function relationLevel(score: number | null): HomeRelationLevel {
  if (score === null || !Number.isFinite(score)) return 'unavailable'
  if (score >= 70) return 'strong'
  if (score >= 50) return 'intermediate'
  return 'fragile'
}

export type HomeSyncJob = {
  id: string
  jobType: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  currentStep: string | null
  progress: number | null
  provider: string | null
  startedAt: string | null
  completedAt: string | null
  errorMessage: string | null
  payload: Record<string, unknown>
}

/** Organisation détectée dans les échanges (état S2). */
export type HomeAccountCandidate = {
  /** null si l'organisation n'existe pas encore dans `companies`. */
  companyId: string | null
  name: string
  domain: string | null
  industry: string | null
  location: string | null
  interactions: number
  lastInteractionAt: string | null
  source: string
  alreadyTracked: boolean
  selected: boolean
}

export type HomeAccountSummary = {
  id: string
  name: string
  industry: string | null
  score: number | null
  level: HomeRelationLevel
  confidence: number | null
  trend: 'up' | 'down' | 'stable' | null
  lastInteractionAt: string | null
}

export type HomeAtRiskAccount = HomeAccountSummary & {
  /** Score de risque documenté dans home-priority.ts (pas l'inverse du score). */
  riskScore: number
  riskReasons: string[]
}

export type HomeSourceStatus = {
  provider: string
  label: string
  status: 'connected' | 'partial' | 'error' | 'disconnected'
  lastSyncedAt: string | null
  accountEmail: string | null
}

export type HomeSignal = {
  id: string
  kind: 'company' | 'behavioral'
  signalType: string
  title: string
  summary: string | null
  accountId: string | null
  accountName: string | null
  personId: string | null
  personName: string | null
  source: string
  observedAt: string
  confidence: number | null
  inferenceLevel: string | null
  /** Verdict déjà donné par l'utilisateur via signal_feedback, sinon null. */
  userVerdict: 'confirmed' | 'dismissed' | null
}

export type HomeActionType =
  | 'relance'
  | 'mouvement'
  | 'risque'
  | 'couverture'
  | 'validation'
  | 'opportunite'

export type HomePriorityAction = {
  /** Identifiant déterministe (`type:entityId`) — permet la persistance d'état. */
  actionId: string
  type: HomeActionType
  title: string
  explanation: string
  priority: number
  accountId: string | null
  accountName: string | null
  personId: string | null
  personName: string | null
  source: string
  observedAt: string
  confidence: number | null
  sourceSignalId: string | null
  recommended: string
}

export type HomeTeamMember = {
  userId: string
  fullName: string
  avatarUrl: string | null
  accounts: number
  contacts: number
  score: number | null
  delta30d: number | null
}

export type HomeDashboardData = {
  generatedAt: string
  workspaceId: string

  /**
   * true si des objets SQL de la migration Home manquent : les blocs concernés
   * affichent « non configuré », jamais une valeur simulée.
   */
  degraded: boolean
  degradedReasons: string[]

  onboarding: {
    /** true dès qu'au moins un compte est suivi → Expérience B. */
    portfolioReady: boolean
    trackingColumnAvailable: boolean
    compatibleConnector: HomeSourceStatus | null
    activeJob: HomeSyncJob | null
    lastDetectionJob: HomeSyncJob | null
  }

  plan: {
    name: string
    trackedAccounts: number
    /** null = illimité ou non configuré (voir limitConfigured). */
    accountLimit: number | null
    limitConfigured: boolean
    status: string
  }

  lastVisitDigest: {
    since: string | null
    newSignals: number
    coolingAccounts: number
    jobChanges: number
    newPeople: number
    overdueActions: number
  } | null

  globalRelationship: {
    score: number | null
    level: HomeRelationLevel
    confidence: number | null
    computedAt: string | null
    delta30d: number | null
    includedAccounts: number
    excludedAccounts: number
    distribution: { strong: number; intermediate: number; fragile: number } | null
  }

  /** Benchmark sectoriel : null tant qu'aucune source/méthodologie n'existe (sous-section masquée). */
  benchmark: null | {
    sector: string
    value: number
    methodology: string
    computedAt: string
    isEstimate: boolean
  }

  sources: HomeSourceStatus[]

  activity: {
    exchanges: number | null
    signalsToday: number | null
    lastSyncAt: string | null
  }

  counters: {
    accounts: number
    accountsDelta30d: number | null
    people: number
    peopleDelta30d: number | null
    activeRelationships: number
    decliningRelationships: number
  }

  topAccounts: {
    best: HomeAccountSummary[]
    atRisk: HomeAtRiskAccount[]
  }

  teamMembers: HomeTeamMember[]
  priorityActions: HomePriorityAction[]
  latestSignals: HomeSignal[]
  coaching: HomeCoaching
}

export type HomeCoachingInsight = {
  id: string
  trait: string
  observation: string
  confidence: number | null
  feedback: 'useful' | 'inaccurate' | null
}

/**
 * Style de communication observé du collaborateur connecté (SPEC-05 : sourcé,
 * daté, confiance qualitative, jamais un diagnostic de personnalité).
 * `null` tant que la couverture d'échanges analysés est insuffisante —
 * jamais un profil synthétique affiché en dessous du seuil.
 */
export type HomeCoaching = {
  executiveSummary: string | null
  updatedAt: string | null
  insights: HomeCoachingInsight[]
} | null
