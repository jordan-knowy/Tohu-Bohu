import { getSupabase } from '../lib/supabase'
import type {
  AccountDetailData,
  AccountFirmographicFact,
  AccountMemoryEntry,
  AccountPerson,
  AccountRecommendation,
  AccountSignal,
  Provenance,
} from './types'

type Row = Record<string, unknown>
type QueryResult = { data: unknown; error: { message?: string; code?: string } | null }

const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null
const number = (value: unknown): number | null => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null
const bool = (value: unknown): boolean => value === true

function provenance(row: Row, defaults: Partial<Provenance> = {}): Provenance {
  return {
    sourceType: text(row.source_type) ?? defaults.sourceType ?? 'database',
    sourceId: text(row.source_id) ?? defaults.sourceId ?? null,
    sourceLabel: text(row.source_label) ?? defaults.sourceLabel ?? 'Donnée Tohu',
    sourceUrl: text(row.source_url) ?? defaults.sourceUrl ?? null,
    observedAt: text(row.observed_at) ?? defaults.observedAt ?? null,
    importedAt: text(row.imported_at) ?? defaults.importedAt ?? null,
    lastVerifiedAt: text(row.last_verified_at) ?? defaults.lastVerifiedAt ?? null,
    confidence: number(row.confidence) ?? defaults.confidence ?? null,
    inferenceLevel: text(row.inference_level) ?? defaults.inferenceLevel ?? null,
  }
}

function latestNested(value: unknown, dateKey: string): Row {
  return rows(value).sort((a, b) => String(b[dateKey] ?? '').localeCompare(String(a[dateKey] ?? '')))[0] ?? {}
}

function optional(result: QueryResult, label: string, degraded: string[]): unknown {
  if (!result.error) return result.data
  if (['42P01', '42703', 'PGRST200', 'PGRST204'].includes(result.error.code ?? '') || /does not exist|schema cache/i.test(result.error.message ?? '')) {
    degraded.push(`${label} non configuré`)
    return null
  }
  throw new Error(result.error.message ?? `Impossible de charger ${label}.`)
}

