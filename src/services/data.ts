import { getSupabase } from '../lib/supabase'
import { triggerContactBehaviorSync } from './behavior-sync'

export type EntityStatus = 'active' | 'watch' | 'inactive'

export type Account = {
  id: string
  organization_id: string
  name: string
  domain: string | null
  industry: string | null
  location: string | null
  status: EntityStatus
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
  last_interaction_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type ConnectorRow = {
  account_name?: string | null
  share_public?: boolean
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
  platform_role: 'user' | 'super_admin'
  is_super_admin: boolean
}

export type UserBehaviorProfile = {
  global_confidence: number
  executive_summary: string | null
  cognitive_mode: string | null
  cognitive_mode_confidence: number | null
  behavioral_analysis_data: Array<{ trait?: string; observation?: string; confidence?: number }>
  communication_style_data: Record<string, unknown>
  cognitive_profile_data: Record<string, unknown>
  source_message_count: number
  source_interaction_count: number
  maturity_level: 'none' | 'emerging' | 'usable' | 'consolidated' | 'refined'
  analysis_version: number
  last_analyzed_at: string | null
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
    last_interaction_at: nullableString(row.last_monitored_at),
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
    last_interaction_at: null,
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

const contactSelect = '*,companies(name),cognitive_profiles(global_confidence,summary,executive_summary,updated_at)'

type WorkspaceMembership = { organization_id?: unknown; role?: unknown; created_at?: unknown }

/** Sélectionne le workspace actif par défaut : choix mémorisé d'abord, sinon
 * le workspace « foyer » de l'utilisateur (celui dont il est owner — créé à
 * son inscription, jamais un autre). Rejoindre l'équipe d'un client ou d'un
 * partenaire ne doit jamais faire basculer silencieusement le contexte de
 * travail vers l'organisation de ce tiers, même si elle compte plus de
 * membres : chacun garde ses comptes par défaut, et ne change d'organisation
 * que par un choix explicite (voir le sélecteur de workspace). */
export function chooseActiveOrganization(
  ownMemberships: WorkspaceMembership[],
  visibleMemberships: WorkspaceMembership[],
  storedOrganizationId: string | null = null,
): string | null {
  const own = ownMemberships
    .map((membership) => ({
      organizationId: nullableString(membership.organization_id),
      role: String(membership.role ?? 'member'),
      createdAt: String(membership.created_at ?? ''),
    }))
    .filter((membership): membership is { organizationId: string; role: string; createdAt: string } => membership.organizationId !== null)
  if (!own.length) return null
  if (storedOrganizationId && own.some((membership) => membership.organizationId === storedOrganizationId)) return storedOrganizationId

  const owned = own.filter((membership) => membership.role === 'owner')
  if (owned.length) return [...owned].sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0]!.organizationId

  // Filet de sécurité : aucun workspace propriétaire (cas anormal). On retombe
  // sur l'organisation la mieux peuplée parmi les siennes, à défaut de mieux.
  const counts = new Map<string, number>()
  for (const membership of visibleMemberships) {
    const organizationId = nullableString(membership.organization_id)
    if (organizationId) counts.set(organizationId, (counts.get(organizationId) ?? 0) + 1)
  }
  return [...own].sort((left, right) => {
    const countDelta = (counts.get(right.organizationId) ?? 0) - (counts.get(left.organizationId) ?? 0)
    if (countDelta) return countDelta
    return left.createdAt.localeCompare(right.createdAt)
  })[0]?.organizationId ?? null
}

/** Tous les écrans partagent le même workspace actif. Par défaut, chacun reste
 * dans son organisation propriétaire (voir chooseActiveOrganization) ; il ne
 * la quitte que par un choix explicite via setActiveOrganization. */
export async function getOrganizationId(): Promise<string> {
  const { data: userData, error: userError } = await getSupabase().auth.getUser()
  if (userError) throw userError
  if (!userData.user) throw new Error('Aucune session active.')
  const { data, error } = await getSupabase().from('memberships').select('organization_id,role,created_at').eq('user_id', userData.user.id).order('created_at', { ascending: true })
  if (error) throw error
  const organizationIds = [...new Set((data ?? []).map((row) => row.organization_id).filter(Boolean))]
  const { data: visibleMemberships, error: visibleError } = organizationIds.length
    ? await getSupabase().from('memberships').select('organization_id,user_id').in('organization_id', organizationIds)
    : { data: [], error: null }
  if (visibleError) throw visibleError
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('tohu-active-workspace') : null
  const organizationId = chooseActiveOrganization(data ?? [], visibleMemberships ?? [], stored)
  if (!organizationId) throw new Error('Aucune organisation n’est associée à ce compte.')
  if (typeof localStorage !== 'undefined') localStorage.setItem('tohu-active-workspace', organizationId)
  return organizationId
}

export type OrganizationMembership = { organizationId: string; name: string; role: string }

/** Toutes les organisations dont l'utilisateur est membre, pour le sélecteur
 * de workspace — permet de rejoindre explicitement l'organisation d'un
 * client/partenaire sans que ce choix ne devienne le défaut de tout le monde. */
export async function listMyOrganizations(): Promise<OrganizationMembership[]> {
  const { data: userData, error: userError } = await getSupabase().auth.getUser()
  if (userError) throw userError
  if (!userData.user) throw new Error('Aucune session active.')
  const { data, error } = await getSupabase()
    .from('memberships')
    .select('organization_id,role,organizations(name)')
    .eq('user_id', userData.user.id)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => ({
    organizationId: String(row.organization_id),
    name: nullableString(firstRecord(row.organizations).name) ?? 'Organisation',
    role: String(row.role ?? 'member'),
  }))
}

