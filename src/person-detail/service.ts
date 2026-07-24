import { getSupabase } from '../lib/supabase'
import { buildPersonDetail, object, rows, text, type Row } from './mapping'
import type { PersonContactDetail, PersonDetailData, PersonRecommendationStatus } from './types'

type QueryResult = { data: unknown; error: { message?: string; code?: string } | null }

export const MEMORY_BUCKET = 'person-memory'

function optional(result: QueryResult, label: string, degraded: string[]): unknown {
  if (!result.error) return result.data
  if (['42P01', '42703', 'PGRST200', 'PGRST204', 'PGRST205'].includes(result.error.code ?? '') || /does not exist|schema cache/i.test(result.error.message ?? '')) {
    degraded.push(`${label} non configuré`)
    return null
  }
  throw new Error(result.error.message ?? `Impossible de charger ${label}.`)
}

export async function getPersonDetail(workspaceId: string, personId: string): Promise<PersonDetailData> {
  const client = getSupabase()
  const degradedReasons: string[] = []
  const userId = (await client.auth.getUser()).data.user?.id ?? ''

  const [
    contactResult, settingsResult, userSettingsResult, summaryResult, snapshotsResult,
    legacyScoresResult, legacyCareerResult, relationshipResult, cognitiveResult, behavioralResult,
    recommendationsResult, detailsResult, careerResult, memoryResult,
    participantsResult, messagesResult, connectorsResult, feedbackResult, lockResult,
    nameSuggestionResult, mergeSuggestionsResult,
  ] = await Promise.all([
    client.from('contacts').select('*,companies(*)').eq('organization_id', workspaceId).eq('id', personId).is('merged_into_contact_id', null).maybeSingle(),
    client.from('person_settings').select('*').eq('organization_id', workspaceId).eq('contact_id', personId).maybeSingle(),
    client.from('person_user_settings').select('*').eq('organization_id', workspaceId).eq('contact_id', personId).eq('user_id', userId).maybeSingle(),
    client.from('person_summaries').select('*').eq('organization_id', workspaceId).eq('contact_id', personId).order('generated_at', { ascending: false }).limit(1).maybeSingle(),
    client.from('person_relationship_score_snapshots').select('*').eq('organization_id', workspaceId).eq('contact_id', personId).order('computed_at', { ascending: false }).limit(48),
    // Snapshots quotidiens produits par le cron backend : 36 mois ≈ 1100 lignes.
    client.from('contact_score_history').select('*').eq('organization_id', workspaceId).eq('contact_id', personId).order('snapshot_date', { ascending: false }).limit(1200),
    client.from('contact_career_path').select('*').eq('organization_id', workspaceId).eq('contact_id', personId).order('start_date', { ascending: false }).limit(40),
    client.from('relationship_snapshots').select('*').eq('organization_id', workspaceId).eq('contact_id', personId).order('snapshot_date', { ascending: false }).limit(48),
    client.from('cognitive_profiles').select('*').eq('organization_id', workspaceId).eq('contact_id', personId).order('updated_at', { ascending: false }).limit(1),
    client.from('behavioral_signals').select('*').eq('organization_id', workspaceId).eq('contact_id', personId).order('observed_at', { ascending: false }).limit(60),
    client.from('person_recommendations').select('*').eq('organization_id', workspaceId).eq('contact_id', personId).order('priority', { ascending: false }).limit(30),
    client.from('person_contact_details').select('*').eq('organization_id', workspaceId).eq('contact_id', personId).order('created_at', { ascending: true }),
    client.from('person_career_entries').select('*').eq('organization_id', workspaceId).eq('contact_id', personId).order('started_at', { ascending: false }).limit(40),
    client.from('person_memory_entries').select('*').eq('organization_id', workspaceId).eq('contact_id', personId).order('created_at', { ascending: false }).limit(40),
    client.from('meeting_participants').select('meetings(id,title,starts_at,platform,meeting_type,company_id)').eq('contact_id', personId).limit(500),
    client.from('communication_messages').select('id,sent_at,direction,subject,provider').eq('organization_id', workspaceId).eq('contact_id', personId).order('sent_at', { ascending: false }).limit(500),
    client.from('connectors').select('provider,status,last_synced_at,metadata').eq('organization_id', workspaceId),
    client.from('signal_feedback').select('signal_id,verdict').eq('organization_id', workspaceId).eq('user_id', userId),
    client.from('resource_lock').select('locked_by').eq('organization_id', workspaceId).eq('subject_type', 'contact').eq('subject_id', personId).eq('lock_state', 'active').maybeSingle(),
    client.from('contact_name_suggestions').select('*').eq('organization_id', workspaceId).eq('contact_id', personId).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    client.from('contact_merge_suggestions').select('*').eq('organization_id', workspaceId).eq('status', 'pending').or(`contact_a_id.eq.${personId},contact_b_id.eq.${personId}`),
  ])

  if (contactResult.error) {
    if (contactResult.error.code === '42501') throw new Error('PERSON_FORBIDDEN')
    throw new Error(contactResult.error.message)
  }
  if (!contactResult.data) throw new Error('PERSON_NOT_FOUND')
  if (behavioralResult.error) throw new Error(behavioralResult.error.message)

  const contact = object(contactResult.data)
  const settings = object(optional(settingsResult, 'Réglages Personne', degradedReasons))
  const userSettings = object(optional(userSettingsResult, 'Favori et veille Personne', degradedReasons))
  const summaryRow = object(optional(summaryResult, 'Synthèse Personne', degradedReasons))
  const scoreSnapshots = rows(optional(snapshotsResult, 'Snapshots du score Personne', degradedReasons))
  const legacyScores = rows(optional(legacyScoresResult, 'Historique de score hérité', degradedReasons))
  const legacyCareer = rows(optional(legacyCareerResult, 'Parcours importé', degradedReasons))
  const relationshipSnapshots = rows(optional(relationshipResult, 'Snapshots relationnels', degradedReasons))
  const cognitiveProfiles = rows(optional(cognitiveResult, 'Profil cognitif', degradedReasons))
  const recommendations = rows(optional(recommendationsResult, 'Recommandations Personne', degradedReasons))
  const contactDetails = rows(optional(detailsResult, 'Coordonnées Personne', degradedReasons))
  const careerEntries = rows(optional(careerResult, 'Parcours Personne', degradedReasons))
  const memoryEntries = rows(optional(memoryResult, 'Mémoire Personne', degradedReasons))
  const participants = rows(optional(participantsResult, 'Réunions', degradedReasons))
  const messages = rows(optional(messagesResult, 'Emails', degradedReasons))
  const connectors = rows(optional(connectorsResult, 'Connecteurs', degradedReasons))
  const feedback = rows(optional(feedbackResult, 'Validation des signaux', degradedReasons))
  const lockRow = object(optional(lockResult, 'Verrou', degradedReasons))
  const nameSuggestionRow = object(optional(nameSuggestionResult, 'Suggestion de nom', degradedReasons))
  const mergeSuggestionRows = rows(optional(mergeSuggestionsResult, 'Suggestions de fusion', degradedReasons))

  const meetings = participants.map((row) => object(row.meetings)).filter((row) => row.id)

  const profileIds = new Set<string>()
  if (text(settings.primary_owner_user_id)) profileIds.add(String(settings.primary_owner_user_id))
  if (text(contact.owner_user_id)) profileIds.add(String(contact.owner_user_id))
  memoryEntries.forEach((row) => { if (text(row.author_user_id)) profileIds.add(String(row.author_user_id)) })
  const { data: profileData } = profileIds.size
    ? await client.from('profiles').select('id,full_name').in('id', [...profileIds])
    : { data: [] }
  const profileNames = new Map(rows(profileData).map((row) => [String(row.id), text(row.full_name) ?? 'Membre Tohu']))

  return buildPersonDetail({
    workspaceId,
    personId,
    userId,
    contact,
    company: object(contact.companies),
    settings,
    userSettings,
    summaryRow,
    scoreSnapshots,
    legacyScores,
    legacyCareer,
    relationshipSnapshots,
    cognitiveProfile: cognitiveProfiles[0] ?? {},
    behavioralSignals: rows(behavioralResult.data),
    recommendations,
    contactDetails,
    careerEntries,
    memoryEntries,
    meetings,
    messages,
    connectors,
    feedback,
    profileNames,
    degradedReasons,
    lockedBy: text(lockRow.locked_by),
    nameSuggestion: nameSuggestionRow.id ? nameSuggestionRow : null,
    mergeSuggestions: mergeSuggestionRows,
  })
}

