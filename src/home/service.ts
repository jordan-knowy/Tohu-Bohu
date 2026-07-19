/**
 * Service unique d'agrégation de la Home (mission §11).
 *
 * `getHomeDashboard()` fait un seul passage de requêtes parallèles (pas de
 * cascade, pas de N+1), toutes scoping par les RLS du workspace actif.
 *
 * Mode dégradé : si des objets SQL de `202607150009_home_foundation.sql` /
 * `202607150010_home_rpcs.sql` manquent (migration non appliquée), le service
 * renseigne `degraded` + `degradedReasons` et les fonctionnalités concernées
 * sont désactivées côté UI — jamais simulées.
 */

import { getSupabase } from '../lib/supabase'
import {
  aggregateGlobalScore,
  atRiskAccounts,
  bestAccounts,
  buildDigest,
  daysSince,
  deriveActions,
  type ScoredAccount,
} from './priority'
import type {
  HomeAccountCandidate,
  HomeCoachingData,
  HomeDashboardData,
  HomeSignal,
  HomeSourceStatus,
  HomeSyncJob,
  HomeTeamMember,
} from './types'
import { relationLevel } from './types'
import { signalTitle } from '../services/signal-labels'

type DbRow = Record<string, unknown>

function record(value: unknown): DbRow {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as DbRow
  return {}
}