/** Bascule explicitement le workspace actif et recharge l'app pour que tous
 * les écrans (déjà bootés avec l'ancien workspaceId) repartent à jour. */
export function setActiveOrganization(organizationId: string): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem('tohu-active-workspace', organizationId)
  if (typeof window !== 'undefined') window.location.assign('/app/home')
}

export async function listAccounts(search = '', status = '', sort = 'updated_at.desc'): Promise<Account[]> {
  let query = getSupabase().from('companies').select('*').eq('is_tracked', true).order('updated_at', { ascending: false }).limit(100)
  if (search.trim()) {
    const term = escapeFilter(search)
    query = query.or(`name.ilike.%${term}%,domain.ilike.%${term}%,industry.ilike.%${term}%`)
  }
  const [{ data, error }, { data: archivedRows }] = await Promise.all([
    query,
    getSupabase().from('account_settings').select('company_id').not('archived_at', 'is', null),
  ])
  if (error) throw error
  const archivedIds = new Set((archivedRows ?? []).map((row) => String(row.company_id)))
  const rows = (data ?? []).map((row) => mapAccount(row as DbRow)).filter((row) => !archivedIds.has(row.id) && (!status || row.status === status))
  return sortEntities(rows, sort)
}

export async function listPeople(search = '', status = '', sort = 'updated_at.desc'): Promise<Person[]> {
  let query = getSupabase().from('contacts').select(contactSelect).eq('is_tracked', true).is('merged_into_contact_id', null).order('updated_at', { ascending: false }).limit(100)
  if (search.trim()) {
    const term = escapeFilter(search)
    query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,role_title.ilike.%${term}%`)
  }
  const [{ data, error }, { data: archivedRows }] = await Promise.all([
    query,
    getSupabase().from('person_settings').select('contact_id').not('archived_at', 'is', null),
  ])
  if (error) throw error
  const archivedIds = new Set((archivedRows ?? []).map((row) => String(row.contact_id)))
  const rows = (data ?? []).map((row) => mapPerson(row as DbRow)).filter((row) => !archivedIds.has(row.id) && (!status || row.status === status))
  return sortEntities(rows, sort)
}

/** Comptes « sous ma responsabilité » pour Mon profil — sous-ensemble des
 * comptes SUIVIS de l'espace (mêmes `is_tracked=true`, même périmètre
 * d'organisation que le nombre affiché en Home/liste des comptes : voir
 * `getHomeDashboard`'s `trackedAccounts`). Ne doit donc jamais dépasser ce
 * total organisation. La responsabilité suit la même règle que la fiche
 * Compte (account-list/mapping.ts `ownerId`) : le propriétaire explicite
 * (account_settings.primary_owner_user_id) fait autorité s'il existe : à
 * défaut seulement, un contact que je possède sur ce compte me le rattache —
 * jamais l'inverse, pour ne pas s'approprier un compte explicitement confié
 * à un⋅e autre membre de l'organisation. */
export async function listManagedAccounts(userId: string, organizationId: string): Promise<Account[]> {
  const client = getSupabase()
  const [{ data: settingsRows, error: settingsError }, { data: contactRows, error: contactError }] = await Promise.all([
    client.from('account_settings').select('company_id,primary_owner_user_id').eq('organization_id', organizationId),
    client.from('contacts').select('company_id').eq('organization_id', organizationId).eq('owner_user_id', userId).is('merged_into_contact_id', null).not('company_id', 'is', null),
  ])
  if (settingsError) throw settingsError
  if (contactError) throw contactError
  const ownedByMe = new Set((settingsRows ?? []).filter((row) => row.primary_owner_user_id === userId).map((row) => String(row.company_id)))
  const ownedByOther = new Set((settingsRows ?? []).filter((row) => row.primary_owner_user_id && row.primary_owner_user_id !== userId).map((row) => String(row.company_id)))
  for (const row of contactRows ?? []) {
    const companyId = String(row.company_id)
    if (!ownedByOther.has(companyId)) ownedByMe.add(companyId)
  }
  if (!ownedByMe.size) return []
  const { data, error } = await client.from('companies').select('*').eq('organization_id', organizationId).eq('is_tracked', true).in('id', [...ownedByMe])
  if (error) throw error
  const unique = new Map<string, Account>()
  for (const row of data ?? []) {
    const company = record(row as DbRow)
    if (company.id) unique.set(String(company.id), mapAccount(company))
  }
  return [...unique.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
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
  const currentUserId = (await client.auth.getUser()).data.user?.id ?? null
  const companyUpdates: DbRow = {
    name: values.name,
    public_context: publicContext,
    is_tracked: true,
    tracked_at: new Date().toISOString(),
    tracked_by: currentUserId,
  }
  if (values.domain?.trim()) companyUpdates.domain = values.domain.trim()
  if (values.industry?.trim()) companyUpdates.industry = values.industry.trim()
  const { data, error } = await client.from('companies').update(companyUpdates).eq('id', String(resolvedCompany.company_id)).select().single()
  if (error) throw error
  if (currentUserId) {
    const companyId = String(resolvedCompany.company_id)
    const { error: ownerError } = await client.from('account_settings').upsert({
      organization_id: organizationId,
      company_id: companyId,
      primary_owner_user_id: currentUserId,
      updated_by: currentUserId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id,company_id' })
    if (ownerError) throw ownerError
    const { error: visionError } = await client.rpc('set_fiche_vision_visibility', {
      p_organization_id: organizationId,
      p_entity_type: 'company',
      p_entity_id: companyId,
      p_visibility: 'workspace',
    })
    if (visionError) throw visionError
  }
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
  const currentUserId = (await client.auth.getUser()).data.user?.id ?? null
  const contactUpdates: DbRow = {
    enrichment_data: { status: values.status ?? 'active' },
    is_tracked: true,
    tracked_at: new Date().toISOString(),
    tracked_by: currentUserId,
  }
  if (values.avatar_url?.trim()) contactUpdates.avatar_url = values.avatar_url.trim()
  if (values.location?.trim()) contactUpdates.location = values.location.trim()
  const { data, error } = await client.from('contacts').update(contactUpdates).eq('id', String(resolvedContact.contact_id)).select(contactSelect).single()
  if (error) throw error
  if (currentUserId) {
    const contactId = String(resolvedContact.contact_id)
    const { error: ownerError } = await client.from('person_settings').upsert({
      organization_id: organizationId,
      contact_id: contactId,
      primary_owner_user_id: currentUserId,
      updated_by: currentUserId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id,contact_id' })
    if (ownerError) throw ownerError
    const { error: visionError } = await client.rpc('set_fiche_vision_visibility', {
      p_organization_id: organizationId,
      p_entity_type: 'contact',
      p_entity_id: contactId,
      p_visibility: 'workspace',
    })
    if (visionError) throw visionError
  }
  void triggerContactBehaviorSync(organizationId, String(resolvedContact.contact_id)).catch(() => undefined)
  return mapPerson(data as DbRow)
}

export async function saveSignalFeedback(signalId: string, userId: string, verdict: 'confirmed' | 'dismissed'): Promise<void> {
  const organizationId = await getOrganizationId()
  const { error } = await getSupabase().from('signal_feedback').upsert({ organization_id: organizationId, signal_id: signalId, user_id: userId, verdict }, { onConflict: 'user_id,signal_id' })
  if (error) throw error
}

/** Un connecteur est strictement personnel : il n'est plus rattaché à
 * l'organisation actuellement affichée, mais à l'organisation foyer de son
 * propriétaire (imposée en base par un trigger). On ne le filtre donc que
 * par utilisateur — jamais par workspace actif. */
export async function listConnectors(): Promise<ConnectorRow[]> {
  const { data: { user } } = await getSupabase().auth.getUser()
  if (!user) throw new Error('Session invalide')
  const { data, error } = await getSupabase().from('connectors').select('*').eq('user_id', user.id).order('provider')
  if (error) throw error
  return (data ?? []).map((row) => ({
    provider: row.provider,
    status: row.status as ConnectorRow['status'],
    connected_at: row.created_at,
    last_synced_at: row.last_synced_at,
    last_error: nullableString(record(row.metadata).last_error),
    account_name: nullableString(record(row.metadata).team_name) ?? nullableString(record(row.metadata).workspace_name),
    share_public: record(row.metadata).share_public === true,
  }))
}

export async function setConnector(userId: string, provider: string, status: ConnectorRow['status']): Promise<void> {
  const organizationId = await getOrganizationId()
  const { error } = await getSupabase().from('connectors').upsert({ organization_id: organizationId, user_id: userId, provider, status, scopes: [] }, { onConflict: 'user_id,provider' })
  if (error) throw error
}

export async function getProfile(userId: string): Promise<ProfileRow> {
  const { data, error } = await getSupabase().from('profiles').select('id,full_name,avatar_url,role_title,company_name,website_url,product_summary,onboarding_completed,platform_role,is_super_admin').eq('id', userId).single()
  if (error) throw error
  return { ...data, full_name: data.full_name ?? 'Membre Tohu', email: null, role: data.role_title, role_title: data.role_title } as ProfileRow
}

const AVATAR_BUCKET = 'profile-avatars'
const AVATAR_MAX_BYTES = 5 * 1024 * 1024

export async function uploadProfileAvatar(userId: string, file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Le fichier doit être une image.')
  if (file.size > AVATAR_MAX_BYTES) throw new Error('L’image ne doit pas dépasser 5 Mo.')
  const client = getSupabase()
  const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${userId}/${Date.now()}.${extension}`
  const { error: uploadError } = await client.storage.from(AVATAR_BUCKET).upload(path, file, { contentType: file.type, upsert: true })
  if (uploadError) throw new Error(uploadError.message)
  const { data } = client.storage.from(AVATAR_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

export async function getResponsibleBehaviorProfile(userId: string, organizationId: string): Promise<UserBehaviorProfile | null> {
  const client = getSupabase()
  const { data, error } = await client
    .from('user_behavioral_profiles')
    .select('global_confidence,executive_summary,cognitive_mode,cognitive_mode_confidence,behavioral_analysis_data,communication_style_data,cognitive_profile_data,source_message_count,source_interaction_count,maturity_level,analysis_version,last_analyzed_at,updated_from,updated_at')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (error && (['42703', 'PGRST204'].includes(error.code ?? '') || /cognitive_profile_data|source_interaction_count|maturity_level|analysis_version|last_analyzed_at/i.test(error.message))) {
    const legacy = await client.from('user_behavioral_profiles')
      .select('global_confidence,executive_summary,cognitive_mode,cognitive_mode_confidence,behavioral_analysis_data,communication_style_data,source_message_count,updated_from,updated_at')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (legacy.error) throw legacy.error
    if (!legacy.data) return null
    return {
      ...legacy.data,
      cognitive_profile_data: {},
      source_interaction_count: legacy.data.source_message_count ?? 0,
      maturity_level: 'none',
      analysis_version: 2,
      last_analyzed_at: legacy.data.updated_at ?? null,
    } as UserBehaviorProfile
  }
  if (error) throw error
  return data as UserBehaviorProfile | null
}

export type UserIdentityAlias = { id: string; email: string; createdAt: string }

/** Adresses secondaires (alias Send-As, boîte pro, etc.) explicitement
 * rattachées à l'utilisateur — voir user_identity_aliases. Le pipeline
 * comportemental (sync-email-analysis) les traite comme « moi » au même
 * titre que l'adresse du connecteur, pour consolider un seul profil. */
export async function listUserIdentityAliases(userId: string, organizationId: string): Promise<UserIdentityAlias[]> {
  const { data, error } = await getSupabase()
    .from('user_identity_aliases')
    .select('id,email,created_at')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => ({ id: String(row.id), email: String(row.email), createdAt: String(row.created_at) }))
}

export async function addUserIdentityAlias(userId: string, organizationId: string, email: string): Promise<void> {
  const clean = email.trim().toLowerCase()
  if (!clean || !clean.includes('@')) throw new Error('Adresse email invalide.')
  const { error } = await getSupabase().from('user_identity_aliases').insert({ organization_id: organizationId, user_id: userId, email: clean })
  if (error) {
    if (error.code === '23505') throw new Error('Cette adresse est déjà reliée à un profil.')
    throw error
  }
}

export async function removeUserIdentityAlias(aliasId: string): Promise<void> {
  const { error } = await getSupabase().from('user_identity_aliases').delete().eq('id', aliasId)
  if (error) throw error
}

export async function globalSearch(term: string): Promise<Array<{ id: string; type: 'account' | 'person'; name: string; meta: string }>> {
  const clean = escapeFilter(term)
  if (clean.length < 2) return []
  const client = getSupabase()
  const [accounts, people] = await Promise.all([
    client.from('companies').select('id,name,industry').eq('is_tracked', true).ilike('name', `%${clean}%`).limit(5),
    client.from('contacts').select('id,full_name,role_title').eq('is_tracked', true).is('merged_into_contact_id', null).ilike('full_name', `%${clean}%`).limit(5),
  ])
  if (accounts.error) throw accounts.error
  if (people.error) throw people.error
  return [
    ...(accounts.data ?? []).map((row) => ({ id: row.id, type: 'account' as const, name: row.name, meta: row.industry ?? 'Compte' })),
    ...(people.data ?? []).map((row) => ({ id: row.id, type: 'person' as const, name: row.full_name, meta: row.role_title ?? 'Personne' })),
  ]
}
