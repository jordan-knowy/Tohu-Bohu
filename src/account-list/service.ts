import { getSupabase } from '../lib/supabase'
import { trackPersonCandidate } from '../person-list/service'
import {
  buildAccountRows, buildPortfolioSeries, buildTickerItems, evolutionPercents,
  object, rows, text, num,
  type AccountListRow, type PortfolioPoint, type Row, type TeamMember, type TickerItem,
} from './mapping'

type QueryResult = { data: unknown; error: { message?: string; code?: string } | null }

// Le projet Supabase plafonne chaque requête PostgREST à 1000 lignes côté
// serveur (db-max-rows), quel que soit le .limit() demandé côté client. Pour
// contact_score_history (historique réel, peut dépasser 1000 lignes dès
// quelques mois de recul), on pagine explicitement via .range() pour ne
// jamais perdre silencieusement les mois les plus anciens.
async function fetchAllPages(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: QueryResult['error'] }>,
  pageSize = 1000,
  maxRows = 20000,
): Promise<QueryResult> {
  const out: unknown[] = []
  let from = 0
  while (from < maxRows) {
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) return { data: null, error }
    const page = data ?? []
    out.push(...page)
    if (page.length < pageSize) break
    from += pageSize
  }
  return { data: out, error: null }
}

function optional(result: QueryResult, label: string, degraded: string[]): unknown {
  if (!result.error) return result.data
  if (['42P01', '42703', 'PGRST200', 'PGRST204', 'PGRST205'].includes(result.error.code ?? '') || /does not exist|schema cache/i.test(result.error.message ?? '')) {
    degraded.push(`${label} non configuré`)
    return null
  }
  throw new Error(result.error.message ?? `Impossible de charger ${label}.`)
}

export type AccountsOverview = {
  workspaceId: string
  generatedAt: string
  degradedReasons: string[]
  accounts: AccountListRow[]
  globalScore: number | null
  scoredCount: number
  evolutions: { m1: number | null; m3: number | null; m12: number | null }
  series36: PortfolioPoint[]
  ticker: TickerItem[]
  team: TeamMember[]
}