function rows(value: unknown): DbRow[] {
  return Array.isArray(value) ? value.map(record) : []
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Erreurs PostgREST signalant un objet SQL manquant (migration non appliquée). */
function isMissingSchemaError(error: unknown): boolean {
  const code = String(record(error).code ?? '')
  const message = String(record(error).message ?? '')
  return ['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(code)
    || /does not exist|could not find|schema cache/i.test(message)
}

/**
 * Distingue une RPC réellement absente d'une erreur SQL survenue à
 * l'intérieur d'une RPC existante. Sans cette distinction, une colonne
 * manquante ou une autre erreur PostgREST pouvait afficher à tort
 * « migration non appliquée ».
 */
export function isMissingRpcError(error: unknown, rpcName: string): boolean {
  const details = record(error)
  const code = String(details.code ?? '')
  const text = [details.message, details.details, details.hint]
    .map((value) => String(value ?? ''))
    .join(' ')
    .toLowerCase()
  const normalizedName = rpcName.toLowerCase()

  if (code === 'PGRST202') return text.includes(normalizedName)
  if (code === '42883') return text.includes(normalizedName) && /does not exist|could not find/.test(text)
  return false
}

function supabaseErrorMessage(error: unknown, fallback: string): string {
  const details = record(error)
  return String(details.message ?? details.details ?? fallback)
}

async function safeQuery<T>(promise: PromiseLike<{ data: T | null; error: unknown }>, missing: string, degradedReasons: string[]): Promise<T | null> {
  const { data, error } = await promise
  if (error) {
    if (isMissingSchemaError(error)) {
      degradedReasons.push(missing)
      return null
    }
    throw Object.assign(new Error(String(record(error).message ?? 'Requête Supabase impossible')), { cause: error })
  }
  return data
}

async function safeCount(promise: PromiseLike<{ count: number | null; error: unknown }>, missing: string, degradedReasons: string[]): Promise<number | null> {
  const { count, error } = await promise
  if (error) {
    if (isMissingSchemaError(error)) {
      degradedReasons.push(missing)
      return null
    }
    throw Object.assign(new Error(String(record(error).message ?? 'Comptage Supabase impossible')), { cause: error })
  }
  return count
}

export function normalizeSyncJobStatus(value: unknown): HomeSyncJob['status'] {
  const rawStatus = String(value)
  const normalizedStatus = rawStatus === 'succeeded' ? 'completed' : rawStatus
  return (['queued', 'running', 'completed', 'failed'].includes(normalizedStatus) ? normalizedStatus : 'failed') as HomeSyncJob['status']
}

function mapJob(row: DbRow): HomeSyncJob {
  return {
    id: String(row.id),
    jobType: String(row.job_type ?? ''),
    status: normalizeSyncJobStatus(row.status),
    currentStep: str(row.current_step),
    progress: num(row.progress),
    provider: str(row.provider),
    startedAt: str(row.started_at),
    completedAt: str(row.completed_at),
    errorMessage: str(row.error_message),
    payload: record(row.payload),
  }
}

type SnapshotRow = { engagement_score: number | null; phase: string | null; snapshot_date: string | null; last_contact_at: string | null }

function contactSnapshots(row: DbRow): SnapshotRow[] {
  const snapshots = rows(row.relationship_snapshots)
    .map((snapshot) => ({
      engagement_score: num(snapshot.engagement_score),
      phase: str(snapshot.phase),
      snapshot_date: str(snapshot.snapshot_date),
      last_contact_at: str(snapshot.last_contact_at),
    }))
    .sort((a, b) => String(b.snapshot_date ?? '').localeCompare(String(a.snapshot_date ?? '')))
  if (snapshots.length) return snapshots
  // Repli sur le score persisté du moteur (cognitive_profiles) quand aucun
  // snapshot relationnel n'existe — toujours une valeur calculée backend.
  return rows(row.cognitive_profiles)
    .map((profile) => ({
      engagement_score: num(profile.engagement_score),
      phase: str(profile.score_phase),
      snapshot_date: str(profile.updated_at)?.slice(0, 10) ?? null,
      last_contact_at: null,
    }))
    .filter((profile) => profile.engagement_score !== null)
    .sort((a, b) => String(b.snapshot_date ?? '').localeCompare(String(a.snapshot_date ?? '')))
}

/**
 * Construit les comptes « scorables » : score persisté du compte
 * (public_context.relationship_score) ou, à défaut, moyenne des derniers
 * engagement_score persistés de ses contacts — jamais de formule nouvelle.
 */
export function buildScoredAccounts(companies: DbRow[], contacts: DbRow[], trackingColumnAvailable: boolean, now: Date): ScoredAccount[] {
  const byCompany = new Map<string, DbRow[]>()
  for (const contact of contacts) {
    const companyId = str(contact.company_id)
    if (!companyId) continue
    byCompany.set(companyId, [...(byCompany.get(companyId) ?? []), contact])
  }
  return companies.map((company) => {
    const context = record(company.public_context)
    const linked = byCompany.get(String(company.id)) ?? []
    const latestScores: number[] = []
    const previousScores: number[] = []
    let lastContactAt = str(context.last_interaction_at) ?? str(company.last_monitored_at)
    let phase: string | null = null
    for (const contact of linked) {
      const snapshots = contactSnapshots(contact)
      const latest = snapshots[0]
      if (!latest) continue
      if (latest.engagement_score !== null) latestScores.push(latest.engagement_score)
      if (latest.phase) phase ??= latest.phase
      if (latest.last_contact_at && (!lastContactAt || latest.last_contact_at > lastContactAt)) lastContactAt = latest.last_contact_at
      const previous = snapshots.find((snapshot) => {
        const age = daysSince(snapshot.snapshot_date, now)
        return age !== null && age >= 25
      })
      if (latest.engagement_score !== null && previous?.engagement_score != null) {
        previousScores.push(latest.engagement_score - previous.engagement_score)
      }
    }
    const ownScore = num(context.relationship_score)
    const contactAverage = latestScores.length ? Math.round(latestScores.reduce((sum, value) => sum + value, 0) / latestScores.length) : null
    return {
      id: String(company.id),
      name: String(company.name ?? 'Compte'),
      industry: str(company.industry),
      score: ownScore ?? contactAverage,
      confidence: num(context.confidence_score ?? company.account_type_confidence),
      lastInteractionAt: lastContactAt,
      contactCount: linked.length,
      phase,
      delta30d: previousScores.length ? Math.round(previousScores.reduce((sum, value) => sum + value, 0) / previousScores.length) : null,
      tracked: trackingColumnAvailable ? company.is_tracked === true : true,
    }
  })
}

/** Vue d'équipe : agrège uniquement des membres, contacts et snapshots persistés. */
export function buildTeamMembers(memberships: DbRow[], profiles: DbRow[], contacts: DbRow[], now: Date): HomeTeamMember[] {
  const profileById = new Map(profiles.map((profile) => [String(profile.id), profile]))
  return memberships.flatMap((membership) => {
    const userId = str(membership.user_id)
    const profile = userId ? profileById.get(userId) : null
    if (!userId || !profile) return []
    const owned = contacts.filter((contact) => str(contact.owner_user_id) === userId)
    const scores: number[] = []
    const deltas: number[] = []
    for (const contact of owned) {
      const snapshots = contactSnapshots(contact)
      const latest = snapshots[0]
      if (latest?.engagement_score !== null && latest?.engagement_score !== undefined) scores.push(latest.engagement_score)
      const previous = snapshots.find((snapshot) => {
        const age = daysSince(snapshot.snapshot_date, now)
        return age !== null && age >= 25
      })
      if (latest?.engagement_score !== null && latest?.engagement_score !== undefined && previous?.engagement_score !== null && previous?.engagement_score !== undefined) {
        deltas.push(latest.engagement_score - previous.engagement_score)
      }
    }
    const accountIds = new Set(owned.map((contact) => str(contact.company_id)).filter((value): value is string => value !== null))
    return [{
      userId,
      fullName: str(profile.full_name) ?? 'Membre de l’équipe',
      avatarUrl: str(profile.avatar_url),
      accounts: accountIds.size,
      contacts: owned.length,
      score: scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : null,
      delta30d: deltas.length ? Math.round(deltas.reduce((sum, value) => sum + value, 0) / deltas.length) : null,
    }]
  }).sort((a, b) => b.accounts - a.accounts || b.contacts - a.contacts || a.fullName.localeCompare(b.fullName))
}

function mapCompanySignal(row: DbRow, feedback: Map<string, 'confirmed' | 'dismissed'>): HomeSignal {
  const company = record(row.companies)
  return {
    id: String(row.id),
    kind: 'company',
    signalType: String(row.family ?? 'signal'),
    title: String(row.title ?? 'Signal entreprise'),
    summary: str(row.summary),
    accountId: str(row.company_id),
    accountName: str(company.name),
    personId: null,
    personName: null,
    source: str(row.source) ?? 'Veille entreprise',
    observedAt: str(row.observed_at) ?? str(row.created_at) ?? new Date(0).toISOString(),
    confidence: num(row.confidence),
    inferenceLevel: str(row.inference_level),
    userVerdict: feedback.get(String(row.id)) ?? null,
  }
}

function mapBehavioralSignal(row: DbRow, feedback: Map<string, 'confirmed' | 'dismissed'>, companyNames: Map<string, string>): HomeSignal {
  const contact = record(row.contacts)
  const companyId = str(contact.company_id)
  return {
    id: String(row.id),
    kind: 'behavioral',
    signalType: String(row.signal_type ?? 'signal'),
    title: signalTitle(row.signal_type, row.inference, row.text),
    summary: str(row.text),
    accountId: companyId,
    accountName: companyId ? companyNames.get(companyId) ?? null : null,
    personId: str(row.contact_id),
    personName: str(contact.full_name),
    source: str(row.source_type) ?? 'Analyse comportementale',
    observedAt: str(row.observed_at) ?? str(row.created_at) ?? new Date(0).toISOString(),
    confidence: num(row.confidence),
    inferenceLevel: str(row.inference_level),
    userVerdict: feedback.get(String(row.id)) ?? null,
  }
}

const PROVIDER_LABELS: Record<string, string> = { google: 'Google Workspace', microsoft: 'Microsoft 365', linkedin: 'LinkedIn' }

/**
 * Couverture des sources — dérivée des connecteurs réellement présents.
 * Mail et Calendrier partagent le connecteur Google/Microsoft : Calendrier est
 * « partiel » si le scope calendrier n'a pas été accordé.
 */
export function buildSources(connectors: DbRow[]): HomeSourceStatus[] {
  const sources: HomeSourceStatus[] = []
  const status = (value: unknown): HomeSourceStatus['status'] => {
    const raw = String(value ?? '')
    if (raw === 'connected') return 'connected'
    if (['error', 'expired', 'needs_reauth'].includes(raw)) return 'error'
    return 'disconnected'
  }
  for (const provider of ['google', 'microsoft'] as const) {
    const row = connectors.find((item) => item.provider === provider)
    if (!row) continue
    const metadata = record(row.metadata)
    const scopes = Array.isArray(row.scopes) ? row.scopes.map(String) : []
    const base = status(row.status)
    const hasCalendar = scopes.some((scope) => /calendar/i.test(scope))
    sources.push({
      provider: `${provider}:mail`,
      label: `Mail · ${PROVIDER_LABELS[provider]}`,
      status: base,
      lastSyncedAt: str(row.last_synced_at),
      accountEmail: str(metadata.account_email),
    })
    sources.push({
      provider: `${provider}:calendar`,
      label: `Calendrier · ${PROVIDER_LABELS[provider]}`,
      status: base === 'connected' && !hasCalendar ? 'partial' : base,
      lastSyncedAt: str(row.last_synced_at),
      accountEmail: str(metadata.account_email),
    })
  }
  const linkedin = connectors.find((item) => item.provider === 'linkedin')
  if (linkedin) {
    sources.push({
      provider: 'linkedin',
      label: 'LinkedIn',
      status: status(linkedin.status),
      lastSyncedAt: str(linkedin.last_synced_at),
      accountEmail: null,
    })
  }
  return sources
}

export async function getHomeDashboard(organizationId: string, userId: string): Promise<HomeDashboardData> {
  const client = getSupabase()
  const degradedReasons: string[] = []
  const now = new Date()
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)

  const [companiesData, contactsData, connectorsData, subscriptionData, companySignalsData, behavioralSignalsData, profileData, feedbackData, behaviorProfileData, actionStatesData, jobsData, insightFeedbackData, membershipsData, exchangesCount, companySignalsToday, behavioralSignalsToday] = await Promise.all([
    safeQuery<DbRow[]>(client.from('companies').select('*').eq('organization_id', organizationId).order('updated_at', { ascending: false }).limit(500), 'table companies', degradedReasons),
    safeQuery<DbRow[]>(client.from('contacts').select('id,company_id,owner_user_id,full_name,created_at,relationship_snapshots(engagement_score,phase,snapshot_date,last_contact_at),cognitive_profiles(engagement_score,score_phase,updated_at)').eq('organization_id', organizationId).is('merged_into_contact_id', null).limit(1000), 'table contacts', degradedReasons),
    safeQuery<DbRow[]>(client.from('connectors').select('*').eq('organization_id', organizationId).eq('user_id', userId), 'table connectors', degradedReasons),
    safeQuery<DbRow>(client.from('subscriptions').select('*').eq('organization_id', organizationId).maybeSingle(), 'table subscriptions', degradedReasons),
    safeQuery<DbRow[]>(client.from('company_signals').select('*,companies(id,name)').eq('organization_id', organizationId).order('observed_at', { ascending: false }).limit(30), 'table company_signals', degradedReasons),
    safeQuery<DbRow[]>(client.from('behavioral_signals').select('*,contacts(id,full_name,company_id)').eq('organization_id', organizationId).order('observed_at', { ascending: false }).limit(30), 'table behavioral_signals', degradedReasons),
    safeQuery<DbRow>(client.from('profiles').select('*').eq('id', userId).single(), 'table profiles', degradedReasons),
    safeQuery<DbRow[]>(client.from('signal_feedback').select('signal_id,verdict').eq('organization_id', organizationId).eq('user_id', userId).limit(500), 'table signal_feedback', degradedReasons),
    safeQuery<DbRow>(client.from('user_behavioral_profiles').select('*').eq('user_id', userId).eq('organization_id', organizationId).maybeSingle(), 'table user_behavioral_profiles', degradedReasons),
    safeQuery<DbRow[]>(client.from('home_action_states').select('*').eq('user_id', userId).eq('organization_id', organizationId).limit(500), 'table home_action_states (migration 202607150009)', degradedReasons),
    safeQuery<DbRow[]>(client.from('sync_jobs').select('*').eq('organization_id', organizationId).eq('user_id', userId).in('job_type', ['account_detection', 'account_analysis']).order('started_at', { ascending: false }).limit(5), 'lecture sync_jobs (migration 202607150009)', degradedReasons),
    safeQuery<DbRow[]>(client.from('insight_feedback').select('insight_id,feedback_type').eq('organization_id', organizationId).eq('user_id', userId).limit(100), 'table insight_feedback (migration 202607150009)', degradedReasons),
    safeQuery<DbRow[]>(client.from('memberships').select('user_id').eq('organization_id', organizationId).limit(100), 'table memberships', degradedReasons),
    safeCount(client.from('communication_messages').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId), 'comptage communication_messages', degradedReasons),
    safeCount(client.from('company_signals').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).gte('observed_at', startOfToday.toISOString()), 'comptage company_signals', degradedReasons),
    safeCount(client.from('behavioral_signals').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).gte('observed_at', startOfToday.toISOString()), 'comptage behavioral_signals', degradedReasons),
  ])

  if (!companiesData || !contactsData || !connectorsData) {
    throw new Error('Impossible de charger le portefeuille (comptes, personnes ou connecteurs).')
  }

  const companies = rows(companiesData)
  const contacts = rows(contactsData)
  const connectors = rows(connectorsData)
  const memberships = rows(membershipsData)
  const memberIds = [...new Set(memberships.map((membership) => str(membership.user_id)).filter((value): value is string => value !== null))]
  const memberProfilesData = memberIds.length
    ? await safeQuery<DbRow[]>(client.from('profiles').select('id,full_name,avatar_url').in('id', memberIds), 'lecture des profils d’équipe', degradedReasons)
    : []
  const memberProfiles = rows(memberProfilesData)
  if (profileData && !memberProfiles.some((member) => String(member.id) === userId)) memberProfiles.push(record(profileData))
  const teamMembers = buildTeamMembers(memberships, memberProfiles, contacts, now)
  const trackingColumnAvailable = companies.length > 0 ? 'is_tracked' in (companies[0] ?? {}) : !degradedReasons.length
  if (companies.length > 0 && !trackingColumnAvailable) degradedReasons.push('colonne companies.is_tracked (migration 202607150009)')

  const scoredAccounts = buildScoredAccounts(companies, contacts, trackingColumnAvailable, now)
  const tracked = scoredAccounts.filter((account) => account.tracked)

  // Forfait — la limite vient de subscription_plans.max_tracked_accounts.
  const subscription = record(subscriptionData)
  const planId = str(subscription.plan_id) ?? 'free'
  let accountLimit: number | null = null
  let limitConfigured = false
  const planRow = await safeQuery<DbRow>(client.from('subscription_plans').select('*').eq('id', planId).maybeSingle(), 'table subscription_plans', degradedReasons)
  if (planRow && 'max_tracked_accounts' in planRow) {
    limitConfigured = true
    accountLimit = num(planRow.max_tracked_accounts)
  } else if (planRow) {
    degradedReasons.push('colonne subscription_plans.max_tracked_accounts (migration 202607150009)')
  }

  const feedback = new Map<string, 'confirmed' | 'dismissed'>()
  for (const row of rows(feedbackData)) {
    const verdict = String(row.verdict)
    if (verdict === 'confirmed' || verdict === 'dismissed') feedback.set(String(row.signal_id), verdict)
  }
  const companyNames = new Map(companies.map((company) => [String(company.id), String(company.name ?? 'Compte')]))
  const signals: HomeSignal[] = [
    ...rows(companySignalsData).map((row) => mapCompanySignal(row, feedback)),
    ...rows(behavioralSignalsData).map((row) => mapBehavioralSignal(row, feedback, companyNames)),
  ].sort((a, b) => b.observedAt.localeCompare(a.observedAt)).slice(0, 12)

  // Actions du jour : dérivées de faits persistés, filtrées par l'état utilisateur.
  const actionStates = new Map<string, DbRow>()
  for (const row of rows(actionStatesData)) actionStates.set(String(row.action_id), row)
  const allActions = deriveActions(scoredAccounts, signals, now)
  const priorityActions = allActions.filter((action) => {
    const state = actionStates.get(action.actionId)
    if (!state) return true
    const status = String(state.status)
    if (status === 'completed' || status === 'dismissed') return false
    if (status === 'postponed') {
      const until = str(state.postponed_until)
      return !until || new Date(until).getTime() <= now.getTime()
    }
    return true
  }).slice(0, 6)
  const overdueActions = rows(actionStatesData).filter((row) => {
    const until = str(row.postponed_until)
    return String(row.status) === 'postponed' && until !== null && new Date(until).getTime() <= now.getTime()
  }).length

  const profile = record(profileData)
  const lastHomeSeenAt = 'last_home_seen_at' in profile ? str(profile.last_home_seen_at) : null
  if (profileData && !('last_home_seen_at' in profile)) degradedReasons.push('colonne profiles.last_home_seen_at (migration 202607150009)')
  const digest = buildDigest({
    since: lastHomeSeenAt,
    signals,
    accounts: scoredAccounts,
    peopleCreatedAt: contacts.map((contact) => str(contact.created_at) ?? '').filter(Boolean),
    now,
  })
  if (digest) digest.overdueActions = overdueActions

  const aggregate = aggregateGlobalScore(scoredAccounts)
  const snapshotDates = contacts.flatMap((contact) => rows(contact.relationship_snapshots).map((snapshot) => str(snapshot.snapshot_date) ?? '')).filter(Boolean).sort()
  const accountDeltas = tracked.map((account) => account.delta30d).filter((value): value is number => value !== null)

  const behaviorProfile = record(behaviorProfileData)
  const insightFeedback = new Map(rows(insightFeedbackData).map((row) => [String(row.insight_id), String(row.feedback_type)]))
  let coaching: HomeCoachingData | null = null
  if (behaviorProfileData) {
    const insightId = `ubp:${userId}:${str(behaviorProfile.updated_at) ?? 'initial'}`
    const rawFeedback = insightFeedback.get(insightId)
    coaching = {
      level: null,
      calibrating: true,
      executiveSummary: str(behaviorProfile.executive_summary),
      cognitiveMode: str(behaviorProfile.cognitive_mode),
      traits: rows(behaviorProfile.behavioral_analysis_data).map((item) => ({
        trait: str(item.trait) ?? 'Signal comportemental',
        observation: str(item.observation) ?? '',
        confidence: num(item.confidence),
      })).filter((item) => item.observation),
      communicationStyle: record(behaviorProfile.communication_style_data),
      sourceMessageCount: num(behaviorProfile.source_message_count) ?? 0,
      updatedFrom: Array.isArray(behaviorProfile.updated_from) ? behaviorProfile.updated_from.map(String) : [],
      updatedAt: str(behaviorProfile.updated_at),
      confidence: num(behaviorProfile.global_confidence),
      insightId,
      userFeedback: rawFeedback === 'useful' || rawFeedback === 'inaccurate' ? rawFeedback : null,
    }
  }

  const jobs = rows(jobsData).map(mapJob)
  const activeJob = jobs.find((job) => job.status === 'running' || job.status === 'queued') ?? null
  const lastDetectionJob = jobs.find((job) => job.jobType === 'account_detection') ?? null
  const compatibleConnectorRow = connectors.find((row) => ['google', 'microsoft'].includes(String(row.provider)) && String(row.status) === 'connected') ?? null
  const sources = buildSources(connectors)
  const lastSyncAt = sources.map((source) => source.lastSyncedAt).filter((value): value is string => value !== null).sort().pop() ?? null
  const signalsToday = companySignalsToday === null && behavioralSignalsToday === null
    ? null
    : (companySignalsToday ?? 0) + (behavioralSignalsToday ?? 0)

  const createdWithin30d = (iso: unknown): boolean => {
    const days = daysSince(str(iso), now)
    return days !== null && days <= 30
  }

  return {
    generatedAt: now.toISOString(),
    workspaceId: organizationId,
    degraded: degradedReasons.length > 0,
    degradedReasons: [...new Set(degradedReasons)],
    onboarding: {
      portfolioReady: tracked.length > 0,
      trackingColumnAvailable,
      compatibleConnector: compatibleConnectorRow
        ? {
            provider: String(compatibleConnectorRow.provider),
            label: PROVIDER_LABELS[String(compatibleConnectorRow.provider)] ?? String(compatibleConnectorRow.provider),
            status: 'connected',
            lastSyncedAt: str(compatibleConnectorRow.last_synced_at),
            accountEmail: str(record(compatibleConnectorRow.metadata).account_email),
          }
        : null,
      activeJob,
      lastDetectionJob,
    },
    plan: { name: planId, trackedAccounts: tracked.length, accountLimit, limitConfigured, status: str(subscription.status) ?? 'active' },
    lastVisitDigest: digest,
    globalRelationship: {
      score: aggregate.score,
      level: relationLevel(aggregate.score),
      confidence: aggregate.confidence,
      computedAt: snapshotDates.length ? snapshotDates[snapshotDates.length - 1] ?? null : null,
      delta30d: accountDeltas.length ? Math.round(accountDeltas.reduce((sum, value) => sum + value, 0) / accountDeltas.length) : null,
      includedAccounts: aggregate.includedAccounts,
      excludedAccounts: aggregate.excludedAccounts,
      distribution: aggregate.distribution,
    },
    benchmark: null,
    sources,
    activity: { exchanges: exchangesCount, signalsToday, lastSyncAt },
    counters: {
      accounts: tracked.length,
      accountsDelta30d: companies.filter((company) => createdWithin30d(company.created_at)).length || null,
      people: contacts.length,
      peopleDelta30d: contacts.filter((contact) => createdWithin30d(contact.created_at)).length || null,
      activeRelationships: scoredAccounts.filter((account) => {
        const silence = daysSince(account.lastInteractionAt, now)
        return account.tracked && silence !== null && silence <= 30
      }).length,
      decliningRelationships: scoredAccounts.filter((account) => account.tracked && ((account.delta30d !== null && account.delta30d <= -3) || (account.phase !== null && /declin|down|cool|froid/i.test(account.phase)))).length,
    },
    topAccounts: {
      best: bestAccounts(scoredAccounts),
      atRisk: atRiskAccounts(scoredAccounts, now),
    },
    teamMembers,
    coaching,
    priorityActions,
    latestSignals: signals,
  }
}