export async function getAccountDetail(workspaceId: string, accountId: string): Promise<AccountDetailData> {
  const client = getSupabase()
  const degradedReasons: string[] = []
  const currentUser = (await client.auth.getUser()).data.user
  const currentUserId = currentUser?.id ?? ''
  // Domaine interne de l'utilisateur (ex. optee.io) — sert à ne pas traiter sa
  // propre entreprise comme un compte à surveiller. (Retour testing P1.3.)
  const internalDomain = (currentUser?.email?.split('@')[1] ?? '').toLowerCase()
  const [
    accountResult, peopleResult, signalsResult, meetingsResult, settingsResult,
    preferenceResult, watchResult, scoreResult, rolesResult, recommendationsResult,
    memoryResult, factsResult, connectorsResult, feedbackResult, lockResult,
  ] = await Promise.all([
    client.from('companies').select('*').eq('organization_id', workspaceId).eq('id', accountId).eq('is_tracked', true).maybeSingle(),
    client.from('contacts').select('*,relationship_snapshots(engagement_score,phase,last_contact_at,snapshot_date),cognitive_profiles(global_confidence,updated_at)').eq('organization_id', workspaceId).eq('company_id', accountId).eq('is_tracked', true).is('merged_into_contact_id', null).limit(500),
    client.from('company_signals').select('*').eq('organization_id', workspaceId).eq('company_id', accountId).order('observed_at', { ascending: false }).limit(30),
    client.from('meetings').select('id,platform,starts_at').eq('organization_id', workspaceId).eq('company_id', accountId).order('starts_at', { ascending: false }).limit(500),
    client.from('account_settings').select('*').eq('organization_id', workspaceId).eq('company_id', accountId).maybeSingle(),
    client.from('account_user_preferences').select('*').eq('organization_id', workspaceId).eq('company_id', accountId).eq('user_id', currentUserId).maybeSingle(),
    client.from('account_watch_settings').select('*').eq('organization_id', workspaceId).eq('company_id', accountId).maybeSingle(),
    client.from('account_relationship_score_snapshots').select('*').eq('organization_id', workspaceId).eq('company_id', accountId).order('computed_at', { ascending: false }).limit(36),
    client.from('account_contact_roles').select('*').eq('organization_id', workspaceId).eq('company_id', accountId).eq('active', true),
    client.from('account_recommendations').select('*').eq('organization_id', workspaceId).eq('company_id', accountId).order('priority', { ascending: false }).limit(30),
    client.from('account_memory_entries').select('*').eq('organization_id', workspaceId).eq('company_id', accountId).order('created_at', { ascending: false }).limit(30),
    client.from('account_firmographic_facts').select('*').eq('organization_id', workspaceId).eq('company_id', accountId).order('observed_at', { ascending: false }).limit(100),
    client.from('connectors').select('provider,status,last_synced_at,metadata').eq('organization_id', workspaceId),
    client.from('signal_feedback').select('signal_id,verdict').eq('organization_id', workspaceId),
    client.from('resource_lock').select('locked_by').eq('organization_id', workspaceId).eq('subject_type', 'company').eq('subject_id', accountId).eq('lock_state', 'active').maybeSingle(),
  ])

  if (accountResult.error) throw new Error(accountResult.error.message)
  if (!accountResult.data) throw new Error('ACCOUNT_NOT_FOUND')
  if (peopleResult.error) throw new Error(peopleResult.error.message)
  if (signalsResult.error) throw new Error(signalsResult.error.message)
  if (meetingsResult.error) throw new Error(meetingsResult.error.message)

  const account = object(accountResult.data)
  const context = object(account.public_context)
  const settings = object(optional(settingsResult, 'Réglages Compte', degradedReasons))
  const preference = object(optional(preferenceResult, 'Favoris Compte', degradedReasons))
  const watch = object(optional(watchResult, 'Veille Compte', degradedReasons))
  const scoreRows = rows(optional(scoreResult, 'Snapshots du score Compte', degradedReasons))
  const roleRows = rows(optional(rolesResult, 'Rôles des interlocuteurs', degradedReasons))
  const recommendationRows = rows(optional(recommendationsResult, 'Recommandations Compte', degradedReasons))
  const memoryRows = rows(optional(memoryResult, 'Mémoire Compte', degradedReasons))
  const factRows = rows(optional(factsResult, 'Firmographie sourcée', degradedReasons))
  const connectorRows = rows(optional(connectorsResult, 'Connecteurs', degradedReasons))
  const feedbackRows = rows(optional(feedbackResult, 'Validation des signaux', degradedReasons))
  const lockRow = object(optional(lockResult, 'Verrou', degradedReasons))
  const roleByContact = new Map(roleRows.map((row) => [String(row.contact_id), row]))
  const feedbackBySignal = new Map(feedbackRows.map((row) => [String(row.signal_id), text(row.verdict)]))
  const profileIds = new Set<string>()
  if (text(settings.primary_owner_user_id)) profileIds.add(String(settings.primary_owner_user_id))
  roleRows.forEach((row) => { if (text(row.internal_owner_user_id)) profileIds.add(String(row.internal_owner_user_id)) })
  memoryRows.forEach((row) => { if (text(row.author_user_id)) profileIds.add(String(row.author_user_id)) })
  recommendationRows.forEach((row) => { if (text(row.assigned_to)) profileIds.add(String(row.assigned_to)) })
  const { data: profileData } = profileIds.size
    ? await client.from('profiles').select('id,full_name').in('id', [...profileIds])
    : { data: [] }
  const profileNames = new Map(rows(profileData).map((row) => [String(row.id), text(row.full_name) ?? 'Membre Tohu']))

  // Santé mensuelle reconstruite sur toute la vie de la relation (36 mois max) —
  // depuis le scoring réel des personnes du compte, pas seulement les snapshots
  // account récents. Dégrade silencieusement si la RPC n'est pas déployée.
  const healthResult = await client.rpc('account_health_monthly', { p_company_id: accountId, p_months: 36 })
  const monthlyHealth = Array.isArray(healthResult.data)
    ? (healthResult.data as Row[]).flatMap((row) => { const ym = text(row.ym); return ym ? [{ ym, score: number(row.score) }] : [] })
    : []

  const people: AccountPerson[] = rows(peopleResult.data).map((row) => {
    const snapshot = latestNested(row.relationship_snapshots, 'snapshot_date')
    const cognitive = latestNested(row.cognitive_profiles, 'updated_at')
    const role = roleByContact.get(String(row.id)) ?? {}
    return {
      id: String(row.id),
      name: text(row.full_name) ?? 'Contact',
      email: text(row.email),
      jobTitle: text(row.role_title),
      avatarUrl: text(row.avatar_url),
      organizationalRole: text(role.organizational_role),
      decisionRole: text(role.decision_role),
      relationshipRole: text(role.relationship_role),
      score: number(snapshot.engagement_score),
      phase: text(snapshot.phase),
      confidence: number(cognitive.global_confidence) ?? number(role.confidence),
      lastInteractionAt: text(snapshot.last_contact_at),
      exchangeShare: number(role.exchange_share),
      ownerName: profileNames.get(String(role.internal_owner_user_id)) ?? null,
      provenance: Object.keys(role).length ? provenance(role) : null,
    }
  })
  const peopleNames = new Map(people.map((person) => [person.id, person.name]))
  const latestScore = scoreRows[0] ?? {}
  const meetingRows = rows(meetingsResult.data)
  const meetingProviders = new Map<string, number>()
  meetingRows.forEach((row) => {
    const provider = text(row.platform)
    if (provider) meetingProviders.set(provider.toLowerCase(), (meetingProviders.get(provider.toLowerCase()) ?? 0) + 1)
  })

  const signals: AccountSignal[] = rows(signalsResult.data).map((row) => {
    const verdict = feedbackBySignal.get(String(row.id))
    return {
      id: String(row.id),
      type: text(row.family) ?? 'signal',
      title: text(row.title) ?? 'Signal à confirmer',
      summary: text(row.summary),
      impact: text(row.impact),
      personId: text(row.contact_id),
      validationStatus: verdict === 'confirmed' || verdict === 'dismissed' ? verdict : null,
      provenance: provenance(row, {
        sourceType: 'company_signal',
        sourceId: String(row.id),
        sourceLabel: text(row.source) ?? 'Veille Tohu',
        observedAt: text(row.observed_at),
        // company_signals.confidence est stocké 0-1 (colonne numeric(3,2)) —
        // converti ici en 0-100 pour confidenceLevel() (échelle utilisée partout
        // ailleurs dans l'app), sinon affiché à tort comme « confiance faible ».
        confidence: number(row.confidence) !== null ? Math.round(number(row.confidence)! * 100) : null,
        inferenceLevel: text(row.inference_level),
      }),
    }
  })

  const recommendations: AccountRecommendation[] = recommendationRows.map((row) => ({
    id: String(row.id),
    category: text(row.category) ?? 'relationnel',
    priority: number(row.priority) ?? 0,
    title: text(row.title) ?? 'Action à confirmer',
    justification: text(row.justification) ?? 'Justification indisponible.',
    recommendedAction: text(row.recommended_action),
    personId: text(row.contact_id),
    personName: peopleNames.get(String(row.contact_id)) ?? null,
    impactType: text(row.impact_type),
    dueAt: text(row.due_at),
    status: ['completed', 'dismissed', 'postponed'].includes(String(row.status)) ? row.status as AccountRecommendation['status'] : 'open',
    assignedTo: profileNames.get(String(row.assigned_to)) ?? null,
    provenance: provenance(row, {
      sourceType: 'recommendation',
      sourceLabel: text(row.source_label) ?? 'Moteur de recommandations Tohu',
      observedAt: text(row.observed_at),
      confidence: number(row.confidence),
      inferenceLevel: text(row.inference_level),
    }),
  }))

  const memoryEntries: AccountMemoryEntry[] = memoryRows.map((row) => ({
    id: String(row.id),
    entryType: text(row.entry_type) ?? 'note',
    content: text(row.content) ?? '',
    authorName: profileNames.get(String(row.author_user_id)) ?? 'Membre Tohu',
    visibility: text(row.visibility) ?? 'workspace',
    filePath: text(row.file_path),
    createdAt: text(row.created_at) ?? new Date().toISOString(),
    provenance: provenance(row, {
      sourceType: 'manual',
      sourceLabel: text(row.source_label) ?? 'Note d’équipe',
      observedAt: text(row.observed_at) ?? text(row.created_at),
      inferenceLevel: 'manual',
    }),
  }))

  const firmographics: AccountFirmographicFact[] = factRows.map((row) => ({
    id: String(row.id),
    key: text(row.fact_key) ?? 'information',
    value: row.value,
    validationStatus: text(row.validation_status) ?? 'unverified',
    provenance: provenance(row),
  }))

  // Tier 1 — filtre lecture (retours testing P1.3 + P1.4) :
  // • entreprise interne (même domaine que l'utilisateur) → ni veille ni recos ;
  // • veille du compte coupée → aucun signal de veille affiché.
  const accountDomain = (text(account.domain) ?? '').toLowerCase()
  const isInternalAccount = internalDomain !== '' && accountDomain !== '' && (accountDomain === internalDomain || accountDomain.endsWith('.' + internalDomain))
  const watchOn = bool(watch.enabled)
  const visibleSignals = (isInternalAccount || !watchOn) ? [] : signals
  const visibleRecommendations = isInternalAccount ? [] : recommendations

  return {
    generatedAt: new Date().toISOString(),
    degradedReasons,
    account: {
      id: accountId,
      workspaceId,
      name: text(account.name) ?? 'Compte',
      legalName: text(context.legal_name),
      logoUrl: text(context.logo_url),
      domain: text(account.domain),
      websiteUrl: text(context.website_url),
      description: text(context.description),
      sector: text(account.industry),
      accountType: text(account.account_type),
      relationshipStatus: text(settings.relationship_status) ?? text(context.status),
      relationshipStatusSource: text(settings.relationship_status_source),
      relationshipStartedAt: text(settings.relationship_started_at),
      offerScope: text(settings.offer_scope),
      favorite: bool(preference.favorite),
      watchEnabled: bool(watch.enabled),
      watchFamilies: Array.isArray(watch.families) ? watch.families.filter((item): item is string => typeof item === 'string') : [],
      strategic: bool(settings.strategic),
      archivedAt: text(settings.archived_at),
      location: text(context.location),
      tags: Array.isArray(context.tags) ? context.tags.filter((item): item is string => typeof item === 'string') : [],
      primaryOwnerName: profileNames.get(String(settings.primary_owner_user_id)) ?? null,
      locked: text(lockRow.locked_by) !== null,
      lockedByMe: text(lockRow.locked_by) === currentUserId,
    },
    relationship: {
      score: number(latestScore.score) ?? number(context.relationship_score),
      phase: ['growing', 'stable', 'declining'].includes(String(latestScore.phase)) ? latestScore.phase as 'growing' | 'stable' | 'declining' : 'unknown',
      phaseDelta: number(latestScore.phase_delta),
      confidence: number(latestScore.confidence) ?? number(context.confidence_score),
      computedAt: text(latestScore.computed_at),
      totalInteractions: number(latestScore.total_interactions) ?? meetingRows.length,
      lastInteractionAt: text(latestScore.last_interaction_at) ?? text(context.last_interaction_at) ?? text(meetingRows[0]?.starts_at),
      interactionFrequency30d: number(latestScore.interaction_frequency_30d),
      contactCoverage: number(latestScore.contact_coverage),
      decisionMakerCoverage: number(latestScore.decision_maker_coverage),
      concentrationRisk: number(latestScore.concentration_risk),
      // Composantes réelles du score (0,55 engagement + 0,25 couverture + 0,20 récence,
      // voir score-batch) — null pour les snapshots antérieurs à leur ajout, jamais inventées.
      engagementComponent: number(latestScore.engagement_component),
      recencyComponent: number(latestScore.recency_component),
      history: scoreRows.flatMap((row) => number(row.score) !== null && text(row.computed_at) ? [{ score: number(row.score)!, computedAt: text(row.computed_at)! }] : []).reverse(),
      monthlyHealth,
    },
    people,
    sources: connectorRows.map((row) => {
      const provider = text(row.provider) ?? 'source'
      return {
        provider,
        label: ({ google: 'Google Workspace', microsoft: 'Microsoft 365', linkedin: 'LinkedIn' } as Record<string, string>)[provider] ?? provider,
        status: text(row.status) ?? 'disconnected',
        lastSyncedAt: text(row.last_synced_at),
        interactionCount: meetingProviders.get(provider) ?? null,
        error: text(object(row.metadata).last_error),
      }
    }).filter((source) => source.status === 'connected' || source.status === 'error' || source.interactionCount !== null),
    recommendations: visibleRecommendations,
    signals: visibleSignals,
    memoryEntries,
    firmographics,
  }
}

