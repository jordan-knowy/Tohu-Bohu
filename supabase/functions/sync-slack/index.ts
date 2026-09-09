import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { analyze, persistContactProfile, sanitizeBody } from '../_shared/behavior-analysis.ts'
import { slackApi, SlackError, REAUTH_ERRORS, conversationTypes, isPrivateConversation, authoredMessage, messageKey } from '../_shared/slack.ts'
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } })
const checked = async (query: any) => { const result = await query; if (result.error) throw new Error(result.error.message); return result.data }
const positiveIntegerEnv = (name: string, fallback: number) => {
  const value = Number(Deno.env.get(name) ?? fallback)
  return Number.isInteger(value) && value > 0 ? value : fallback
}
const INITIAL_LOOKBACK_DAYS = positiveIntegerEnv('SLACK_INITIAL_LOOKBACK_DAYS', 90)
const SYNC_MAX_MESSAGES = positiveIntegerEnv('SLACK_SYNC_MAX_MESSAGES', 1000)
const syncProgress = (state: any) => state?.phase === 'done' ? 100
  : state?.phase === 'users' ? 2
  : state?.phase === 'channels' ? 5
  : Math.min(95, 10 + Math.round((Number(state?.index ?? 0) / Math.max(1, Number(state?.channels?.length ?? 0))) * 85))