/** Suggestion de nom trouvée par l'agent d'enrichissement ou une signature email —
 *  jamais appliquée sans ce clic (voir doctrine dans supabase/functions/monitor-contacts). */
export async function acceptPersonNameSuggestion(data: PersonDetailData, userId: string, suggestionId: string, suggestedFullName: string): Promise<void> {
  const client = getSupabase()
  const { error: nameError } = await client.from('contacts').update({ full_name: suggestedFullName }).eq('id', data.person.id)
  if (nameError) throw nameError
  const { error } = await client.from('contact_name_suggestions')
    .update({ status: 'accepted', resolved_at: new Date().toISOString(), resolved_by: userId }).eq('id', suggestionId)
  if (error) throw error
}

export async function dismissPersonNameSuggestion(userId: string, suggestionId: string): Promise<void> {
  const { error } = await getSupabase().from('contact_name_suggestions')
    .update({ status: 'dismissed', resolved_at: new Date().toISOString(), resolved_by: userId }).eq('id', suggestionId)
  if (error) throw error
}

/** La fiche actuellement ouverte (data.person.id) reste la fiche conservée — l'autre
 *  y est fusionnée via le RPC merge_contacts déjà utilisé par la dédup automatique. */
export async function acceptPersonMergeSuggestion(data: PersonDetailData, userId: string, suggestionId: string, otherContactId: string): Promise<void> {
  const client = getSupabase()
  const { error: mergeError } = await client.rpc('merge_contacts', { primary_id: data.person.id, secondary_id: otherContactId })
  if (mergeError) throw mergeError
  const { error } = await client.from('contact_merge_suggestions')
    .update({ status: 'accepted', resolved_at: new Date().toISOString(), resolved_by: userId }).eq('id', suggestionId)
  if (error) throw error
}