/** Persiste l'horodatage de visite (digest). Silencieux si la colonne manque. */
export async function markHomeSeen(userId: string): Promise<void> {
  const { error } = await getSupabase().from('profiles').update({ last_home_seen_at: new Date().toISOString() }).eq('id', userId)
  if (error && !isMissingSchemaError(error)) throw new Error(String(record(error).message ?? 'Horodatage impossible'))
}

export async function saveActionState(input: {
  organizationId: string
  userId: string
  actionId: string
  actionType: string
  status: 'completed' | 'dismissed' | 'postponed'
  accountId: string | null
  personId: string | null
  sourceSignalId: string | null
  reason?: string | null
  postponedUntil?: string | null
}): Promise<void> {
  const { error } = await getSupabase().from('home_action_states').upsert({
    organization_id: input.organizationId,
    user_id: input.userId,
    action_id: input.actionId,
    action_type: input.actionType,
    status: input.status,
    company_id: input.accountId,
    contact_id: input.personId,
    source_signal_id: input.sourceSignalId,
    reason: input.reason ?? null,
    postponed_until: input.postponedUntil ?? null,
    acted_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,user_id,action_id' })
  if (error) {
    if (isMissingSchemaError(error)) throw new Error('La persistance des actions nécessite la migration 202607150009_home_foundation.sql.')
    throw new Error(String(record(error).message ?? 'Action non enregistrée'))
  }
}

export async function saveInsightFeedback(input: { organizationId: string; userId: string; insightId: string; feedbackType: 'useful' | 'inaccurate' }): Promise<void> {
  const { error } = await getSupabase().from('insight_feedback').upsert({
    organization_id: input.organizationId,
    user_id: input.userId,
    insight_id: input.insightId,
    feedback_type: input.feedbackType,
  }, { onConflict: 'user_id,insight_id' })
  if (error) {
    if (isMissingSchemaError(error)) throw new Error('Le feedback coaching nécessite la migration 202607150009_home_foundation.sql.')
    throw new Error(String(record(error).message ?? 'Feedback non enregistré'))
  }
}

function mapCandidate(row: DbRow): HomeAccountCandidate {
  return {
    companyId: str(row.company_id),
    name: String(row.name ?? 'Organisation'),
    domain: str(row.domain),
    industry: str(row.industry),
    location: str(row.location),
    interactions: num(row.interactions) ?? 0,
    lastInteractionAt: str(row.last_interaction_at),
    source: str(row.source) ?? 'Messagerie',
    alreadyTracked: row.already_tracked === true,
    selected: false,
  }
}

/**
 * Lance la détection d'organisations (job réel journalisé dans sync_jobs par la
 * RPC `detect_account_candidates`, migration 202607150010).
 */
export async function detectAccountCandidates(organizationId: string): Promise<{ jobId: string; candidates: HomeAccountCandidate[] }> {
  const { data, error } = await getSupabase().rpc('detect_account_candidates', { p_organization_id: organizationId })
  if (error) {
    if (isMissingRpcError(error, 'detect_account_candidates')) {
      throw new Error('La détection des comptes nécessite la migration 202607150010_home_rpcs.sql.')
    }
    throw new Error(supabaseErrorMessage(error, 'Détection impossible'))
  }
  const payload = record(data)
  return {
    jobId: String(payload.job_id ?? ''),
    candidates: rows(payload.candidates).map(mapCandidate).sort((a, b) => b.interactions - a.interactions),
  }
}

/**
 * Persiste la sélection S2→S3. La limite du forfait est validée côté serveur
 * par la RPC `set_tracked_companies` (security definer + is_org_member).
 */
export async function setTrackedCompanies(organizationId: string, selection: Array<{ companyId: string | null; name: string; domain: string | null }>): Promise<{ jobId: string; tracked: number; linkedContacts: number }> {
  const { data, error } = await getSupabase().rpc('set_tracked_companies', {
    p_organization_id: organizationId,
    p_selection: selection.map((item) => ({ company_id: item.companyId, name: item.name, domain: item.domain })),
  })
  if (error) {
    if (isMissingRpcError(error, 'set_tracked_companies')) {
      throw new Error('L’activation des comptes nécessite la migration 202607150010_home_rpcs.sql.')
    }
    throw new Error(supabaseErrorMessage(error, 'Activation impossible'))
  }
  const payload = record(data)
  return { jobId: String(payload.job_id ?? ''), tracked: num(payload.tracked) ?? 0, linkedContacts: num(payload.linked_contacts) ?? 0 }
}

/** Suivi d'un job (reprise après refresh). */
export async function getJob(jobId: string): Promise<HomeSyncJob | null> {
  const { data, error } = await getSupabase().from('sync_jobs').select('*').eq('id', jobId).maybeSingle()
  if (error) {
    if (isMissingSchemaError(error)) return null
    throw new Error(String(record(error).message ?? 'Job introuvable'))
  }
  return data ? mapJob(record(data)) : null
}
