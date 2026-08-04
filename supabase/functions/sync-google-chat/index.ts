// Synchronise Google Chat : liste les espaces (DM + espaces nommés) et leurs
// messages (API Chat v1). L'API Chat n'expose que des noms d'affichage (jamais
// d'email), donc le rapprochement se fait PAR NOM :
//  - DM 1:1 : l'interlocuteur est créé s'il est inconnu, catégorisé « Collègue » ;
//  - espace nommé : on rattache seulement aux contacts déjà connus (pas de création
//    en masse). Les messages sont enregistrés comme interactions (métadonnées, sans
//    stocker le texte intégral — même doctrine que les emails).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number(Deno.env.get(name))
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

const LOOKBACK_DAYS = positiveIntegerEnv('CHAT_SYNC_LOOKBACK_DAYS', 30)
const MAX_SPACES = positiveIntegerEnv('CHAT_SYNC_MAX_SPACES', 60)
const MAX_MESSAGES_PER_SPACE = positiveIntegerEnv('CHAT_SYNC_MAX_MESSAGES', 200)

function normalizeName(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
  if (!clientId || !clientSecret) throw new Error('Secrets OAuth google manquants')
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  })
  if (!response.ok) throw new Error(`Rafraîchissement google refusé (${response.status})`)
  const data = await response.json()
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? refreshToken, expiresIn: Number(data.expires_in ?? 3600) }
}

async function chatGet(token: string, url: string): Promise<any | null> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) {
    // Compte Google perso ou API Chat non activée pour le Workspace : pas fatal.
    if (response.status === 403 || response.status === 404) return null
    throw new Error(`Google Chat API ${response.status}`)
  }
  return response.json()
}

type ChatSpace = { name: string; spaceType: string; displayName: string | null }