export async function getAccountsOverview(workspaceId: string, userId: string): Promise<AccountsOverview> {
  const client = getSupabase()
  const degradedReasons: string[] = []
  const now = new Date()

  const [
    companiesResult, contactsResult, historyResult, settingsResult, prefsResult,
    watchResult, meetingsResult, messagesResult, signalsResult, membershipsResult, profilesResult,
    accountScoresResult,
  ] = await Promise.all([
    client.from('companies').select('id,name,domain,industry,public_context,is_tracked,created_at').eq('organization_id', workspaceId).eq('is_tracked', true).limit(500),
    client.from('contacts').select('id,company_id,owner_user_id,email,enrichment_data,cognitive_profiles(engagement_score,score_phase,updated_at)').eq('organization_id', workspaceId).eq('is_tracked', true).is('merged_into_contact_id', null).limit(1000),
    fetchAllPages((from, to) => client.from('contact_score_history').select('contact_id,score,snapshot_date').eq('organization_id', workspaceId).order('id', { ascending: true }).range(from, to)),
    client.from('account_settings').select('company_id,relationship_status,relationship_started_at,primary_owner_user_id,archived_at').eq('organization_id', workspaceId),
    client.from('account_user_preferences').select('company_id,favorite').eq('organization_id', workspaceId).eq('user_id', userId),
    client.from('account_watch_settings').select('company_id,enabled').eq('organization_id', workspaceId),
    client.from('meetings').select('company_id,platform,starts_at').eq('organization_id', workspaceId).limit(1000),
    client.from('communication_messages').select('contact_id').eq('organization_id', workspaceId).limit(3000),
    client.from('company_signals').select('id,company_id,family,title,summary,source,observed_at,companies(name)').eq('organization_id', workspaceId).order('observed_at', { ascending: false }).limit(24),
    client.from('memberships').select('user_id').eq('organization_id', workspaceId),
    client.from('profiles').select('id,full_name,avatar_url'),
    client.from('account_relationship_score_snapshots').select('company_id,score,computed_at').eq('organization_id', workspaceId).order('computed_at', { ascending: false }).limit(2000),
  ])

  if (companiesResult.error) throw new Error(companiesResult.error.message)
  if (contactsResult.error) throw new Error(contactsResult.error.message)

  const companies = rows(companiesResult.data)
  const contacts = rows(contactsResult.data)
  const scoreHistory = rows(optional(historyResult, 'Historique de score', degradedReasons))
  const settings = rows(optional(settingsResult, 'Réglages Compte', degradedReasons))
  const preferences = rows(optional(prefsResult, 'Favoris Compte', degradedReasons))
  const watch = rows(optional(watchResult, 'Veille Compte', degradedReasons))
  const meetings = rows(optional(meetingsResult, 'Réunions', degradedReasons))
  const messages = rows(optional(messagesResult, 'Emails', degradedReasons))
  const signals = rows(optional(signalsResult, 'Signaux comptes', degradedReasons))
  const memberships = rows(optional(membershipsResult, 'Équipe', degradedReasons))
  const profiles = rows(optional(profilesResult, 'Profils', degradedReasons))
  const accountScoreRows = rows(optional(accountScoresResult, 'Snapshots du score Compte', degradedReasons))
  // Trié par computed_at desc : le premier snapshot rencontré par compte est le plus récent.
  const accountScores = new Map<string, number>()
  for (const row of accountScoreRows) {
    const companyId = text(row.company_id)
    if (!companyId || accountScores.has(companyId)) continue
    const score = num(row.score)
    if (score !== null) accountScores.set(companyId, score)
  }

  const profileNames = new Map(profiles.map((profile) => [String(profile.id), text(profile.full_name) ?? 'Membre Tohu']))
  const memberIds = new Set(memberships.map((membership) => String(membership.user_id)))
  const team: TeamMember[] = profiles
    .filter((profile) => memberIds.has(String(profile.id)))
    .map((profile) => ({ id: String(profile.id), name: text(profile.full_name) ?? 'Membre Tohu', avatarUrl: text(profile.avatar_url) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const accounts = buildAccountRows({
    companies, contacts, scoreHistory, settings, preferences, watch, meetings,
    messageContactIds: new Set(messages.map((message) => String(message.contact_id))),
    signals, profileNames, accountScores, now,
  })

  const scored = accounts.filter((account) => account.score !== null)
  // Un compte archivé n'apparaît plus dans `accounts` (buildAccountRows le
  // filtre déjà) mais buildPortfolioSeries reçoit `contacts` brut : sans ce
  // filtre, son historique restait mélangé dans le graphe de portefeuille.
  const archivedCompanyIds = new Set(settings.filter((row) => row.archived_at).map((row) => text(row.company_id)))
  const scorableContacts = contacts.filter((contact) => !archivedCompanyIds.has(text(contact.company_id)))
  const series36 = buildPortfolioSeries(scoreHistory, scorableContacts, 36, now)
  return {
    workspaceId,
    generatedAt: now.toISOString(),
    degradedReasons,
    accounts,
    globalScore: scored.length ? Math.round(scored.reduce((sum, account) => sum + (account.score ?? 0), 0) / scored.length) : null,
    scoredCount: scored.length,
    evolutions: evolutionPercents(series36),
    series36,
    ticker: buildTickerItems(signals, new Map(companies.map((company) => [String(company.id), text(company.name) ?? 'Compte']))),
    team,
  }
}

export async function setListFavorite(workspaceId: string, companyId: string, userId: string, favorite: boolean): Promise<void> {
  const { error } = await getSupabase().from('account_user_preferences').upsert({
    organization_id: workspaceId, company_id: companyId, user_id: userId, favorite, updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,company_id,user_id' })
  if (error) throw error
}

export async function setListWatch(workspaceId: string, companyId: string, userId: string, enabled: boolean): Promise<void> {
  const { error } = await getSupabase().from('account_watch_settings').upsert({
    organization_id: workspaceId, company_id: companyId, enabled, updated_by: userId, updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,company_id' })
  if (error) throw error
}

export async function setListRelationType(workspaceId: string, companyId: string, userId: string, relationType: string): Promise<void> {
  const { error } = await getSupabase().from('account_settings').upsert({
    organization_id: workspaceId, company_id: companyId, relationship_status: relationType, updated_by: userId, updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,company_id' })
  if (error) throw error
}

export async function setListOwner(workspaceId: string, companyId: string, userId: string, ownerId: string): Promise<void> {
  const { error } = await getSupabase().from('account_settings').upsert({
    organization_id: workspaceId, company_id: companyId, primary_owner_user_id: ownerId, updated_by: userId, updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,company_id' })
  if (error) throw error
}

/** Suppression groupée : archive plusieurs comptes en une passe (réversible). */
export async function archiveAccounts(workspaceId: string, userId: string, companyIds: string[]): Promise<void> {
  if (!companyIds.length) return
  const client = getSupabase()
  const now = new Date().toISOString()
  const { error } = await client.from('account_settings').upsert(
    companyIds.map((companyId) => ({ organization_id: workspaceId, company_id: companyId, archived_at: now, updated_by: userId, updated_at: now })),
    { onConflict: 'organization_id,company_id' },
  )
  if (error) throw error
  void client.functions.invoke('score-batch', { body: { organizationId: workspaceId } })
}

/** Passation : réattribue l'owner des comptes sélectionnés et de leurs contacts,
 *  et historise chaque transfert de contact dans contact_transfers. */
export async function reassignAccounts(workspaceId: string, accounts: AccountListRow[], toUserId: string, byUserId: string): Promise<{ transferred: number; logged: boolean }> {
  const client = getSupabase()
  let transferred = 0
  let logged = true
  for (const account of accounts) {
    await setListOwner(workspaceId, account.id, byUserId, toUserId)
    const { data: linked, error: contactsError } = await client.from('contacts')
      .select('id,owner_user_id').eq('organization_id', workspaceId).eq('company_id', account.id).is('merged_into_contact_id', null)
    if (contactsError) throw contactsError
    const toMove = rows(linked).filter((contact) => text(contact.owner_user_id) !== toUserId)
    if (toMove.length) {
      const { error: updateError } = await client.from('contacts').update({ owner_user_id: toUserId })
        .eq('organization_id', workspaceId).eq('company_id', account.id)
      if (updateError) throw updateError
      const { error: logError } = await client.from('contact_transfers').insert(toMove.map((contact) => ({
        organization_id: workspaceId,
        contact_id: String(contact.id),
        from_user_id: text(contact.owner_user_id),
        to_user_id: toUserId,
        kept_copy: false,
        transferred_by: byUserId,
      })))
      if (logError) logged = false
      transferred += toMove.length
    }
  }
  return { transferred, logged }
}

export type AccountCandidate = {
  companyId: string | null
  name: string
  domain: string | null
  industry: string | null
  interactions: number
  interlocutorCount: number
  interlocutors: string[]
  firstInteractionAt: string | null
  lastInteractionAt: string | null
  source: string
  alreadyTracked: boolean
}

export async function detectAccountCandidates(workspaceId: string): Promise<AccountCandidate[]> {
  const { data, error } = await getSupabase().rpc('detect_account_candidates', { p_organization_id: workspaceId })
  if (error) throw error
  return rows(object(data).candidates).map((row: Row) => ({
    companyId: text(row.company_id),
    name: text(row.name) ?? 'Compte détecté',
    domain: text(row.domain),
    industry: text(row.industry),
    interactions: num(row.interactions) ?? 0,
    interlocutorCount: num(row.interlocutor_count) ?? 0,
    interlocutors: Array.isArray(row.interlocutors) ? row.interlocutors.filter((value): value is string => typeof value === 'string') : [],
    firstInteractionAt: text(row.first_interaction_at),
    lastInteractionAt: text(row.last_interaction_at),
    source: text(row.source) ?? 'Messagerie connectée',
    alreadyTracked: row.already_tracked === true,
  }))
}

// Suivre un compte (add_tracked_company) ne suit aucun de ses contacts : sans
// ça, aucune analyse (Confiance/Satisfaction/Relation) ne se déclenche jamais
// pour lui — il faudrait sinon tracker chaque personne à la main pour que le
// moteur ait quoi que ce soit à lire. On active ici les interlocuteurs les
// plus récemment actifs (borné, pas tout l'annuaire) pour que la
// catégorisation de la relation (Prospect/Client/Partenaire…) se déduise des
// échanges réels dès l'intégration, pas seulement au prochain suivi manuel.
const INTEGRATION_CONTACTS_PER_COMPANY = 5
const INTEGRATION_ANALYSIS_CONCURRENCY = 3

async function topUntrackedContacts(workspaceId: string, companyId: string): Promise<string[]> {
  const { data } = await getSupabase().from('contacts')
    .select('id')
    .eq('organization_id', workspaceId)
    .eq('company_id', companyId)
    .eq('is_tracked', false)
    .is('merged_into_contact_id', null)
    .order('updated_at', { ascending: false })
    .limit(INTEGRATION_CONTACTS_PER_COMPANY)
  return (data ?? []).map((row) => String(row.id))
}

export async function trackCandidates(workspaceId: string, selection: Array<{ companyId: string | null; name: string; domain: string | null }>): Promise<void> {
  const client = getSupabase()
  const trackedCompanyIds: string[] = []
  for (const item of selection) {
    const { data: companyId, error } = await client.rpc('add_tracked_company', {
      p_organization_id: workspaceId,
      p_company_id: item.companyId,
      p_name: item.name,
      p_domain: item.domain,
    })
    if (error) throw error
    if (companyId) trackedCompanyIds.push(String(companyId))
  }
  void client.functions.invoke('monitor-company-news', {
    body: { organizationId: workspaceId, limit: Math.min(selection.length, 8) },
  })
  // Score immédiat (pas seulement au prochain cron 6h) : même moteur, même
  // formule — reconstruit aussi l'historique réel des contacts déjà
  // synchronisés de ces comptes (deepBackfill), comme au suivi d'une personne.
  void Promise.allSettled([
    client.functions.invoke('score-batch', { body: { organizationId: workspaceId } }),
    client.functions.invoke('score-batch', { body: { organizationId: workspaceId, deepBackfill: true } }),
  ])
  // Active + analyse les contacts les plus actifs de chaque compte (même appel
  // Gemini, même coût que trackPersonCandidate), puis ré-agrège une fois fait
  // pour que la suggestion de relation soit posée sans attendre le cron.
  void (async () => {
    const contactIds = (await Promise.all(trackedCompanyIds.map((companyId) => topUntrackedContacts(workspaceId, companyId)))).flat()
    if (!contactIds.length) return
    let index = 0
    const next = async (): Promise<void> => {
      const current = index++
      if (current >= contactIds.length) return
      await trackPersonCandidate(workspaceId, contactIds[current]!).catch(() => {})
      return next()
    }
    await Promise.all(Array.from({ length: Math.min(INTEGRATION_ANALYSIS_CONCURRENCY, contactIds.length) }, () => next()))
    void client.functions.invoke('score-batch', { body: { organizationId: workspaceId } })
  })()
}