export type AccountEnrichmentResult = { scanned: number; enriched: number; failed: number }

/** invokeError : FunctionsHttpError.message est générique, le vrai détail est dans error.context. */
async function invokeError(error: unknown, fallback: string): Promise<Error> {
  const detail = await (error as { context?: Response })?.context?.clone?.().json?.().catch(() => null)
  if (detail?.error) return new Error(String(detail.error))
  return error instanceof Error && !error.message.includes('non-2xx') ? error : new Error(fallback)
}

/** Bouton « Enrichir maintenant » de la fiche compte : réservé aux super admins
 *  (vérifié côté edge function, pas seulement côté UI). Force une recherche IA immédiate
 *  pour les contacts trackés de ce compte, sans attendre le prochain cycle planifié. */
export async function triggerAccountEnrichment(companyId: string): Promise<AccountEnrichmentResult> {
  const { data, error } = await getSupabase().functions.invoke('monitor-contacts', { body: { companyId } })
  if (error) throw await invokeError(error, 'Déclenchement de l’enrichissement impossible.')
  if (data?.error) throw new Error(String(data.error))
  return data as AccountEnrichmentResult
}

export async function setAccountFavorite(data: AccountDetailData, userId: string, favorite: boolean): Promise<void> {
  const { error } = await getSupabase().from('account_user_preferences').upsert({
    organization_id: data.account.workspaceId,
    company_id: data.account.id,
    user_id: userId,
    favorite,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,company_id,user_id' })
  if (error) throw error
}

export async function setAccountWatch(data: AccountDetailData, userId: string, enabled: boolean, families: string[]): Promise<void> {
  const { error } = await getSupabase().from('account_watch_settings').upsert({
    organization_id: data.account.workspaceId,
    company_id: data.account.id,
    enabled,
    families,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,company_id' })
  if (error) throw error
}

/** Supprime un compte de Tohu : archivage (réversible), pas de suppression
 *  physique — préserve l'historique réel (contacts, signaux, échanges). */
export async function setAccountArchived(data: AccountDetailData, userId: string, archived: boolean): Promise<void> {
  const client = getSupabase()
  const { error } = await client.from('account_settings').upsert({
    organization_id: data.account.workspaceId,
    company_id: data.account.id,
    archived_at: archived ? new Date().toISOString() : null,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,company_id' })
  if (error) throw error
  // Recalcul immédiat : un compte archivé/désarchivé doit sortir/rentrer du
  // score global sans attendre le prochain cron (le moteur exclut désormais
  // les comptes archivés — voir score-batch).
  void client.functions.invoke('score-batch', { body: { organizationId: data.account.workspaceId } })
}

/** Confirme/change la catégorie du compte (Prospect/Client/Partenaire/...) —
 *  toujours marquée 'manual' : le moteur relationnel (score-batch) ne retouche
 *  plus jamais ce champ une fois qu'un humain l'a choisi, même si l'IA suggère
 *  autre chose lors d'une prochaine analyse. */
export async function setAccountRelationType(data: AccountDetailData, userId: string, relationType: string): Promise<void> {
  const { error } = await getSupabase().from('account_settings').upsert({
    organization_id: data.account.workspaceId,
    company_id: data.account.id,
    relationship_status: relationType,
    relationship_status_source: 'manual',
    relationship_status_confidence: null,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,company_id' })
  if (error) throw error
}

/** Partage additif d'un compte avec un membre de l'organisation : l'expéditeur
 *  garde sa propre relation, le destinataire reçoit une vue en plus (jamais
 *  une réassignation exclusive — voir sharePerson pour le même principe côté
 *  fiche personne). Fondation de la future vue « entreprise ». */
export async function shareAccount(data: AccountDetailData, toUserId: string, note: string): Promise<void> {
  const { error } = await getSupabase().rpc('share_fiche', {
    p_organization_id: data.account.workspaceId,
    p_entity_type: 'company',
    p_entity_id: data.account.id,
    p_to_user_id: toUserId,
    p_note: note.trim() || null,
  })
  if (error) throw error
}

export type AccountRoleLabel = 'owner' | 'admin' | 'member'
export type AccountFicheShare = {
  id: string
  fromUserId: string
  fromName: string
  fromRole: AccountRoleLabel
  note: string | null
  createdAt: string
}

/** Partages reçus pour ce compte — qui me l'a partagé, et son rôle dans
 *  l'organisation (affiché comme petit titre Manager/Directeur/Collaborateur). */
export async function getAccountFicheSharesReceived(workspaceId: string, entityId: string): Promise<AccountFicheShare[]> {
  const { data, error } = await getSupabase().rpc('list_fiche_shares', {
    p_organization_id: workspaceId, p_entity_type: 'company', p_entity_id: entityId,
  })
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    fromUserId: String(row.from_user_id),
    fromName: String(row.from_name ?? 'Membre'),
    fromRole: (row.from_role === 'owner' || row.from_role === 'admin' ? row.from_role : 'member') as AccountRoleLabel,
    note: row.note ? String(row.note) : null,
    createdAt: String(row.created_at),
  }))
}

export type AccountVision = {
  organizationId: string
  companyId: string
  isMine: boolean
  ownerUserId: string
  ownerName: string
  shareNote: string | null
}

/** Visions disponibles pour le compte actuellement ouvert : la mienne si elle
 *  existe (appariée par domaine), plus tout ce qui m'a été partagé pour la
 *  même entreprise. Alimente le sélecteur « Moi | [Nom] » de la fiche compte. */
export async function listAccountVisions(workspaceId: string, accountId: string): Promise<AccountVision[]> {
  const { data, error } = await getSupabase().rpc('list_account_visions', {
    p_organization_id: workspaceId, p_company_id: accountId,
  })
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => ({
    organizationId: String(row.organization_id),
    companyId: String(row.company_id),
    isMine: Boolean(row.is_mine),
    ownerUserId: String(row.owner_user_id),
    ownerName: String(row.owner_name ?? 'Membre'),
    shareNote: row.share_note ? String(row.share_note) : null,
  }))
}

export type SharedAccountEntry = {
  organizationId: string
  entityId: string
  name: string
  domain: string | null
  industry: string | null
  fromUserId: string
  fromName: string
  note: string | null
  sharedAt: string
  alreadyMine: boolean
}

/** Fiches compte partagées à moi, quelle que soit l'organisation où elles
 *  vivent — mêmes raisons que listSharedWithMe côté fiche personne. */
export async function listSharedAccountsWithMe(): Promise<SharedAccountEntry[]> {
  const { data, error } = await getSupabase().rpc('list_shared_accounts_with_me')
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => ({
    organizationId: String(row.organization_id),
    entityId: String(row.entity_id),
    name: String(row.name ?? 'Sans nom'),
    domain: row.domain ? String(row.domain) : null,
    industry: row.industry ? String(row.industry) : null,
    fromUserId: String(row.from_user_id),
    fromName: String(row.from_name ?? 'Membre'),
    note: row.note ? String(row.note) : null,
    sharedAt: String(row.shared_at),
    alreadyMine: Boolean(row.already_mine),
  }))
}

/** Verrou SPEC-09 : masque le compte (mémoire, mêmes politiques à venir) aux
 *  non-autorisés. Seul l'auteur du verrou peut le lever (appliqué par la RLS
 *  resource_lock_owner_release, pas seulement côté client). */
export async function setAccountLock(data: AccountDetailData, userId: string, locked: boolean): Promise<void> {
  if (locked) {
    const { error } = await getSupabase().from('resource_lock').insert({
      organization_id: data.account.workspaceId,
      subject_type: 'company',
      subject_id: data.account.id,
      locked_by: userId,
    })
    if (error) throw error
    return
  }
  const { error } = await getSupabase().from('resource_lock')
    .update({ lock_state: 'released', released_at: new Date().toISOString(), released_by: userId })
    .eq('organization_id', data.account.workspaceId)
    .eq('subject_type', 'company')
    .eq('subject_id', data.account.id)
    .eq('lock_state', 'active')
    .eq('locked_by', userId)
  if (error) throw error
}

export async function updateRecommendationStatus(data: AccountDetailData, recommendationId: string, userId: string, status: 'completed' | 'dismissed' | 'postponed'): Promise<void> {
  const now = new Date().toISOString()
  const values: Row = { status, updated_by: userId, updated_at: now }
  if (status === 'completed') values.completed_at = now
  if (status === 'dismissed') values.dismissed_at = now
  const { error } = await getSupabase().from('account_recommendations').update(values).eq('organization_id', data.account.workspaceId).eq('company_id', data.account.id).eq('id', recommendationId)
  if (error) throw error
}

export async function addAccountNote(data: AccountDetailData, userId: string, content: string, entryType = 'note'): Promise<void> {
  const { error } = await getSupabase().from('account_memory_entries').insert({
    organization_id: data.account.workspaceId,
    company_id: data.account.id,
    author_user_id: userId,
    entry_type: entryType,
    content,
    source_type: 'manual',
    source_label: 'Note d’équipe',
    inference_level: 'manual',
  })
  if (error) throw error
}
