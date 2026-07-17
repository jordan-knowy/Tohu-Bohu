export type Provenance = {
  sourceType: string
  sourceId: string | null
  sourceLabel: string
  sourceUrl: string | null
  observedAt: string | null
  importedAt: string | null
  lastVerifiedAt: string | null
  confidence: number | null
  inferenceLevel: string | null
}

export type AccountPerson = {
  id: string
  name: string
  email: string | null
  jobTitle: string | null
  avatarUrl: string | null
  organizationalRole: string | null
  decisionRole: string | null
  relationshipRole: string | null
  score: number | null
  phase: string | null
  confidence: number | null
  lastInteractionAt: string | null
  exchangeShare: number | null
  ownerName: string | null
  provenance: Provenance | null
}

export type AccountRecommendation = {
  id: string
  category: string
  priority: number
  title: string
  justification: string
  recommendedAction: string | null
  personId: string | null
  personName: string | null
  impactType: string | null
  dueAt: string | null
  status: 'open' | 'completed' | 'dismissed' | 'postponed'
  assignedTo: string | null
  provenance: Provenance
}

export type AccountSignal = {
  id: string
  type: string
  title: string
  summary: string | null
  impact: string | null
  personId: string | null
  validationStatus: 'confirmed' | 'dismissed' | null
  provenance: Provenance
}

export type AccountMemoryEntry = {
  id: string
  entryType: string
  content: string
  authorName: string
  visibility: string
  filePath: string | null
  createdAt: string
  provenance: Provenance
}

export type AccountFirmographicFact = {
  id: string
  key: string
  value: unknown
  validationStatus: string
  provenance: Provenance
}

export interface AccountDetailData {
  generatedAt: string
  degradedReasons: string[]
  account: {
    id: string
    workspaceId: string
    name: string
    legalName: string | null
    logoUrl: string | null
    domain: string | null
    websiteUrl: string | null
    description: string | null
    sector: string | null
    accountType: string | null
    relationshipStatus: string | null
    relationshipStartedAt: string | null
    offerScope: string | null
    favorite: boolean
    watchEnabled: boolean
    watchFamilies: string[]
    strategic: boolean
    archivedAt: string | null
    location: string | null
    tags: string[]
    primaryOwnerName: string | null
  }
  relationship: {
    score: number | null
    phase: 'growing' | 'stable' | 'declining' | 'unknown'
    phaseDelta: number | null
    confidence: number | null
    computedAt: string | null
    totalInteractions: number
    lastInteractionAt: string | null
    interactionFrequency30d: number | null
    contactCoverage: number | null
    decisionMakerCoverage: number | null
    concentrationRisk: number | null
    history: Array<{ score: number; computedAt: string }>
  }
  people: AccountPerson[]
  sources: Array<{
    provider: string
    label: string
    status: string
    lastSyncedAt: string | null
    interactionCount: number | null
    error: string | null
  }>
  recommendations: AccountRecommendation[]
  signals: AccountSignal[]
  memoryEntries: AccountMemoryEntry[]
  firmographics: AccountFirmographicFact[]
}
