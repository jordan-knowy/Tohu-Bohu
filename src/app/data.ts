import { getSupabase } from '../lib/supabase'
import { mapStrategicReading, type StrategicReading } from './strategic-reading'
import { signalTitle } from './signal-labels'

export type EntityStatus = 'active' | 'watch' | 'inactive'

export type Account = {
  id: string
  organization_id: string
  name: string
  domain: string | null
  industry: string | null
  location: string | null
  status: EntityStatus
  relationship_score: number | null
  confidence_score: number | null
  last_interaction_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type Person = {
  id: string
  organization_id: string
  user_id: string | null
  full_name: string
  email: string | null
  phone: string | null
  job_title: string | null
  company_name: string | null
  avatar_url: string | null
  location: string | null
  status: EntityStatus
  relationship_score: number | null
  confidence_score: number | null
  last_interaction_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type Signal = {
  id: string
  entity_type: 'account' | 'person'
  entity_id: string
  signal_type: string
  title: string
  summary: string | null
  source: string
  confidence: number | null
  occurred_at: string
}

export type Interaction = {
  id: string
  interaction_type: string
  title: string
  summary: string | null
  source: string | null
  occurred_at: string
}

export type ConnectorRow = {
  provider: string
  status: 'not_connected' | 'connected' | 'expired' | 'error' | 'revoked' | 'needs_reauth' | 'disconnected'
  connected_at: string | null
  last_synced_at: string | null
  last_error: string | null
}

export type ProfileRow = {
  id: string
  full_name: string
  email: string | null
  avatar_url: string | null
  role: string | null
  role_title: string | null
  company_name: string | null
  website_url: string | null
  product_summary: string | null
  onboarding_completed: boolean
}

export type UserBehaviorProfile = {
  global_confidence: number
  executive_summary: string | null
  cognitive_mode: string | null
  cognitive_mode_confidence: number | null
  behavioral_analysis_data: Array<{ trait?: string; observation?: string; confidence?: number }>
  communication_style_data: Record<string, unknown>
  source_message_count: number
  updated_from: string[]
  updated_at: string
}

type DbRow = Record<string, unknown>

function record(value: unknown): DbRow {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as DbRow
  return {}
}

function firstRecord(value: unknown): DbRow {
  if (Array.isArray(value)) return record(value[0])
  return record(value)
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function entityStatus(value: unknown): EntityStatus {
  return value === 'watch' || value === 'inactive' ? value : 'active'
}

function escapeFilter(value: string): string {
  return value.replace(/[,%()]/g, ' ').trim()
}

function mapAccount(row: DbRow): Account {
  const context = record(row.public_context)
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    name: String(row.name ?? 'Entreprise'),
    domain: nullableString(row.domain),
    industry: nullableString(row.industry),
    location: nullableString(context.location),
    status: entityStatus(context.status),
    relationship_score: nullableNumber(context.relationship_score),
    confidence_score: nullableNumber(context.confidence_score ?? row.account_type_confidence),
    last_interaction_at: nullableString(context.last_interaction_at ?? row.last_monitored_at),
    notes: nullableString(context.notes),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
  }
}

function latest(rows: unknown, dateKey: string): DbRow {
  if (!Array.isArray(rows)) return firstRecord(rows)
  return [...rows].map(record).sort((a, b) => String(b[dateKey] ?? '').localeCompare(String(a[dateKey] ?? '')))[0] ?? {}
}

function mapPerson(row: DbRow): Person {
  const company = firstRecord(row.companies)
  const snapshot = latest(row.relationship_snapshots, 'snapshot_date')
  const cognitive = latest(row.cognitive_profiles, 'updated_at')
  const enrichment = record(row.enrichment_data)
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    user_id: nullableString(row.owner_user_id),
    full_name: String(row.full_name ?? 'Contact'),
    email: nullableString(row.email),
    phone: nullableString(enrichment.phone),
    job_title: nullableString(row.role_title),
    company_name: nullableString(company.name),
    avatar_url: nullableString(row.avatar_url),
    location: nullableString(row.location),
    status: entityStatus(enrichment.status),
    relationship_score: nullableNumber(snapshot.engagement_score ?? cognitive.engagement_score),
    confidence_score: nullableNumber(cognitive.global_confidence),
    last_interaction_at: nullableString(snapshot.last_contact_at),
    notes: nullableString(cognitive.executive_summary ?? cognitive.summary ?? row.web_bio),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
  }
}

function sortEntities<T extends Account | Person>(rows: T[], sort: string): T[] {
  const [field = 'updated_at', direction = 'desc'] = sort.split('.')
  const factor = direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const left = a[field as keyof T]
    const right = b[field as keyof T]
    if (left === null || left === undefined) return 1
    if (right === null || right === undefined) return -1
    return (typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right))) * factor
  })
}

