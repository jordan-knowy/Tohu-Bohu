import { getSupabase } from '../lib/supabase'
import {
  buildPersonListRows, buildPersonTickerItems,
  type PersonListRow, type Row, type TeamMember, type TickerItem,
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

const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null

export type PeopleOverview = {
  workspaceId: string
  generatedAt: string
  degradedReasons: string[]
  people: PersonListRow[]
  ticker: TickerItem[]
  team: TeamMember[]
}

export async function getPeopleOverview(workspaceId: string, userId: string): Promise<PeopleOverview> {
  const client = getSupabase()
  const degradedReasons: string[] = []
  const now = new Date()

  const [
    contactsResult, historyResult, settingsResult, userSettingsResult,
    messagesResult, meetingsResult, signalsResult, membershipsResult, profilesResult,
  ] = await Promise.all([
    client.from('contacts').select('id,full_name,avatar_url,role_title,company_id,owner_user_id,linkedin_url,enrichment_data,tenure_start_date,created_at,companies(name),cognitive_profiles(engagement_score,updated_at),relationship_snapshots(last_contact_at)').eq('organization_id', workspaceId).is('merged_into_contact_id', null).limit(1000),
    client.from('contact_score_history').select('contact_id,score,snapshot_date').eq('organization_id', workspaceId).order('snapshot_date', { ascending: false }).limit(8000),
    client.from('person_settings').select('contact_id,relationship_type,primary_owner_user_id,archived_at').eq('organization_id', workspaceId),
    client.from('person_user_settings').select('contact_id,favorite,watch_enabled').eq('organization_id', workspaceId).eq('user_id', userId),
    client.from('communication_messages').select('contact_id,sent_at').eq('organization_id', workspaceId).limit(3000),
    client.from('meetings').select('company_id,starts_at').eq('organization_id', workspaceId).limit(1000),
    client.from('behavioral_signals').select('id,contact_id,signal_type,text,inference,source_type,observed_at,contacts(full_name)').eq('organization_id', workspaceId).order('observed_at', { ascending: false }).limit(24),
    client.from('memberships').select('user_id').eq('organization_id', workspaceId),
    client.from('profiles').select('id,full_name,avatar_url'),
  ])

  if (contactsResult.error) throw new Error(contactsResult.error.message)

  const contacts = rows(contactsResult.data)
  const scoreHistory = rows(optional(historyResult, 'Historique de score', degradedReasons))
  const settings = rows(optional(settingsResult, 'Réglages Personne', degradedReasons))
  const userSettings = rows(optional(userSettingsResult, 'Favoris/veille Personne', degradedReasons))
  const messages = rows(optional(messagesResult, 'Emails', degradedReasons))
  const meetings = rows(optional(meetingsResult, 'Réunions', degradedReasons))
  const signals = rows(optional(signalsResult, 'Signaux comportementaux', degradedReasons))
  const memberships = rows(optional(membershipsResult, 'Équipe', degradedReasons))
  const profiles = rows(optional(profilesResult, 'Profils', degradedReasons))

  const profileNames = new Map(profiles.map((profile) => [String(profile.id), text(profile.full_name) ?? 'Membre Tohu']))
  const memberIds = new Set(memberships.map((membership) => String(membership.user_id)))
  const team: TeamMember[] = profiles
    .filter((profile) => memberIds.has(String(profile.id)))
    .map((profile) => ({ id: String(profile.id), name: text(profile.full_name) ?? 'Membre Tohu', avatarUrl: text(profile.avatar_url) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const people = buildPersonListRows({ contacts, scoreHistory, settings, userSettings, messages, meetings, profileNames, now })

  return {
    workspaceId,
    generatedAt: now.toISOString(),
    degradedReasons,
    people,
    ticker: buildPersonTickerItems(signals),
    team,
  }
}

export async function setPersonFavorite(workspaceId: string, contactId: string, userId: string, favorite: boolean): Promise<void> {
  const { error } = await getSupabase().from('person_user_settings').upsert({
    organization_id: workspaceId, contact_id: contactId, user_id: userId, favorite, updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,contact_id,user_id' })
  if (error) throw error
}

export async function setPersonWatch(workspaceId: string, contactId: string, userId: string, enabled: boolean): Promise<void> {
  const { error } = await getSupabase().from('person_user_settings').upsert({
    organization_id: workspaceId, contact_id: contactId, user_id: userId, watch_enabled: enabled, updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,contact_id,user_id' })
  if (error) throw error
}

export async function setPersonOwner(workspaceId: string, contactId: string, userId: string, ownerId: string): Promise<void> {
  const { error } = await getSupabase().from('person_settings').upsert({
    organization_id: workspaceId, contact_id: contactId, primary_owner_user_id: ownerId, updated_by: userId, updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,contact_id' })
  if (error) throw error
}

/** Supprime une personne de Tohu : archivage (réversible), pas de suppression
 *  physique — préserve l'historique réel (emails, réunions, signaux). */
export async function setPersonArchived(workspaceId: string, contactId: string, userId: string, archived: boolean): Promise<void> {
  const { error } = await getSupabase().from('person_settings').upsert({
    organization_id: workspaceId, contact_id: contactId, archived_at: archived ? new Date().toISOString() : null, updated_by: userId, updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,contact_id' })
  if (error) throw error
}

/** Passation : réattribue l'owner des personnes sélectionnées et historise
 *  chaque transfert dans contact_transfers. */
export async function reassignPeople(workspaceId: string, people: PersonListRow[], toUserId: string, byUserId: string): Promise<{ transferred: number; logged: boolean }> {
  const client = getSupabase()
  const toMove = people.filter((person) => person.ownerId !== toUserId)
  for (const person of toMove) await setPersonOwner(workspaceId, person.id, byUserId, toUserId)
  if (!toMove.length) return { transferred: 0, logged: true }

  const { error: updateError } = await client.from('contacts').update({ owner_user_id: toUserId })
    .eq('organization_id', workspaceId).in('id', toMove.map((person) => person.id))
  if (updateError) throw updateError

  const { error: logError } = await client.from('contact_transfers').insert(toMove.map((person) => ({
    organization_id: workspaceId,
    contact_id: person.id,
    from_user_id: person.ownerId,
    to_user_id: toUserId,
    kept_copy: false,
    transferred_by: byUserId,
  })))
  return { transferred: toMove.length, logged: !logError }
}