async function listSpaces(token: string): Promise<ChatSpace[]> {
  const spaces: ChatSpace[] = []
  let pageToken: string | null = null
  do {
    const url = `https://chat.googleapis.com/v1/spaces?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
    const page = await chatGet(token, url)
    if (!page) break
    for (const space of (page.spaces ?? []) as any[]) {
      spaces.push({ name: space.name, spaceType: space.spaceType ?? space.type ?? 'SPACE', displayName: space.displayName ?? null })
    }
    pageToken = page.nextPageToken ?? null
  } while (pageToken && spaces.length < MAX_SPACES)
  return spaces.slice(0, MAX_SPACES)
}

async function listMessages(token: string, spaceName: string, sinceIso: string): Promise<any[]> {
  const messages: any[] = []
  let pageToken: string | null = null
  const filter = encodeURIComponent(`createTime > "${sinceIso}"`)
  do {
    const url = `https://chat.googleapis.com/v1/${spaceName}/messages?pageSize=100&filter=${filter}&orderBy=${encodeURIComponent('createTime desc')}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
    const page = await chatGet(token, url)
    if (!page) break
    messages.push(...(page.messages ?? []))
    pageToken = page.nextPageToken ?? null
  } while (pageToken && messages.length < MAX_MESSAGES_PER_SPACE)
  return messages.slice(0, MAX_MESSAGES_PER_SPACE)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const startedAt = new Date().toISOString()
  let syncJobId: string | null = null
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Authentification requise' }, 401)
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const { data: { user }, error: userError } = await supabase.auth.getUser(authorization.replace('Bearer ', ''))
    if (userError || !user) return json({ error: 'Session invalide' }, 401)
    const { organizationId } = await request.json().catch(() => ({}))
    if (!organizationId) return json({ error: 'Paramètres invalides' }, 400)
    const { data: membership } = await supabase.from('memberships').select('id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle()
    if (!membership) return json({ error: 'Accès refusé' }, 403)
    const { data: connector } = await supabase.from('connectors').select('id,metadata').eq('organization_id', organizationId).eq('user_id', user.id).eq('provider', 'google').maybeSingle()
    if (!connector) return json({ error: 'Connecteur Google introuvable. Connecte Google Workspace d’abord.' }, 404)
    const { data: tokenRows, error: tokenError } = await supabase.rpc('get_oauth_tokens_server', { p_connector_id: connector.id })
    const oauth = tokenRows?.[0]
    if (tokenError || !oauth) return json({ error: 'Jetons OAuth absents. Reconnecte Google Workspace.' }, 401)

    const { data: job } = await supabase.from('sync_jobs').insert({
      organization_id: organizationId, connector_id: connector.id, user_id: user.id, provider: 'google',
      job_type: 'google_chat_sync', status: 'running', current_step: 'Connexion au fournisseur', progress: 10, started_at: startedAt, payload: {},
    }).select('id').single()
    syncJobId = job?.id ?? null

    let accessToken = oauth.access_token as string | null
    let refreshToken = oauth.refresh_token as string | null
    const expiresSoon = !oauth.expires_at || new Date(oauth.expires_at).getTime() < Date.now() + 90_000
    if ((!accessToken || expiresSoon) && refreshToken) {
      const refreshed = await refreshAccessToken(refreshToken)
      accessToken = refreshed.accessToken
      refreshToken = refreshed.refreshToken
      await supabase.rpc('store_oauth_tokens_server', { p_organization_id: organizationId, p_connector_id: connector.id, p_provider_account_id: oauth.provider_account_id, p_access_token: accessToken, p_refresh_token: refreshToken, p_expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString() })
    }
    if (!accessToken) throw new Error('Jeton OAuth indisponible')

    // Nom du titulaire du compte pour ne pas se créer soi-même comme contact.
    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
    const selfName = normalizeName(profile?.full_name ?? user.email)

    // Contacts déjà connus, indexés par nom (pour rattacher sans dupliquer).
    const { data: existingContacts } = await supabase.from('contacts')
      .select('id,full_name').eq('organization_id', organizationId).is('merged_into_contact_id', null)
    const contactByName = new Map<string, string>()
    for (const contact of (existingContacts ?? []) as any[]) {
      const key = normalizeName(contact.full_name)
      if (key && !contactByName.has(key)) contactByName.set(key, contact.id)
    }

    const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString()
    const spaces = await listSpaces(accessToken)
    if (syncJobId) await supabase.from('sync_jobs').update({ current_step: 'Lecture des conversations Google Chat', progress: 40 }).eq('id', syncJobId)

    let messagesSynced = 0
    let contactsCreated = 0
    let contactsMatched = 0
    const errors: string[] = []

    const resolveContact = async (displayName: string, allowCreate: boolean): Promise<string | null> => {
      const key = normalizeName(displayName)
      if (!key || key === selfName) return null
      const known = contactByName.get(key)
      if (known) { contactsMatched++; return known }
      if (!allowCreate) return null
      const { data: created, error: createError } = await supabase.from('contacts')
        .insert({ organization_id: organizationId, full_name: displayName.trim(), owner_user_id: user.id, is_tracked: true, email: null })
        .select('id').single()
      if (createError || !created) return null
      contactByName.set(key, created.id)
      // Nouveau contact issu de Chat → catégorisé « Collègue » (réglable à la main).
      await supabase.from('person_settings').upsert({
        organization_id: organizationId, contact_id: created.id, relationship_type: 'Collègue', updated_by: user.id, updated_at: new Date().toISOString(),
      }, { onConflict: 'organization_id,contact_id' })
      contactsCreated++
      return created.id
    }

    for (const space of spaces) {
      try {
        const isDm = space.spaceType === 'DIRECT_MESSAGE'
        const messages = await listMessages(accessToken, space.name, sinceIso)
        if (!messages.length) continue

        const { data: thread } = await supabase.from('communication_threads').upsert({
          organization_id: organizationId, provider: 'google_chat', external_thread_id: space.name,
          subject: space.displayName ?? (isDm ? 'Message direct' : 'Espace Google Chat'), updated_at: new Date().toISOString(),
        }, { onConflict: 'organization_id,provider,external_thread_id' }).select('id').single()
        if (!thread) continue

        for (const message of messages) {
          const sender = message.sender ?? {}
          if (sender.type && sender.type !== 'HUMAN') continue
          const senderName = normalizeName(sender.displayName)
          if (!senderName) continue
          const fromSelf = senderName === selfName
          // DM : on peut créer le contact inconnu ; espace nommé : rattachement seulement.
          const contactId = fromSelf ? null : await resolveContact(sender.displayName, isDm)
          if (!fromSelf && !contactId) continue

          const { error: messageError } = await supabase.from('communication_messages').upsert({
            organization_id: organizationId, thread_id: thread.id, contact_id: contactId, provider: 'google_chat',
            external_message_id: message.name, direction: fromSelf ? 'outbound' : 'inbound',
            sent_at: message.createTime ?? new Date().toISOString(),
            subject: space.displayName ?? (isDm ? 'Message direct' : 'Espace Google Chat'),
            body_text: null,
            metadata: { space_type: space.spaceType, sender: sender.displayName ?? null, analyzed_without_body_storage: true },
          }, { onConflict: 'organization_id,provider,external_message_id' })
          if (!messageError) messagesSynced++
        }
      } catch (spaceError) {
        errors.push(spaceError instanceof Error ? spaceError.message : String(spaceError))
      }
    }

    if (syncJobId) await supabase.from('sync_jobs').update({ current_step: 'Synchronisation terminée', progress: 100, status: 'succeeded', completed_at: new Date().toISOString(), payload: { messages: messagesSynced, contacts_created: contactsCreated, contacts_matched: contactsMatched, errors: errors.slice(0, 5) } }).eq('id', syncJobId)
    return json({ success: true, messages: messagesSynced, contactsCreated, contactsMatched, spaces: spaces.length, errors: errors.slice(0, 5) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Synchronisation impossible'
    if (syncJobId) {
      const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
      await supabase.from('sync_jobs').update({ status: 'failed', current_step: 'Échec de la synchronisation', error_code: 'GOOGLE_CHAT_SYNC_FAILED', error_message: message, completed_at: new Date().toISOString() }).eq('id', syncJobId)
    }
    return json({ error: message }, 500)
  }
})