const contactSelect = '*,companies(name),relationship_snapshots(engagement_score,last_contact_at,phase,snapshot_date),cognitive_profiles(global_confidence,summary,executive_summary,engagement_score,updated_at)'

export async function getOrganizationId(): Promise<string> {
  const { data, error } = await getSupabase().from('memberships').select('organization_id').limit(1).maybeSingle()
  if (error) throw error
  if (!data?.organization_id) throw new Error('Aucune organisation n’est associée à ce compte.')
  return data.organization_id
}

export async function listAccounts(search = '', status = '', sort = 'updated_at.desc'): Promise<Account[]> {
  let query = getSupabase().from('companies').select('*').order('updated_at', { ascending: false }).limit(100)
  if (search.trim()) {
    const term = escapeFilter(search)
    query = query.or(`name.ilike.%${term}%,domain.ilike.%${term}%,industry.ilike.%${term}%`)
  }
  const { data, error } = await query
  if (error) throw error
  const rows = (data ?? []).map((row) => mapAccount(row as DbRow)).filter((row) => !status || row.status === status)
  return sortEntities(rows, sort)
}

export async function listPeople(search = '', status = '', sort = 'updated_at.desc'): Promise<Person[]> {
  let query = getSupabase().from('contacts').select(contactSelect).is('merged_into_contact_id', null).order('updated_at', { ascending: false }).limit(100)
  if (search.trim()) {
    const term = escapeFilter(search)
    query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,role_title.ilike.%${term}%`)
  }
  const { data, error } = await query
  if (error) throw error
  const rows = (data ?? []).map((row) => mapPerson(row as DbRow)).filter((row) => !status || row.status === status)
  return sortEntities(rows, sort)
}

export async function getAccountDetail(id: string): Promise<{ account: Account; people: Person[]; signals: Signal[]; interactions: Interaction[]; reading: StrategicReading | null }> {
  const client = getSupabase()
  const [accountResult, peopleResult, signalsResult, meetingsResult, readingResult] = await Promise.all([
    client.from('companies').select('*').eq('id', id).single(),
    client.from('contacts').select(contactSelect).eq('company_id', id).is('merged_into_contact_id', null),
    client.from('company_signals').select('*').eq('company_id', id).order('observed_at', { ascending: false }).limit(50),
    client.from('meetings').select('*').eq('company_id', id).order('starts_at', { ascending: false }).limit(50),
    client.from('account_strategic_readings').select('content,confidence,source_counts,model,generated_at').eq('company_id', id).maybeSingle(),
  ])
  if (accountResult.error) throw accountResult.error
  if (peopleResult.error) throw peopleResult.error
  if (signalsResult.error) throw signalsResult.error
  if (meetingsResult.error) throw meetingsResult.error
  // Table absente (migration 202607160011 non appliquée) : lecture indisponible, jamais simulée.
  const reading = readingResult.error ? null : mapStrategicReading(readingResult.data as DbRow | null)
  return {
    account: mapAccount(accountResult.data as DbRow),
    reading,
    people: (peopleResult.data ?? []).map((row) => mapPerson(row as DbRow)),
    signals: (signalsResult.data ?? []).map((row) => ({
      id: row.id,
      entity_type: 'account' as const,
      entity_id: row.company_id,
      signal_type: row.family,
      title: row.title,
      summary: row.summary,
      source: row.source ?? 'Veille entreprise',
      confidence: nullableNumber(row.confidence),
      occurred_at: row.observed_at ?? row.created_at,
    })),
    interactions: (meetingsResult.data ?? []).map((row) => ({
      id: row.id,
      interaction_type: row.meeting_type ?? 'meeting',
      title: row.title,
      summary: row.description,
      source: row.platform,
      occurred_at: row.starts_at ?? row.created_at,
    })),
  }
}

export async function getPersonDetail(id: string): Promise<{ person: Person; accounts: Account[]; signals: Signal[]; interactions: Interaction[] }> {
  const client = getSupabase()
  const [personResult, signalsResult, participantsResult] = await Promise.all([
    client.from('contacts').select(contactSelect).eq('id', id).single(),
    client.from('behavioral_signals').select('*').eq('contact_id', id).order('observed_at', { ascending: false }).limit(50),
    client.from('meeting_participants').select('meetings(*)').eq('contact_id', id).limit(50),
  ])
  if (personResult.error) throw personResult.error
  if (signalsResult.error) throw signalsResult.error
  if (participantsResult.error) throw participantsResult.error
  const rawPerson = personResult.data as DbRow
  const company = firstRecord(rawPerson.companies)
  const meetings = (participantsResult.data ?? []).map((row) => firstRecord(row.meetings)).filter((row) => row.id)
  return {
    person: mapPerson(rawPerson),
    accounts: company.id ? [mapAccount({ ...company, organization_id: rawPerson.organization_id })] : [],
    signals: (signalsResult.data ?? []).map((row) => ({
      id: row.id,
      entity_type: 'person' as const,
      entity_id: row.contact_id,
      signal_type: row.signal_type,
      title: signalTitle(row.signal_type, row.inference, row.text),
      summary: row.text,
      source: row.source_type,
      confidence: nullableNumber(row.confidence),
      occurred_at: row.observed_at ?? row.created_at,
    })),
    interactions: meetings.map((row) => ({
      id: String(row.id),
      interaction_type: String(row.meeting_type ?? 'meeting'),
      title: String(row.title ?? 'Rendez-vous'),
      summary: nullableString(row.description),
      source: nullableString(row.platform),
      occurred_at: String(row.starts_at ?? row.created_at),
    })),
  }
}

export async function listManagedAccounts(userId: string): Promise<Account[]> {
  const { data, error } = await getSupabase()
    .from('contacts')
    .select('companies(*)')
    .eq('owner_user_id', userId)
    .is('merged_into_contact_id', null)
    .not('company_id', 'is', null)
  if (error) throw error
  const unique = new Map<string, Account>()
  for (const row of data ?? []) {
    const company = firstRecord(row.companies)
    if (company.id) unique.set(String(company.id), mapAccount(company))
  }
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export async function createAccount(values: Partial<Account>): Promise<Account> {
  const organizationId = await getOrganizationId()
  const client = getSupabase()
  const { data: resolved, error: resolveError } = await client.rpc('resolve_company_identity', {
    p_organization_id: organizationId,
    p_name: values.name,
    p_domain: values.domain ?? null,
    p_industry: values.industry ?? null,
    p_create_if_missing: true,
  }).single()
  if (resolveError) throw resolveError
  const resolvedCompany = record(resolved)
  if (!resolvedCompany.company_id) throw new Error('Compte non résolu.')
  const publicContext = { status: values.status ?? 'active', location: values.location ?? null, notes: values.notes ?? null }
  const companyUpdates: DbRow = {
    name: values.name,
    public_context: publicContext,
  }
  if (values.domain?.trim()) companyUpdates.domain = values.domain.trim()
  if (values.industry?.trim()) companyUpdates.industry = values.industry.trim()
  const { data, error } = await client.from('companies').update(companyUpdates).eq('id', String(resolvedCompany.company_id)).select().single()
  if (error) throw error
  return mapAccount(data as DbRow)
}

export async function createPerson(values: Partial<Person>): Promise<Person> {
  const organizationId = await getOrganizationId()
  let companyId: string | null = null
  if (values.company_name?.trim()) {
    const { data: company, error: companyError } = await getSupabase().rpc('resolve_company_identity', {
      p_organization_id: organizationId,
      p_name: values.company_name.trim(),
      p_domain: null,
      p_industry: null,
      p_create_if_missing: true,
    }).single()
    if (companyError) throw companyError
    const resolvedCompany = record(company)
    companyId = nullableString(resolvedCompany.company_id)
    if (!companyId) throw new Error('Organisation non résolue.')
  }
  const client = getSupabase()
  const { data: resolved, error: resolveError } = await client.rpc('resolve_contact_identity', {
    p_organization_id: organizationId,
    p_email: values.email ?? null,
    p_full_name: values.full_name,
    p_company_id: companyId,
    p_owner_user_id: values.user_id ?? null,
    p_role_title: values.job_title ?? null,
    p_source: 'manual',
  }).single()
  if (resolveError) throw resolveError
  const resolvedContact = record(resolved)
  if (!resolvedContact.contact_id) throw new Error('Personne non résolue.')
  const contactUpdates: DbRow = {
    enrichment_data: { status: values.status ?? 'active' },
  }
  if (values.avatar_url?.trim()) contactUpdates.avatar_url = values.avatar_url.trim()
  if (values.location?.trim()) contactUpdates.location = values.location.trim()
  const { data, error } = await client.from('contacts').update(contactUpdates).eq('id', String(resolvedContact.contact_id)).select(contactSelect).single()
  if (error) throw error
  return mapPerson(data as DbRow)
}

/**
 * Génère (ou régénère) la lecture stratégique d'un compte via l'Edge Function
 * `account-strategic-reading`. Le serveur revalide la suffisance des données :
 * `insufficient` liste ce qui manque quand aucune synthèse n'est possible.
 */
export async function generateStrategicReading(companyId: string): Promise<{ reading: StrategicReading | null; insufficient: string[] | null }> {
  const organizationId = await getOrganizationId()
  const { data, error } = await getSupabase().functions.invoke('account-strategic-reading', { body: { organizationId, companyId } })
  if (error || data?.error) throw error ?? new Error(String(data.error))
  if (data?.insufficient) return { reading: null, insufficient: Array.isArray(data.missing) ? data.missing.map(String) : [] }
  return { reading: mapStrategicReading(record(data?.reading)), insufficient: null }
}

export async function saveSignalFeedback(signalId: string, userId: string, verdict: 'confirmed' | 'dismissed'): Promise<void> {
  const organizationId = await getOrganizationId()
  const { error } = await getSupabase().from('signal_feedback').upsert({ organization_id: organizationId, signal_id: signalId, user_id: userId, verdict }, { onConflict: 'user_id,signal_id' })
  if (error) throw error
}

export async function listConnectors(): Promise<ConnectorRow[]> {
  const { data, error } = await getSupabase().from('connectors').select('*').order('provider')
  if (error) throw error
  return (data ?? []).map((row) => ({
    provider: row.provider,
    status: row.status as ConnectorRow['status'],
    connected_at: row.created_at,
    last_synced_at: row.last_synced_at,
    last_error: nullableString(record(row.metadata).last_error),
  }))
}

export async function setConnector(userId: string, provider: string, status: ConnectorRow['status']): Promise<void> {
  const organizationId = await getOrganizationId()
  const { error } = await getSupabase().from('connectors').upsert({ organization_id: organizationId, user_id: userId, provider, status, scopes: [] }, { onConflict: 'organization_id,user_id,provider' })
  if (error) throw error
}

export async function getProfile(userId: string): Promise<ProfileRow> {
  const { data, error } = await getSupabase().from('profiles').select('id,full_name,avatar_url,role_title,company_name,website_url,product_summary,onboarding_completed').eq('id', userId).single()
  if (error) throw error
  return { ...data, full_name: data.full_name ?? 'Membre Tohu', email: null, role: data.role_title, role_title: data.role_title } as ProfileRow
}

export async function getResponsibleBehaviorProfile(userId: string, organizationId: string): Promise<UserBehaviorProfile | null> {
  const { data, error } = await getSupabase()
    .from('user_behavioral_profiles')
    .select('global_confidence,executive_summary,cognitive_mode,cognitive_mode_confidence,behavioral_analysis_data,communication_style_data,source_message_count,updated_from,updated_at')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (error) throw error
  return data as UserBehaviorProfile | null
}

export async function globalSearch(term: string): Promise<Array<{ id: string; type: 'account' | 'person'; name: string; meta: string }>> {
  const clean = escapeFilter(term)
  if (clean.length < 2) return []
  const client = getSupabase()
  const [accounts, people] = await Promise.all([
    client.from('companies').select('id,name,industry').ilike('name', `%${clean}%`).limit(5),
    client.from('contacts').select('id,full_name,role_title').ilike('full_name', `%${clean}%`).limit(5),
  ])
  if (accounts.error) throw accounts.error
  if (people.error) throw people.error
  return [
    ...(accounts.data ?? []).map((row) => ({ id: row.id, type: 'account' as const, name: row.name, meta: row.industry ?? 'Compte' })),
    ...(people.data ?? []).map((row) => ({ id: row.id, type: 'person' as const, name: row.full_name, meta: row.role_title ?? 'Personne' })),
  ]
}
