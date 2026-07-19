// Mapping pur des lignes Supabase vers PersonDetailData.
// Aucune requête ici : tout est testable sans réseau.

import { signalTitle } from '../services/signal-labels'
import {
  MIN_BEHAVIOR_INTERACTIONS,
  type DataSourceReference,
  type PersonBehavioralInsight,
  type PersonCareerEntry,
  type PersonContactDetail,
  type PersonDetailData,
  type PersonEvidence,
  type PersonHistoryEvent,
  type PersonMemoryEntry,
  type PersonRecommendation,
  type PersonScorePoint,
  type PersonSignal,
  type PersonSourceStatus,
  type RelationshipPhase,
} from './types'

export type Row = Record<string, unknown>

export const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
export const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
export const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null
export const num = (value: unknown): number | null => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null
export const bool = (value: unknown): boolean => value === true

export function provenance(row: Row, defaults: Partial<DataSourceReference> = {}): DataSourceReference {
  return {
    sourceType: text(row.source_type) ?? defaults.sourceType ?? 'database',
    sourceId: text(row.source_id) ?? defaults.sourceId ?? null,
    sourceLabel: text(row.source_label) ?? defaults.sourceLabel ?? 'Donnée Tohu',
    sourceUrl: text(row.source_url) ?? defaults.sourceUrl ?? null,
    observedAt: text(row.observed_at) ?? defaults.observedAt ?? null,
    importedAt: text(row.imported_at) ?? defaults.importedAt ?? null,
    lastVerifiedAt: text(row.last_verified_at) ?? defaults.lastVerifiedAt ?? null,
    confidence: num(row.confidence) ?? defaults.confidence ?? null,
    inferenceLevel: (text(row.inference_level) ?? defaults.inferenceLevel ?? null) as DataSourceReference['inferenceLevel'],
  }
}

export function phaseValue(value: unknown): RelationshipPhase {
  return value === 'growing' || value === 'stable' || value === 'declining' ? value : 'unknown'
}

export function latestOf(list: Row[], dateKey: string): Row {
  return [...list].sort((a, b) => String(b[dateKey] ?? '').localeCompare(String(a[dateKey] ?? '')))[0] ?? {}
}

export function monthKey(value: string): string {
  return value.slice(0, 7)
}

/** Score historique : n'utilise que des lignes réellement persistées.
 *  Les tables héritées ont des shapes variables : on sonde les clés de score connues. */
export function legacyScore(row: Row): number | null {
  return num(row.score) ?? num(row.engagement_score) ?? num(row.nps) ?? num(row.nps_score) ?? num(row.relationship_score) ?? num(row.value)
}

export function legacyDate(row: Row): string | null {
  return text(row.snapshot_date) ?? text(row.computed_at) ?? text(row.captured_at) ?? text(row.created_at)
}

