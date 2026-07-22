import { getSupabase } from '../lib/supabase'
import {
  buildAccountRows, buildPortfolioSeries, buildTickerItems, evolutionPercents,
  object, rows, text, num,
  type AccountListRow, type PortfolioPoint, type Row, type TeamMember, type TickerItem,
} from './mapping'

type QueryResult = { data: unknown; error: { message?: string; code?: string } | null }

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
    client.from('contact_score_history').select('contact_id,score,snapshot_date').eq('organization_id', workspaceId).order('snapshot_date', { ascending: false }).limit(8000),
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
  const series36 = buildPortfolioSeries(scoreHistory, contacts, 36, now)
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
    lastInteractionAt: text(row.last_interaction_at),
    source: text(row.source) ?? 'Messagerie connectée',
    alreadyTracked: row.already_tracked === true,
  }))
}

export async function trackCandidates(workspaceId: string, selection: Array<{ companyId: string | null; name: string; domain: string | null }>): Promise<void> {
  const client = getSupabase()
  for (const item of selection) {
    const { error } = await client.rpc('add_tracked_company', {
      p_organization_id: workspaceId,
      p_company_id: item.companyId,
      p_name: item.name,
      p_domain: item.domain,
    })
    if (error) throw error
  }
  void client.functions.invoke('monitor-company-news', {
    body: { organizationId: workspaceId, limit: Math.min(selection.length, 8) },
  })
}