// One API page per invocation: durable checkpoints survive function deadlines and 429s.
// The UI drives continuations and can be closed/reopened without losing progress.
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const started = Date.now()
  let connector: any, state: any, lease: string | null = null
  try {
    const { data: { user } } = await db.auth.getUser((req.headers.get('Authorization') ?? '').replace('Bearer ', ''))
    if (!user) return json({ error: 'Session invalide' }, 401)
    const { organizationId } = await req.json()
    if (!await checked(db.from('memberships').select('id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle())) return json({ error: 'Accès refusé' }, 403)
    connector = await checked(db.from('connectors').select('*').eq('organization_id', organizationId).eq('user_id', user.id).eq('provider', 'slack').single())
    if (!['connected', 'error'].includes(connector.status)) return json({ error: 'Reconnecte Slack pour continuer.' }, 401)
    lease = crypto.randomUUID()
    if (!await checked(db.rpc('claim_connector_sync', { p_connector_id: connector.id, p_lease_id: lease }))) { lease = null; return json({ pending: true, retryAfter: 5 }) }
    const saved = await checked(db.from('connector_sync_state').select('state').eq('connector_id', connector.id).single())
    state = saved.state
    // Les checkpoints créés avant l'introduction de la fenêtre de 90 jours
    // parcouraient tout l'historique. Ils sont redémarrés une seule fois.
    if (state.policyVersion !== 2) state = {}
    if (state.retryAt && state.retryAt > Date.now()) return json({ pending: true, retryAfter: Math.ceil((state.retryAt - Date.now()) / 1000) })
    const tokens = await checked(db.rpc('get_oauth_tokens_server', { p_connector_id: connector.id }))
    const oauth = tokens?.[0]
    if (!oauth?.access_token) throw new SlackError('invalid_auth')
    let token = oauth.access_token
    if (oauth.expires_at && new Date(oauth.expires_at).getTime() < Date.now() + 90000) {
      if (!oauth.refresh_token) throw new SlackError('token_expired')
      const clientId = Deno.env.get('SLACK_CLIENT_ID')
      const clientSecret = Deno.env.get('SLACK_CLIENT_SECRET')
      if (!clientId || !clientSecret) throw new SlackError('invalid_refresh_token')
      const response = await fetch('https://slack.com/api/oauth.v2.access', { method: 'POST', body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: oauth.refresh_token }), signal: AbortSignal.timeout(20000) })
      if (response.status === 429) throw new SlackError('ratelimited', Number(response.headers.get('Retry-After')) || 60)
      const refreshed = await response.json()
      if (!response.ok || !refreshed.ok) throw new SlackError(refreshed.error ?? 'refresh_failed')
      token = refreshed.access_token
      await checked(db.rpc('store_oauth_tokens_server', { p_organization_id: organizationId, p_connector_id: connector.id, p_provider_account_id: oauth.provider_account_id, p_access_token: token, p_refresh_token: refreshed.refresh_token, p_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString() }))
    }
    if (!state.phase || state.phase === 'done') {
      const job = await checked(db.from('sync_jobs').insert({ organization_id: organizationId, connector_id: connector.id, user_id: user.id, provider: 'slack', job_type: 'slack_sync', status: 'running', current_step: 'Lecture des utilisateurs Slack', progress: 0, started_at: new Date().toISOString(), payload: {} }).select('id').single())
      const now = Date.now()
      state = { policyVersion: 2, phase: 'users', cursor: '', users: {}, channels: [], index: 0, threads: state.threads ?? {}, threadAuthors: state.threadAuthors ?? {}, watermarks: state.watermarks ?? {}, since: state.until ?? String((now - INITIAL_LOOKBACK_DAYS * 86400000) / 1000), until: String(now / 1000), messages: 0, jobId: job.id }
      await checked(db.from('connector_sync_state').update({ state }).eq('connector_id', connector.id))
    }
    const nextCursor = (page: any) => page.response_metadata?.next_cursor?.trim() ?? ''
    if (state.phase === 'users') {
      const page = await slackApi(token, 'users.list', { limit: '200', cursor: state.cursor })
      for (const member of page.members ?? []) {
        if (!member.is_bot && !member.deleted && member.id !== 'USLACKBOT') state.users[member.id] = { name: member.profile?.real_name ?? member.real_name ?? member.name, email: member.profile?.email ?? null }
      }
      state.cursor = nextCursor(page)
      if (!state.cursor) state.phase = 'channels'
    } else if (state.phase === 'channels') {
      const types = conversationTypes(connector.scopes ?? [])
      if (!types) throw new SlackError('missing_scope')
      const page = await slackApi(token, 'users.conversations', { types, limit: '200', cursor: state.cursor, exclude_archived: 'false' })
      for (const channel of page.channels ?? []) {
        if (!state.channels.some((item: any) => item.id === channel.id)) state.channels.push({ id: channel.id, name: channel.name ?? 'Conversation Slack', private: isPrivateConversation(channel), updated: Number(channel.updated ?? channel.created ?? 0) })
      }
      state.cursor = nextCursor(page)
      if (!state.cursor) {
        // Les canaux publics les plus récemment actifs sont traités en premier.
        // Les conversations privées ne participent pas à l'enrichissement externe.
        state.channels = state.channels.filter((channel: any) => !channel.private).sort((left: any, right: any) => right.updated - left.updated)
        state.phase = 'history'
      }
    } else if (state.index < state.channels.length) {
      const channel = state.channels[state.index]
      const restricted = channel.private || !connector.metadata.share_public
      const team = connector.metadata.team_id
      const prefix = restricted ? `${user.id}:` : ''
      const threadTs = state.replyQueue?.[0]
      const method = state.phase === 'replies' ? 'conversations.replies' : 'conversations.history'
      let page: any
      try {
        page = await slackApi(token, method, { channel: channel.id, limit: '15', oldest: state.watermarks?.[channel.id] ?? state.since, latest: state.until, inclusive: 'false', cursor: state.cursor, ...(threadTs ? { ts: threadTs } : {}) })
      } catch (error) {
        if (error instanceof SlackError && ['channel_not_found', 'not_in_channel', 'missing_scope', 'thread_not_found', 'is_archived'].includes(error.code)) {
          // Surface skipped conversations, without names of private channels in shared jobs.
          state.skipped = (state.skipped ?? 0) + 1
          if (error.code !== 'thread_not_found') state.channelSkipped = true
          else state.threads[channel.id] = (state.threads[channel.id] ?? []).filter((ts: string) => ts !== threadTs)
          page = { messages: [], response_metadata: {} }
        } else throw error
      }
      const remaining = Math.max(0, SYNC_MAX_MESSAGES - state.messages)
      const selectedMessages = (page.messages ?? []).filter(authoredMessage).slice(0, remaining)
      for (const message of selectedMessages) {
        if (Date.now() - started > 40000) {
          // Replay this same page; successfully analyzed messages carry an idempotency marker.
          await checked(db.from('connector_sync_state').update({ state }).eq('connector_id', connector.id).eq('lease_id', lease))
          return json({ pending: true, messages: state.messages })
        }
        if (message.reply_count > 0) {
          const roots: string[] = state.threads[channel.id] ?? []
          if (!roots.includes(message.ts)) roots.push(message.ts)
          state.threads[channel.id] = roots
        }
        state.threadAuthors ??= {}
        if (!message.thread_ts || message.thread_ts === message.ts) state.threadAuthors[`${channel.id}:${message.ts}`] = message.user
        const fromSelf = message.user === connector.metadata.slack_user_id
        const mentions = [...new Set<string>([...String(message.text ?? '').matchAll(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g)].map(match => match[1]))].filter(id => id !== connector.metadata.slack_user_id)
        // Attribute outbound messages only to an explicit recipient or thread author.
        const recipient = mentions.length === 1 ? mentions[0] : mentions.length === 0 ? state.threadAuthors[`${channel.id}:${message.thread_ts}`] : null
        const sender = state.users[fromSelf ? recipient : message.user]
        let contact: any = null
        if (!restricted && sender?.email) {
          // The same identity RPC as HubSpot handles canonical email, aliases and merges.
          const domain = sender.email.trim().toLowerCase().split('@')[1]
          const company = domain ? await checked(db.from('companies').select('id').eq('organization_id', organizationId).eq('normalized_domain', domain).maybeSingle()) : null
          const resolved = await checked(db.rpc('resolve_contact_identity', { p_organization_id: organizationId, p_email: sender.email, p_full_name: sender.name, p_company_id: company?.id ?? null, p_owner_user_id: user.id, p_source: 'slack' }).maybeSingle())
          if (resolved?.contact_id) contact = await checked(db.from('contacts').select('id,full_name,company_id').eq('id', resolved.contact_id).single())
        }
        const externalId = prefix + messageKey(team, channel.id, message.ts)
        const previous = await checked(db.from('communication_messages').select('id,metadata').eq('organization_id', organizationId).eq('provider', 'slack').eq('external_message_id', externalId).maybeSingle())
        const permalink = previous?.metadata?.permalink ?? (await slackApi(token, 'chat.getPermalink', { channel: channel.id, message_ts: message.ts })).permalink
        if (typeof permalink !== 'string' || !/^https:\/\/[^/]+\.slack\.com\//.test(permalink)) throw new Error('Référence Slack indisponible')
        const root = message.thread_ts ?? message.ts
        const thread = await checked(db.from('communication_threads').upsert({ organization_id: organizationId, provider: 'slack', external_thread_id: prefix + messageKey(team, channel.id, root), subject: channel.name, source_owner_user_id: restricted ? user.id : null, updated_at: new Date().toISOString() }, { onConflict: 'organization_id,provider,external_thread_id' }).select('id').single())
        const metadata = { ...previous?.metadata, team_id: team, channel_id: channel.id, ts: message.ts, thread_ts: root, permalink, sender_id: message.user, mentioned_user_ids: mentions, user_id: user.id, connector_id: connector.id, company_id: contact?.company_id ?? null, private: restricted, analyzed_without_body_storage: true }
        await checked(db.from('communication_messages').upsert({ organization_id: organizationId, provider: 'slack', external_message_id: externalId, thread_id: thread.id, contact_id: restricted ? null : contact?.id ?? null, source_owner_user_id: restricted ? user.id : null, direction: fromSelf ? 'outbound' : 'inbound', sent_at: new Date(Number(message.ts) * 1000).toISOString(), subject: channel.name, body_text: null, metadata }, { onConflict: 'organization_id,provider,external_message_id' }).select('id').single())
        // Autorisation utilisateur explicite : seuls les messages entrants des
        // canaux publics peuvent alimenter le pipeline partagé. Les MP et canaux
        // privés restent sans contact, sans corps stocké et sans appel au modèle.
        if (!restricted && contact && !fromSelf && message.text && !previous?.metadata?.slack_analyzed) {
          const profile = await checked(db.from('cognitive_profiles').select('cognitive_profile_data,source_message_count,source_meeting_count,source_interaction_count,updated_from').eq('organization_id', organizationId).eq('contact_id', contact.id).eq('profile_version', 1).maybeSingle())
          const counted = await db.from('communication_messages').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('contact_id', contact.id).eq('direction', 'inbound')
          if (counted.error) throw new Error(counted.error.message)
          const messageCount = counted.count ?? 0
          const observedAt = new Date(Number(message.ts) * 1000).toISOString()
          const result = await analyze(contact.full_name, 'contact', [`[slack ${observedAt} ${metadata.permalink}] ${sanitizeBody(message.text)}`], profile?.cognitive_profile_data ?? {}, messageCount + (profile?.source_meeting_count ?? 0), { client: db, organizationId, userId: user.id }, AbortSignal.timeout(35000))
          await persistContactProfile(db, { organizationId, contactId: contact.id, result, messageCount, meetingCount: profile?.source_meeting_count ?? 0, interactionCount: messageCount + (profile?.source_meeting_count ?? 0), updatedFrom: [...new Set<string>([...(profile?.updated_from ?? []), 'slack'])], signalSource: 'slack', sourceRef: metadata.permalink, observedAt })
          await checked(db.from('communication_messages').update({ metadata: { ...metadata, slack_analyzed: true } }).eq('organization_id', organizationId).eq('provider', 'slack').eq('external_message_id', externalId))
        }
      }
      state.messages += selectedMessages.length
      if (state.messages >= SYNC_MAX_MESSAGES) {
        state.truncated = true
        state.phase = 'done'
      }
      state.cursor = nextCursor(page)
      if (page.has_more && !state.cursor) throw new Error('Pagination Slack incomplète : aucun curseur reçu')
      if (state.phase !== 'done' && !state.cursor) {
        if (state.phase === 'history') {
          // Revisit ALL known roots: replies to old messages are not in history.
          state.replyQueue = [...(state.threads[channel.id] ?? [])]
          state.phase = 'replies'
        } else state.replyQueue.shift()
        if (!state.replyQueue.length) {
          state.watermarks ??= {}
          if (!state.channelSkipped) state.watermarks[channel.id] = state.until
          state.channelSkipped = false
          state.index++
          state.phase = 'history'
        }
      }
    }
    const complete = state.phase === 'done' || (state.phase === 'history' && state.index >= state.channels.length)
    if (complete) state.phase = 'done'
    state.retryAt = null
    await checked(db.from('connector_sync_state').update({ state }).eq('connector_id', connector.id).eq('lease_id', lease))
    await checked(db.from('sync_jobs').update({ status: complete ? 'succeeded' : 'running', current_step: complete ? 'Synchronisation Slack terminée' : 'Lecture des conversations Slack', progress: complete ? 100 : Math.min(95, Math.floor(state.index / Math.max(1, state.channels.length) * 90)), completed_at: complete ? new Date().toISOString() : null, payload: { messages: state.messages, skipped: state.skipped ?? 0, truncated: state.truncated ?? false, lookback_days: INITIAL_LOOKBACK_DAYS, message_limit: SYNC_MAX_MESSAGES }, error_message: null }).eq('id', state.jobId))
    await checked(db.from('connectors').update({ status: 'connected', ...(complete ? { last_synced_at: new Date().toISOString() } : {}), metadata: { ...connector.metadata, last_error: state.skipped ? `${state.skipped} conversation(s) ou fil(s) inaccessible(s).` : null } }).eq('id', connector.id))
    return json({ success: true, pending: !complete, progress: syncProgress(state), messages: state.messages, skipped: state.skipped ?? 0, truncated: state.truncated ?? false })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Synchronisation Slack impossible'
    if (connector && state && lease) {
      if (error instanceof SlackError && error.retryAfter) {
        state.retryAt = Date.now() + error.retryAfter * 1000
        await checked(db.from('connector_sync_state').update({ state }).eq('connector_id', connector.id).eq('lease_id', lease))
        return json({ pending: true, retryAfter: error.retryAfter, progress: syncProgress(state), messages: state.messages ?? 0 })
      }
      // Failed pages are replayed from their last checkpoint; external IDs deduplicate.
      await db.from('connectors').update({ status: error instanceof SlackError && REAUTH_ERRORS.includes(error.code) ? 'needs_reauth' : 'error', metadata: { ...connector.metadata, last_error: message } }).eq('id', connector.id)
      if (state.jobId) await db.from('sync_jobs').update({ status: 'failed', error_message: message, completed_at: new Date().toISOString() }).eq('id', state.jobId)
    }
    return json({ error: message }, 500)
  } finally {
    if (connector && lease) await db.from('connector_sync_state').update({ lease_until: null, lease_id: null }).eq('connector_id', connector.id).eq('lease_id', lease)
  }
})