/** Agrège les snapshots par mois (dernier snapshot du mois), triés croissant. */
export function buildScoreHistory(canonical: Row[], legacy: Row[]): PersonScorePoint[] {
  const source = canonical.length ? canonical : legacy
  const byMonth = new Map<string, PersonScorePoint>()
  const sorted = [...source]
    .map((row) => ({ row, date: canonical.length ? text(row.computed_at) : legacyDate(row), score: canonical.length ? num(row.score) : legacyScore(row) }))
    .filter((item): item is { row: Row; date: string; score: number | null } => item.date !== null && item.score !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
  for (const item of sorted) {
    byMonth.set(monthKey(item.date), {
      monthKey: monthKey(item.date),
      score: item.score,
      phase: text(item.row.phase),
      interactionCount: num(item.row.total_interactions) ?? num(item.row.interaction_count),
      confidence: num(item.row.confidence),
    })
  }
  return [...byMonth.values()]
}

/** Fenêtre continue des n derniers mois se terminant au mois du dernier point (ou au mois courant). */
export function scoreWindow(history: PersonScorePoint[], months: number, now: Date): PersonScorePoint[] {
  const last = history.at(-1)?.monthKey ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const [yearRaw, monthRaw] = last.split('-').map(Number)
  const year = yearRaw ?? now.getUTCFullYear()
  const month = monthRaw ?? now.getUTCMonth() + 1
  const byKey = new Map(history.map((point) => [point.monthKey, point]))
  const result: PersonScorePoint[] = []
  for (let index = months - 1; index >= 0; index--) {
    const date = new Date(Date.UTC(year, month - 1 - index, 1))
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
    result.push(byKey.get(key) ?? { monthKey: key, score: null, phase: null, interactionCount: null, confidence: null })
  }
  return result
}

export function buildSignals(signalRows: Row[], feedback: Map<string, string | null>): PersonSignal[] {
  return signalRows.map((row) => {
    const verdict = feedback.get(String(row.id))
    return {
      id: String(row.id),
      type: text(row.signal_type) ?? 'signal',
      title: signalTitle(String(row.signal_type ?? ''), text(row.inference), text(row.text)),
      summary: text(row.text),
      validationStatus: verdict === 'confirmed' || verdict === 'dismissed' ? verdict : null,
      provenance: provenance(row, {
        sourceType: 'behavioral_signal',
        sourceId: String(row.id),
        sourceLabel: sourceTypeLabel(text(row.source_type)),
        observedAt: text(row.observed_at) ?? text(row.created_at),
        confidence: num(row.confidence),
        inferenceLevel: (text(row.inference_level) ?? 'observed') as DataSourceReference['inferenceLevel'],
      }),
    }
  })
}

export function sourceTypeLabel(sourceType: string | null): string {
  if (!sourceType) return 'Donnée Tohu'
  if (/gmail|google/i.test(sourceType)) return 'Gmail'
  if (/outlook|microsoft/i.test(sourceType)) return 'Outlook'
  if (/linkedin/i.test(sourceType)) return 'LinkedIn'
  if (/transcript|meeting|read/i.test(sourceType)) return 'Transcription'
  if (/manual|note/i.test(sourceType)) return 'Note interne'
  if (/email/i.test(sourceType)) return 'Emails'
  return sourceType
}

export function buildRecommendations(recRows: Row[]): PersonRecommendation[] {
  return recRows.map((row) => {
    const payload = object(row.payload)
    const list = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
    return {
      id: String(row.id),
      kind: row.kind === 'coaching' ? 'coaching' : 'action',
      category: text(row.category) ?? 'relationnel',
      actionType: text(row.action_type),
      priority: num(row.priority) ?? 0,
      title: text(row.title) ?? 'Recommandation à confirmer',
      justification: text(row.justification) ?? 'Justification indisponible.',
      recommendedAction: text(row.recommended_action),
      triggerSignal: text(row.trigger_signal),
      leanOn: list(payload.lean_on),
      avoid: list(payload.avoid),
      evolutions: rows(payload.evolutions).flatMap((item) => {
        const direction = item.direction === 'new' || item.direction === 'up' || item.direction === 'down' ? item.direction : null
        const content = text(item.text)
        return direction && content ? [{ direction, text: content }] : []
      }),
      dueAt: text(row.due_at),
      status: ['in_progress', 'completed', 'dismissed', 'postponed'].includes(String(row.status)) ? row.status as PersonRecommendation['status'] : 'open',
      feedbackType: row.feedback_type === 'useful' || row.feedback_type === 'incorrect' ? row.feedback_type : null,
      provenance: provenance(row, { sourceType: 'recommendation', sourceLabel: 'Moteur de recommandations Tohu' }),
    }
  })
}

export function buildInsights(profile: Row): PersonBehavioralInsight[] {
  return rows(profile.behavioral_analysis_data).flatMap((item, index) => {
    const trait = text(item.trait)
    const observation = text(item.observation)
    if (!trait && !observation) return []
    return [{
      id: `insight-${index}`,
      trait: trait ?? 'Observation',
      observation: observation ?? '',
      confidence: num(item.confidence),
      provenance: {
        sourceType: 'cognitive_profile',
        sourceId: text(profile.id),
        sourceLabel: Array.isArray(profile.updated_from) ? profile.updated_from.map(String).map(sourceTypeLabel).join(' + ') : 'Analyse des échanges',
        sourceUrl: null,
        observedAt: text(profile.updated_at),
        importedAt: null,
        lastVerifiedAt: null,
        confidence: num(item.confidence),
        inferenceLevel: 'inferred',
      },
    }]
  })
}

export function buildEvidences(signalRows: Row[]): PersonEvidence[] {
  return signalRows.flatMap((row) => {
    const content = text(row.text)
    if (!content) return []
    return [{
      id: String(row.id),
      trait: text(row.inference) ?? text(row.signal_type),
      text: content,
      sourceLabel: sourceTypeLabel(text(row.source_type)),
      observedAt: text(row.observed_at),
      confidence: num(row.confidence),
      inferenceLevel: text(row.inference_level),
    }]
  })
}

export function buildContactDetails(detailRows: Row[], contact: Row): PersonContactDetail[] {
  const persisted: PersonContactDetail[] = detailRows.filter((row) => !row.archived_at).map((row) => ({
    id: String(row.id),
    type: (['email', 'phone', 'linkedin', 'website'].includes(String(row.detail_type)) ? row.detail_type : 'other') as PersonContactDetail['type'],
    value: text(row.value) ?? '',
    label: text(row.label),
    primary: bool(row.is_primary),
    verificationStatus: (['verified', 'invalid'].includes(String(row.verification_status)) ? row.verification_status : 'unverified') as PersonContactDetail['verificationStatus'],
    visibility: row.visibility === 'private' ? 'private' : 'workspace',
    provenance: provenance(row, { sourceType: 'manual', sourceLabel: 'Coordonnée vérifiée' }),
  }))
  // Coordonnées héritées de la base contacts : réelles mais non vérifiées.
  const enrichment = object(contact.enrichment_data)
  const legacy: PersonContactDetail[] = []
  const email = text(contact.email)
  if (email && !persisted.some((detail) => detail.type === 'email' && detail.value.toLowerCase() === email.toLowerCase())) {
    legacy.push({ id: 'legacy-email', type: 'email', value: email, label: null, primary: !persisted.some((detail) => detail.type === 'email' && detail.primary), verificationStatus: 'unverified', visibility: 'workspace', provenance: { sourceType: 'crm', sourceId: null, sourceLabel: 'Base contacts Tohu', sourceUrl: null, observedAt: text(contact.updated_at), importedAt: null, lastVerifiedAt: null, confidence: null, inferenceLevel: 'observed' } })
  }
  const phone = text(enrichment.phone)
  if (phone && !persisted.some((detail) => detail.type === 'phone' && detail.value === phone)) {
    legacy.push({ id: 'legacy-phone', type: 'phone', value: phone, label: null, primary: !persisted.some((detail) => detail.type === 'phone' && detail.primary), verificationStatus: 'unverified', visibility: 'workspace', provenance: { sourceType: 'crm', sourceId: null, sourceLabel: 'Base contacts Tohu', sourceUrl: null, observedAt: text(contact.updated_at), importedAt: null, lastVerifiedAt: null, confidence: null, inferenceLevel: 'observed' } })
  }
  return [...persisted, ...legacy]
}

/** contact_career_path (héritée) → shape person_career_entries, statut « probable ». */
export function legacyCareerRows(rows_: Row[]): Row[] {
  return rows_.map((row) => ({
    id: String(row.id),
    entry_type: 'experience',
    title: row.job_title,
    organization_name: row.company_name,
    started_at: row.start_date,
    ended_at: row.end_date,
    is_current: row.is_current,
    description: row.sector,
    verification_status: 'probable',
    source_type: 'import',
    source_label: 'Parcours importé',
    inference_level: 'observed',
    observed_at: row.created_at,
  }))
}

export function buildCareerEntries(careerRows: Row[]): PersonCareerEntry[] {
  return careerRows.map((row) => ({
    id: String(row.id),
    entryType: (['education', 'detected_change'].includes(String(row.entry_type)) ? row.entry_type : 'experience') as PersonCareerEntry['entryType'],
    title: text(row.title) ?? 'Poste à confirmer',
    organizationName: text(row.organization_name) ?? 'Organisation à confirmer',
    accountId: text(row.company_id),
    location: text(row.location),
    startedAt: text(row.started_at),
    endedAt: text(row.ended_at),
    current: bool(row.is_current),
    description: text(row.description),
    verificationStatus: (['confirmed', 'probable', 'rejected'].includes(String(row.verification_status)) ? row.verification_status : 'to_confirm') as PersonCareerEntry['verificationStatus'],
    provenance: provenance(row),
  })).sort((a, b) => Number(b.current) - Number(a.current) || String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')))
}

export function buildMemoryEntries(memoryRows: Row[], profileNames: Map<string, string>): PersonMemoryEntry[] {
  return memoryRows.map((row) => ({
    id: String(row.id),
    entryType: text(row.entry_type) ?? 'note',
    content: text(row.content) ?? '',
    fileName: text(row.file_name),
    filePath: text(row.file_path),
    transcription: text(row.transcription),
    processingStatus: text(row.processing_status) ?? 'ready',
    authorName: profileNames.get(String(row.author_user_id)) ?? 'Membre Tohu',
    visibility: text(row.visibility) ?? 'workspace',
    createdAt: text(row.created_at) ?? new Date().toISOString(),
  }))
}

export function buildSources(connectorRows: Row[], counts: Map<string, number>): PersonSourceStatus[] {
  const labels: Record<string, string> = { google: 'Gmail', microsoft: 'Outlook', linkedin: 'LinkedIn' }
  return connectorRows.map((row) => {
    const provider = text(row.provider) ?? 'source'
    return {
      provider,
      label: labels[provider] ?? provider,
      status: text(row.status) ?? 'disconnected',
      lastSyncedAt: text(row.last_synced_at),
      interactionCount: counts.get(provider) ?? null,
      error: text(object(row.metadata).last_error),
    }
  }).filter((source) => source.status !== 'not_connected' || (source.interactionCount ?? 0) > 0)
}

export function buildHistory(meetingRows: Row[], messageRows: Row[], signals: PersonSignal[], memory: PersonMemoryEntry[], career: PersonCareerEntry[]): PersonHistoryEvent[] {
  const events: PersonHistoryEvent[] = []
  for (const meeting of meetingRows) {
    const date = text(meeting.starts_at)
    if (!date) continue
    events.push({ id: `meeting-${String(meeting.id)}`, type: 'meeting', title: text(meeting.title) ?? 'Réunion', description: text(meeting.meeting_type), occurredAt: date, sourceLabel: text(meeting.platform) ?? 'Agenda' })
  }
  for (const message of messageRows) {
    const date = text(message.sent_at)
    if (!date) continue
    events.push({ id: `message-${String(message.id)}`, type: 'email', title: text(message.subject) ?? (message.direction === 'outbound' ? 'Email envoyé' : 'Email reçu'), description: message.direction === 'outbound' ? 'Email envoyé' : 'Email reçu', occurredAt: date, sourceLabel: sourceTypeLabel(text(message.provider)) })
  }
  for (const signal of signals) {
    if (!signal.provenance.observedAt) continue
    events.push({ id: `signal-${signal.id}`, type: 'signal', title: signal.title, description: signal.summary, occurredAt: signal.provenance.observedAt, sourceLabel: signal.provenance.sourceLabel })
  }
  for (const entry of memory) {
    events.push({ id: `memory-${entry.id}`, type: 'note', title: entry.entryType === 'note' ? 'Note ajoutée' : `Mémoire · ${entry.entryType}`, description: entry.content.slice(0, 140) || entry.fileName, occurredAt: entry.createdAt, sourceLabel: entry.authorName })
  }
  for (const entry of career) {
    if (!entry.startedAt) continue
    events.push({ id: `career-${entry.id}`, type: 'career', title: `${entry.title} · ${entry.organizationName}`, description: entry.verificationStatus === 'to_confirm' ? 'Changement détecté — à confirmer' : null, occurredAt: entry.startedAt, sourceLabel: entry.provenance.sourceLabel })
  }
  return events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
}

export type PersonDetailRaw = {
  workspaceId: string
  personId: string
  userId: string
  contact: Row
  company: Row
  settings: Row
  userSettings: Row
  summaryRow: Row
  scoreSnapshots: Row[]
  legacyScores: Row[]
  legacyCareer: Row[]
  relationshipSnapshots: Row[]
  cognitiveProfile: Row
  behavioralSignals: Row[]
  recommendations: Row[]
  contactDetails: Row[]
  careerEntries: Row[]
  memoryEntries: Row[]
  meetings: Row[]
  messages: Row[]
  connectors: Row[]
  feedback: Row[]
  profileNames: Map<string, string>
  degradedReasons: string[]
}

export function buildPersonDetail(raw: PersonDetailRaw): PersonDetailData {
  const { contact, company, settings, userSettings, cognitiveProfile } = raw
  const feedback = new Map(raw.feedback.map((row) => [String(row.signal_id), text(row.verdict)]))
  const signals = buildSignals(raw.behavioralSignals, feedback)
  const memoryEntries = buildMemoryEntries(raw.memoryEntries, raw.profileNames)
  const careerEntries = buildCareerEntries(raw.careerEntries.length ? raw.careerEntries : legacyCareerRows(raw.legacyCareer))

  const canonical = [...raw.scoreSnapshots].sort((a, b) => String(a.computed_at ?? '').localeCompare(String(b.computed_at ?? '')))
  const latestSnapshot = canonical.at(-1) ?? {}
  const relationshipSnapshot = latestOf(raw.relationshipSnapshots, 'snapshot_date')
  // Historique hérité réel : contact_score_history porte score + phase + dimensions par contact.
  const latestHistory = latestOf(raw.legacyScores, 'snapshot_date')
  const legacyHistory = raw.legacyScores.length ? raw.legacyScores : raw.relationshipSnapshots
  const scoreHistory = buildScoreHistory(canonical, legacyHistory)

  const meetingDates = raw.meetings.map((row) => text(row.starts_at)).filter((value): value is string => value !== null)
  const messageDates = raw.messages.map((row) => text(row.sent_at)).filter((value): value is string => value !== null)
  const allDates = [...meetingDates, ...messageDates].sort()
  const score = num(latestSnapshot.score) ?? num(latestHistory.score) ?? num(relationshipSnapshot.engagement_score) ?? num(cognitiveProfile.engagement_score)
  const analyzedInteractions = num(cognitiveProfile.source_message_count) ?? raw.behavioralSignals.length

  const providerCounts = new Map<string, number>()
  for (const message of raw.messages) {
    const provider = text(message.provider)
    if (provider) providerCounts.set(provider, (providerCounts.get(provider) ?? 0) + 1)
  }

  const summaryText = text(raw.summaryRow.content)
  const executiveSummary = text(cognitiveProfile.executive_summary) ?? text(cognitiveProfile.summary)

  return {
    generatedAt: new Date().toISOString(),
    degradedReasons: raw.degradedReasons,
    person: {
      id: raw.personId,
      workspaceId: raw.workspaceId,
      fullName: text(contact.full_name) ?? 'Contact',
      avatarUrl: text(contact.avatar_url),
      jobTitle: text(contact.role_title),
      location: text(contact.location),
      biography: text(contact.web_bio),
      relationshipType: text(settings.relationship_type),
      decisionRole: text(settings.decision_role),
      relationshipRole: text(settings.relationship_role),
      favorite: bool(userSettings.favorite),
      watchEnabled: bool(userSettings.watch_enabled),
      archivedAt: text(settings.archived_at),
      primaryOwnerName: raw.profileNames.get(String(settings.primary_owner_user_id)) ?? raw.profileNames.get(String(contact.owner_user_id)) ?? null,
      createdAt: text(contact.created_at),
      updatedAt: text(contact.updated_at),
    },
    summary: summaryText
      ? { text: summaryText, confidence: num(raw.summaryRow.confidence), generatedAt: text(raw.summaryRow.generated_at), provenance: provenance(raw.summaryRow, { sourceType: 'summary', sourceLabel: 'Synthèse Tohu', inferenceLevel: 'inferred' }) }
      : executiveSummary
        ? { text: executiveSummary, confidence: num(cognitiveProfile.global_confidence), generatedAt: text(cognitiveProfile.updated_at), provenance: { sourceType: 'cognitive_profile', sourceId: text(cognitiveProfile.id), sourceLabel: 'Analyse des échanges · Inféré', sourceUrl: null, observedAt: text(cognitiveProfile.updated_at), importedAt: null, lastVerifiedAt: null, confidence: num(cognitiveProfile.global_confidence), inferenceLevel: 'inferred' } }
        : null,
    employment: text(company.id)
      ? { accountId: String(company.id), accountName: text(company.name) ?? 'Compte', accountLogoUrl: text(object(company.public_context).logo_url), jobTitle: text(contact.role_title), sector: text(company.industry) }
      : null,
    relationship: {
      score,
      phase: phaseValue(text(latestSnapshot.phase) ?? text(latestHistory.phase) ?? text(relationshipSnapshot.phase) ?? text(cognitiveProfile.score_phase)),
      phaseDelta: num(latestSnapshot.phase_delta) ?? num(cognitiveProfile.score_delta) ?? scoreDelta(scoreHistory),
      confidence: num(latestSnapshot.confidence) ?? num(cognitiveProfile.global_confidence),
      computedAt: text(latestSnapshot.computed_at) ?? text(latestHistory.snapshot_date) ?? text(relationshipSnapshot.snapshot_date),
      totalInteractions: raw.meetings.length + raw.messages.length,
      emailInteractions: raw.messages.length,
      meetingInteractions: raw.meetings.length,
      firstInteractionAt: allDates[0] ?? null,
      lastInteractionAt: allDates.at(-1) ?? text(relationshipSnapshot.last_contact_at),
      dimensions: {
        intensity: num(latestSnapshot.intensity_score) ?? num(latestHistory.score_intensite) ?? num(cognitiveProfile.score_intensite),
        reciprocity: num(latestSnapshot.reciprocity_score) ?? num(latestHistory.score_reciprocite) ?? num(cognitiveProfile.score_reciprocite),
        longevity: num(latestSnapshot.recency_score) ?? num(latestHistory.score_longevite) ?? num(cognitiveProfile.score_longevite),
      },
    },
    scoreHistory,
    behavior: {
      executiveSummary,
      globalConfidence: num(cognitiveProfile.global_confidence),
      cognitiveMode: text(cognitiveProfile.cognitive_mode),
      analyzedInteractions,
      minimumInteractions: MIN_BEHAVIOR_INTERACTIONS,
      insights: buildInsights(cognitiveProfile),
      evidences: buildEvidences(raw.behavioralSignals),
      updatedAt: text(cognitiveProfile.updated_at),
    },
    sources: buildSources(raw.connectors, providerCounts),
    recommendations: buildRecommendations(raw.recommendations),
    signals,
    contactDetails: buildContactDetails(raw.contactDetails, contact),
    careerEntries,
    memoryEntries,
    history: buildHistory(raw.meetings, raw.messages, signals, memoryEntries, careerEntries),
  }
}

export function scoreDelta(history: PersonScorePoint[]): number | null {
  const scored = history.filter((point) => point.score !== null)
  if (scored.length < 2) return null
  return (scored.at(-1)!.score ?? 0) - (scored.at(-2)!.score ?? 0)
}
