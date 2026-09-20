import { formatPersonName } from '../lib/names'
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
    messagesResult, meetingsResult, signalsResult, teamResult, visionsResult,
  ] = await Promise.all([
    client.from('contacts').select('id,full_name,avatar_url,role_title,company_id,owner_user_id,linkedin_url,enrichment_data,tenure_start_date,created_at,companies(name,domain)').eq('organization_id', workspaceId).eq('is_tracked', true).is('merged_into_contact_id', null).limit(1000),
    client.rpc('v6_person_overview', { p_organization_id: workspaceId, p_user_id: userId }),
    client.from('person_settings').select('contact_id,relationship_type,primary_owner_user_id,archived_at').eq('organization_id', workspaceId),
    client.from('person_user_settings').select('contact_id,favorite,watch_enabled').eq('organization_id', workspaceId).eq('user_id', userId),
    client.from('communication_messages').select('contact_id,sent_at').eq('organization_id', workspaceId).eq('metadata->>user_id', userId).limit(3000),
    client.from('meetings').select('company_id,starts_at').eq('organization_id', workspaceId).eq('owner_user_id', userId).limit(1000),
    client.from('behavioral_signals').select('id,contact_id,signal_type,text,inference,source_type,observed_at,contacts(full_name)').eq('organization_id', workspaceId).order('observed_at', { ascending: false }).limit(24),
    client.rpc('get_team_vision_members', { p_organization_id: workspaceId }),
    client.from('fiche_visions').select('entity_id,owner_user_id,visibility').eq('organization_id', workspaceId).eq('entity_type', 'contact'),
  ])

  if (contactsResult.error) throw new Error(contactsResult.error.message)

  const contacts = rows(contactsResult.data)
  const scoreHistory = rows(optional(historyResult, 'États relationnels V6', degradedReasons)).map((row) => {
    const payload = object(row.payload)
    return { contact_id: row.contact_id, score: payload.score, snapshot_date: payload.observedAt }
  })
  const settings = rows(optional(settingsResult, 'Réglages Personne', degradedReasons))
  const userSettings = rows(optional(userSettingsResult, 'Favoris/veille Personne', degradedReasons))
  const messages = rows(optional(messagesResult, 'Emails', degradedReasons))
  const meetings = rows(optional(meetingsResult, 'Réunions', degradedReasons))
  const signals = rows(optional(signalsResult, 'Signaux comportementaux', degradedReasons))
  const profiles = rows(optional(teamResult, 'Équipe', degradedReasons))
  const visions = rows(optional(visionsResult, 'Visibilité des fiches', degradedReasons))

  const profileNames = new Map(profiles.map((profile) => [String(profile.id), text(profile.full_name) ?? 'Membre Tohu']))
  const team: TeamMember[] = profiles
    .map((profile) => ({ id: String(profile.id), name: text(profile.full_name) ?? 'Membre Tohu', avatarUrl: text(profile.avatar_url) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const people = buildPersonListRows({ contacts, scoreHistory, settings, userSettings, messages, meetings, profileNames, visions, now })

  return {
    workspaceId,
    generatedAt: now.toISOString(),
    degradedReasons,
    people,
    ticker: buildPersonTickerItems(signals),
    team,
  }
}

export type PersonCandidate = {
  contactId: string
  fullName: string
  email: string | null
  roleTitle: string | null
  companyId: string | null
  companyName: string | null
  interactions: number
  lastInteractionAt: string | null
  firstInteractionAt: string | null
  source: string
}

export async function detectPersonCandidates(workspaceId: string): Promise<PersonCandidate[]> {
  const { data, error } = await getSupabase().rpc('detect_person_candidates', {
    p_organization_id: workspaceId,
    p_limit: 100,
  })
  if (error) throw error
  return rows(object(data).candidates).map((candidate) => ({
    contactId: String(candidate.contact_id),
    fullName: formatPersonName(text(candidate.full_name)) ?? 'Personne détectée',
    email: text(candidate.email),
    roleTitle: text(candidate.role_title),
    companyId: text(candidate.company_id),
    companyName: text(candidate.company_name),
    interactions: Number(candidate.interactions ?? 0),
    lastInteractionAt: text(candidate.last_interaction_at),
    firstInteractionAt: text(candidate.first_interaction_at),
    source: text(candidate.source) ?? 'Connecteur',
  }))
}

export async function trackPersonCandidate(workspaceId: string, contactId: string): Promise<void> {
  const client = getSupabase()
  const { error } = await client.rpc('add_tracked_contact', {
    p_organization_id: workspaceId,
    p_contact_id: contactId,
  })
  if (error) throw error
  const userId = (await client.auth.getUser()).data.user?.id ?? ''
  const { error: ownerError } = await client.from('person_settings').upsert({
    organization_id: workspaceId,
    contact_id: contactId,
    primary_owner_user_id: userId,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,contact_id' })
  if (ownerError) throw ownerError
  const { error: visionError } = await client.rpc('set_fiche_vision_visibility', {
    p_organization_id: workspaceId,
    p_entity_type: 'contact',
    p_entity_id: contactId,
    p_visibility: 'workspace',
  })
  if (visionError) throw visionError
  const { data: connectors } = await client.from('connectors')
    .select('provider')
    .eq('organization_id', workspaceId)
    .eq('user_id', userId)
    .eq('status', 'connected')
    .in('provider', ['google', 'microsoft'])
  void Promise.allSettled([
    // La veille (monitor-contacts, appel IA) n'est plus déclenchée par l'ajout
    // d'une personne — elle reste une action explicite (bouton « Veille » des
    // listes Comptes/Personnes), jamais un effet de bord automatique.
    // Relecture ciblée sans limite de temps (au-delà des 2 ans de la découverte
    // générale) : va chercher tous les échanges réels avec ce contact dans la
    // boîte mail connectée, puis relance l'analyse IA du profil dessus. Le
    // Le corps des emails est désormais stocké en clair (depuis 2026-09-19) —
    // seul le déclenchement devient automatique ici, le stockage est géré par
    // sync-email-analysis lui-même.
    ...(connectors ?? []).map((row) =>
      client.functions.invoke('sync-email-analysis', { body: { organizationId: workspaceId, provider: row.provider, contactId } }),
    ),
  ])
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
  if (ownerId === userId) return
  const { error } = await getSupabase().rpc('handover_fiches', {
    p_organization_id: workspaceId,
    p_entity_type: 'contact',
    p_entity_ids: [contactId],
    p_to_user_id: ownerId,
    p_scope: 'entity_only',
    p_note: null,
  })
  if (error) throw error
}

/** Supprime une personne de Tohu : archivage (réversible), pas de suppression
 *  physique — préserve l'historique réel (emails, réunions, signaux). */
export async function setPersonArchived(workspaceId: string, contactId: string, userId: string, archived: boolean): Promise<void> {
  const client = getSupabase()
  const { error } = await client.from('person_settings').upsert({
    organization_id: workspaceId, contact_id: contactId, archived_at: archived ? new Date().toISOString() : null, updated_by: userId, updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,contact_id' })
  if (error) throw error
}

/** Suppression groupée : archive plusieurs personnes en une passe (réversible). */
export async function archivePeople(workspaceId: string, userId: string, contactIds: string[]): Promise<void> {
  if (!contactIds.length) return
  const client = getSupabase()
  const now = new Date().toISOString()
  const { error } = await client.from('person_settings').upsert(
    contactIds.map((contactId) => ({ organization_id: workspaceId, contact_id: contactId, archived_at: now, updated_by: userId, updated_at: now })),
    { onConflict: 'organization_id,contact_id' },
  )
  if (error) throw error
}

export type HandoverResult = { entities: number; people: number; skippedPeople: number }

/** Passation groupée atomique : le destinataire devient owner officiel, sa
 *  vision vide est créée et la vision de l'ancien owner lui reste accessible
 *  en lecture seule. */
export async function handoverPeople(workspaceId: string, people: PersonListRow[], toUserId: string): Promise<HandoverResult> {
  if (!people.length) return { entities: 0, people: 0, skippedPeople: 0 }
  const { data, error } = await getSupabase().rpc('handover_fiches', {
    p_organization_id: workspaceId,
    p_entity_type: 'contact',
    p_entity_ids: people.map((person) => person.id),
    p_to_user_id: toUserId,
    p_scope: 'entity_only',
    p_note: null,
  })
  if (error) throw error
  const result = object(data)
  return {
    entities: Number(result.entities ?? people.length),
    people: Number(result.people ?? 0),
    skippedPeople: Number(result.skipped_people ?? 0),
  }
}