export async function dismissPersonMergeSuggestion(userId: string, suggestionId: string): Promise<void> {
  const { error } = await getSupabase().from('contact_merge_suggestions')
    .update({ status: 'dismissed', resolved_at: new Date().toISOString(), resolved_by: userId }).eq('id', suggestionId)
  if (error) throw error
}

/** Verrou SPEC-09 : masque la mémoire d'équipe de cette Personne aux non-autorisés.
 *  Seul l'auteur du verrou peut le lever (appliqué par la RLS, pas seulement côté client). */
export async function setPersonLock(data: PersonDetailData, userId: string, locked: boolean): Promise<void> {
  if (locked) {
    const { error } = await getSupabase().from('resource_lock').insert({
      organization_id: data.person.workspaceId,
      subject_type: 'contact',
      subject_id: data.person.id,
      locked_by: userId,
    })
    if (error) throw error
    return
  }
  const { error } = await getSupabase().from('resource_lock')
    .update({ lock_state: 'released', released_at: new Date().toISOString(), released_by: userId })
    .eq('organization_id', data.person.workspaceId)
    .eq('subject_type', 'contact')
    .eq('subject_id', data.person.id)
    .eq('lock_state', 'active')
    .eq('locked_by', userId)
  if (error) throw error
}

export async function setPersonFavorite(data: PersonDetailData, userId: string, favorite: boolean): Promise<void> {
  const { error } = await getSupabase().from('person_user_settings').upsert({
    organization_id: data.person.workspaceId,
    contact_id: data.person.id,
    user_id: userId,
    favorite,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,contact_id,user_id' })
  if (error) throw error
}

export async function setPersonWatch(data: PersonDetailData, userId: string, watchEnabled: boolean): Promise<void> {
  const { error } = await getSupabase().from('person_user_settings').upsert({
    organization_id: data.person.workspaceId,
    contact_id: data.person.id,
    user_id: userId,
    watch_enabled: watchEnabled,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,contact_id,user_id' })
  if (error) throw error
}

export async function setPersonRoles(data: PersonDetailData, userId: string, values: { relationshipType?: string | null; decisionRole?: string | null; relationshipRole?: string | null }): Promise<void> {
  const payload: Row = {
    organization_id: data.person.workspaceId,
    contact_id: data.person.id,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  }
  if (values.relationshipType !== undefined) payload.relationship_type = values.relationshipType
  if (values.decisionRole !== undefined) payload.decision_role = values.decisionRole
  if (values.relationshipRole !== undefined) payload.relationship_role = values.relationshipRole
  const { error } = await getSupabase().from('person_settings').upsert(payload, { onConflict: 'organization_id,contact_id' })
  if (error) throw error
}

export type PersonEnrichmentResult = { scanned: number; enriched: number; failed: number }
export type PersonCognitiveSyncResult = {
  providers: string[]
  messages: number
  peopleAnalyzed: number
  errors: string[]
}

/** invokeError : FunctionsHttpError.message est générique, le vrai détail est dans error.context. */
async function invokeError(error: unknown, fallback: string): Promise<Error> {
  const context = (error as { context?: Response })?.context
  const raw = context ? await context.clone().text().catch(() => '') : ''
  let detail: { error?: unknown; message?: unknown } | null = null
  try { detail = raw ? JSON.parse(raw) : null } catch { /* réponse Edge non JSON */ }
  if (detail?.error || detail?.message) return new Error(String(detail.error ?? detail.message))
  if (context?.status === 546) return new Error('La fonction de synchronisation a été interrompue par Supabase. Déploie la dernière version ciblée de sync-email-analysis puis réessaie.')
  if (context?.status === 500) return new Error(raw || 'Le moteur cognitif distant a échoué. Vérifie que la migration cognitive est appliquée et que la fonction est à jour.')
  if (error instanceof Error && /failed to fetch|network|timeout/i.test(error.message)) {
    return new Error('Connexion à Supabase interrompue. Vérifie le réseau puis relance la synchronisation.')
  }
  return error instanceof Error && !error.message.includes('non-2xx') ? error : new Error(fallback)
}

/** Bouton « Enrichir maintenant » de la fiche personne : réservé aux super admins
 *  (vérifié côté edge function, pas seulement côté UI). Force une recherche IA immédiate
 *  pour ce seul contact, sans attendre le prochain cycle planifié. */
export async function triggerPersonEnrichment(contactId: string): Promise<PersonEnrichmentResult> {
  const { data, error } = await getSupabase().functions.invoke('monitor-contacts', { body: { contactId } })
  if (error) throw await invokeError(error, 'Déclenchement de l’enrichissement impossible.')
  if (data?.error) throw new Error(String(data.error))
  return data as PersonEnrichmentResult
}

/** Relecture ciblée des échanges et recalcul du profil cognitif. Le contrôle
 * super-admin est répété dans l'edge function : masquer le bouton ne constitue
 * jamais le mécanisme d'autorisation. */
export async function triggerPersonCognitiveSync(data: PersonDetailData, userId: string): Promise<PersonCognitiveSyncResult> {
  const client = getSupabase()
  if (!userId) throw new Error('Session utilisateur introuvable.')
  const providersWithInteractions = data.sources
    .filter((source) => source.status === 'connected' && (source.interactionCount ?? 0) > 0)
    .map((source) => source.provider)
    .filter((provider) => provider === 'google' || provider === 'microsoft')
  const { data: connectors, error: connectorError } = await client.from('connectors')
    .select('provider')
    .eq('organization_id', data.person.workspaceId)
    .eq('user_id', userId)
    .eq('status', 'connected')
    .in('provider', providersWithInteractions.length ? providersWithInteractions : ['google', 'microsoft'])
  if (connectorError) throw connectorError
  if (!connectors?.length) throw new Error('Aucun connecteur Gmail ou Microsoft 365 actif pour ce compte.')

  const result: PersonCognitiveSyncResult = { providers: [], messages: 0, peopleAnalyzed: 0, errors: [] }
  for (const connector of connectors) {
    const provider = String(connector.provider)
    const { data: response, error } = await client.functions.invoke('sync-email-analysis', {
      body: {
        organizationId: data.person.workspaceId,
        provider,
        contactId: data.person.id,
      },
    })
    if (error || response?.error || response?.success === false) {
      const reason = response?.error
        ? String(response.error)
        : (await invokeError(error, `Synchronisation ${provider} impossible.`)).message
      result.errors.push(`${provider}: ${reason}`)
      continue
    }
    result.providers.push(provider)
    result.messages += Number(response?.messages ?? 0)
    result.peopleAnalyzed += Number(response?.peopleAnalyzed ?? 0)
    if (Array.isArray(response?.analysisErrors)) result.errors.push(...response.analysisErrors.map(String))
  }
  if (!result.providers.length) throw new Error(result.errors.join(' · ') || 'Synchronisation cognitive impossible.')
  return result
}

/** Supprime une personne de Tohu : archivage (réversible), pas de suppression
 *  physique — préserve l'historique réel (emails, réunions, signaux). */
export async function setPersonArchived(data: PersonDetailData, userId: string, archived: boolean): Promise<void> {
  const { error } = await getSupabase().from('person_settings').upsert({
    organization_id: data.person.workspaceId,
    contact_id: data.person.id,
    archived_at: archived ? new Date().toISOString() : null,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,contact_id' })
  if (error) throw error
}

export async function updatePersonRecommendationStatus(data: PersonDetailData, recommendationId: string, userId: string, status: PersonRecommendationStatus, dueAt?: string): Promise<void> {
  const now = new Date().toISOString()
  const values: Row = { status, updated_by: userId, updated_at: now }
  if (status === 'completed') { values.completed_at = now; values.completed_by = userId }
  if (status === 'dismissed') { values.dismissed_at = now; values.dismissed_by = userId }
  if (status === 'postponed' && dueAt) values.due_at = dueAt
  const { error } = await getSupabase().from('person_recommendations').update(values)
    .eq('organization_id', data.person.workspaceId).eq('contact_id', data.person.id).eq('id', recommendationId)
  if (error) throw error
}

export async function savePersonRecommendationFeedback(data: PersonDetailData, recommendationId: string, userId: string, feedbackType: 'useful' | 'incorrect', reason?: string): Promise<void> {
  const { error } = await getSupabase().from('person_recommendations').update({
    feedback_type: feedbackType,
    feedback_reason: reason ?? null,
    feedback_by: userId,
    feedback_at: new Date().toISOString(),
    updated_by: userId,
    updated_at: new Date().toISOString(),
  }).eq('organization_id', data.person.workspaceId).eq('contact_id', data.person.id).eq('id', recommendationId)
  if (error) throw error
}

export function validateContactDetail(type: PersonContactDetail['type'], value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return 'La valeur est requise.'
  if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) return 'Format d’email invalide.'
  if (type === 'phone' && !/^\+?[\d\s().-]{6,20}$/.test(trimmed)) return 'Format de téléphone invalide.'
  if ((type === 'linkedin' || type === 'website') && !/^https?:\/\/\S+\.\S+/.test(trimmed)) return 'URL invalide (https attendu).'
  return null
}

export async function addPersonContactDetail(data: PersonDetailData, userId: string, values: { type: PersonContactDetail['type']; value: string; label?: string | null; visibility?: 'private' | 'workspace' }): Promise<void> {
  const invalid = validateContactDetail(values.type, values.value)
  if (invalid) throw new Error(invalid)
  const { error } = await getSupabase().from('person_contact_details').insert({
    organization_id: data.person.workspaceId,
    contact_id: data.person.id,
    detail_type: values.type,
    value: values.value.trim(),
    label: values.label ?? null,
    visibility: values.visibility ?? 'workspace',
    source_type: 'manual',
    source_label: 'Saisie manuelle',
    inference_level: 'manual',
    created_by: userId,
    updated_by: userId,
  })
  if (error) throw error
}

export async function updatePersonContactDetail(data: PersonDetailData, userId: string, detail: PersonContactDetail, newValue: string): Promise<void> {
  const invalid = validateContactDetail(detail.type, newValue)
  if (invalid) throw new Error(invalid)
  const client = getSupabase()
  const { error } = await client.from('person_contact_details').update({
    value: newValue.trim(),
    verification_status: 'unverified',
    updated_by: userId,
    updated_at: new Date().toISOString(),
  }).eq('organization_id', data.person.workspaceId).eq('contact_id', data.person.id).eq('id', detail.id)
  if (error) throw error
  // Historisation de la correction (ancienne valeur + auteur).
  const { error: revisionError } = await client.from('person_contact_detail_revisions').insert({
    organization_id: data.person.workspaceId,
    contact_id: data.person.id,
    detail_id: detail.id,
    previous_value: detail.value,
    new_value: newValue.trim(),
    changed_by: userId,
  })
  if (revisionError) throw revisionError
}

export async function setPrimaryContactDetail(data: PersonDetailData, userId: string, detail: PersonContactDetail): Promise<void> {
  const client = getSupabase()
  const { error: resetError } = await client.from('person_contact_details').update({ is_primary: false, updated_by: userId })
    .eq('organization_id', data.person.workspaceId).eq('contact_id', data.person.id).eq('detail_type', detail.type)
  if (resetError) throw resetError
  const { error } = await client.from('person_contact_details').update({ is_primary: true, updated_by: userId })
    .eq('organization_id', data.person.workspaceId).eq('contact_id', data.person.id).eq('id', detail.id)
  if (error) throw error
}

export async function archivePersonContactDetail(data: PersonDetailData, userId: string, detailId: string): Promise<void> {
  const { error } = await getSupabase().from('person_contact_details').update({
    archived_at: new Date().toISOString(),
    updated_by: userId,
  }).eq('organization_id', data.person.workspaceId).eq('contact_id', data.person.id).eq('id', detailId)
  if (error) throw error
}

export async function addPersonNote(data: PersonDetailData, userId: string, content: string, entryType = 'note'): Promise<void> {
  const { error } = await getSupabase().from('person_memory_entries').insert({
    organization_id: data.person.workspaceId,
    contact_id: data.person.id,
    author_user_id: userId,
    entry_type: entryType,
    content,
    source_type: 'manual',
    source_label: 'Note d’équipe',
    inference_level: 'manual',
  })
  if (error) throw error
}

function storagePath(data: PersonDetailData, fileName: string): string {
  const safe = fileName.normalize('NFKD').replace(/[^\w.-]+/g, '-').slice(-80)
  return `${data.person.workspaceId}/${data.person.id}/${Date.now()}-${safe}`
}

export async function addPersonFile(data: PersonDetailData, userId: string, file: File): Promise<void> {
  const client = getSupabase()
  const path = storagePath(data, file.name)
  const { error: uploadError } = await client.storage.from(MEMORY_BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream' })
  if (uploadError) throw new Error(uploadError.message)
  const { error } = await client.from('person_memory_entries').insert({
    organization_id: data.person.workspaceId,
    contact_id: data.person.id,
    author_user_id: userId,
    entry_type: 'file',
    content: file.name,
    file_path: path,
    file_name: file.name,
    file_size: file.size,
    mime_type: file.type || null,
    source_type: 'manual',
    source_label: 'Fichier d’équipe',
    inference_level: 'manual',
  })
  if (error) throw error
}

export async function addPersonVoiceNote(data: PersonDetailData, userId: string, audio: Blob, durationSeconds: number): Promise<void> {
  const client = getSupabase()
  const extension = audio.type.includes('ogg') ? 'ogg' : audio.type.includes('mp4') ? 'm4a' : 'webm'
  const path = storagePath(data, `note-vocale-${durationSeconds}s.${extension}`)
  const { error: uploadError } = await client.storage.from(MEMORY_BUCKET).upload(path, audio, { contentType: audio.type || 'audio/webm' })
  if (uploadError) throw new Error(uploadError.message)
  const { error } = await client.from('person_memory_entries').insert({
    organization_id: data.person.workspaceId,
    contact_id: data.person.id,
    author_user_id: userId,
    entry_type: 'voice',
    content: `Note vocale · ${durationSeconds}s`,
    file_path: path,
    file_name: `note-vocale-${durationSeconds}s.${extension}`,
    file_size: audio.size,
    mime_type: audio.type || 'audio/webm',
    processing_status: 'pending_transcription',
    source_type: 'manual',
    source_label: 'Note vocale',
    inference_level: 'manual',
  })
  if (error) throw error
}

export async function setCareerVerification(data: PersonDetailData, userId: string, entryId: string, status: 'confirmed' | 'rejected'): Promise<void> {
  const { error } = await getSupabase().from('person_career_entries').update({
    verification_status: status,
    validated_by: userId,
    validated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('organization_id', data.person.workspaceId).eq('contact_id', data.person.id).eq('id', entryId)
  if (error) throw error
}
