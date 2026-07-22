import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { classifyEmailAutomation } from './email-classification.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Address = { email: string; name: string }
type Mail = {
  id: string
  threadId: string
  subject: string
  from: Address
  to: Address[]
  sentAt: string
  body: string
  direction: 'inbound' | 'outbound'
  headers?: Record<string, string>
  /** Les messages anciens servent à découvrir le correspondant sans lancer
   * les traitements lourds de stockage et d'analyse comportementale. */
  discoveryOnly?: boolean
}
type MailScan = { messages: Mail[]; truncated: boolean }
type Analysis = {
  executive_summary?: string
  cognitive_mode?: string
  cognitive_mode_confidence?: number
  global_confidence?: number
  behavioral_analysis_data?: Array<{ trait?: string; observation?: string; confidence?: number }>
  communication_style_data?: Record<string, unknown>
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function cleanEmail(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

function cleanName(value: string | null | undefined, email: string): string {
  const name = String(value ?? '').replace(/["<>]/g, '').trim()
  if (name && !name.includes('@')) return name.slice(0, 120)
  const local = email.split('@')[0] ?? 'Contact'
  return local.split(/[._-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') || 'Contact'
}

const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.fr',
  'hotmail.com', 'hotmail.fr', 'live.com', 'live.fr', 'msn.com',
  'icloud.com', 'me.com', 'yahoo.com', 'yahoo.fr', 'proton.me', 'protonmail.com',
  'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'laposte.net',
  'gmx.com', 'gmx.fr', 'aol.com', 'mac.com',
  // Domaines partagés par une profession : ils identifient une boîte mail,
  // jamais l'employeur commun de leurs titulaires.
  'avocat.com', 'avocat.fr',
])

function corporateDomain(email: string): string | null {
  const domain = cleanEmail(email).split('@')[1] ?? ''
  return domain && !PUBLIC_EMAIL_DOMAINS.has(domain) ? domain : null
}

function companyNameFromDomain(domain: string): string {
  const base = domain.split('.')[0] ?? domain
  return base.split(/[-_]+/).filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || domain
}

function parseAddress(value: string): Address {
  const match = value.match(/^(.*?)<([^>]+)>$/) ?? value.match(/^([^\s,]+@[^\s,]+)$/)
  const email = cleanEmail(match?.[2] ?? match?.[1] ?? value)
  const rawName = match?.[2] ? match[1] : ''
  return { email, name: cleanName(rawName, email) }
}

function parseAddressList(value: string): Address[] {
  const matches = [...String(value ?? '').matchAll(/(?:"?([^"<,]*)"?\s*)?<([^>]+)>|([^\s,<>]+@[^\s,<>]+)/g)]
  if (!matches.length) return value.split(',').map(parseAddress).filter((item) => item.email)
  return matches.map((match) => {
    const email = cleanEmail(match[2] ?? match[3])
    return { email, name: cleanName(match[1], email) }
  }).filter((item) => item.email)
}

function stripHtml(value: string): string {
  return value.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
}

function sanitizeBody(value: string): string {
  return stripHtml(value).split('\n').filter((line) => {
    const text = line.trim()
    return text && !text.startsWith('>') && !/^(De|From|À|To|Envoyé|Sent|Objet|Subject)\s*:/i.test(text)
  }).join('\n').slice(0, 1800)
}

function decodeBase64Url(value: string): string {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(normalized)
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
  } catch {
    return ''
  }
}

function gmailBody(part: any): string {
  if (!part) return ''
  if (part.mimeType === 'text/plain' && part.body?.data) return decodeBase64Url(part.body.data)
  for (const child of part.parts ?? []) {
    const value = gmailBody(child)
    if (value) return value
  }
  if (part.mimeType === 'text/html' && part.body?.data) return stripHtml(decodeBase64Url(part.body.data))
  return ''
}

function header(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

function automationHeaders(headers: Array<{ name: string; value: string }>): Record<string, string> {
  const names = new Set(['auto-submitted', 'precedence', 'list-id', 'list-unsubscribe', 'x-auto-response-suppress'])
  return Object.fromEntries(headers
    .filter((item) => names.has(item.name.toLowerCase()))
    .map((item) => [item.name.toLowerCase(), item.value]))
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number(Deno.env.get(name))
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

/** Traite jusqu'à `limit` messages en parallèle — indispensable dès que le
 * volume de messages analysés grandit (ANALYSIS_MAX_MESSAGES) : la boucle
 * séquentielle d'origine (1 message = plusieurs appels RPC/REST attendus l'un
 * après l'autre) a fini par dépasser le temps d'exécution maximal de la
 * fonction (crash 546) sur des boîtes actives une fois le plafond relevé. */
async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0
  async function next(): Promise<void> {
    const current = index++
    if (current >= items.length) return
    await worker(items[current])
    return next()
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()))
}

const MESSAGE_PROCESSING_CONCURRENCY = positiveIntegerEnv('EMAIL_MESSAGE_CONCURRENCY', 8)

const DISCOVERY_MAX_MESSAGES = positiveIntegerEnv('EMAIL_DISCOVERY_MAX_MESSAGES', 5000)
const ANALYSIS_MAX_MESSAGES = positiveIntegerEnv('EMAIL_ANALYSIS_MAX_MESSAGES', 600)
const DISCOVERY_LOOKBACK_DAYS = positiveIntegerEnv('EMAIL_DISCOVERY_LOOKBACK_DAYS', 730)

async function refreshAccessToken(provider: string, refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const isGoogle = provider === 'google'
  const clientId = Deno.env.get(isGoogle ? 'GOOGLE_CLIENT_ID' : 'MICROSOFT_CLIENT_ID')
  const clientSecret = Deno.env.get(isGoogle ? 'GOOGLE_CLIENT_SECRET' : 'MICROSOFT_CLIENT_SECRET')
  if (!clientId || !clientSecret) throw new Error(`Secrets OAuth ${provider} manquants`)
  const params: Record<string, string> = { client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }
  if (!isGoogle) params.scope = 'openid profile email offline_access User.Read Mail.Read Calendars.Read'
  const response = await fetch(isGoogle ? 'https://oauth2.googleapis.com/token' : 'https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params),
  })
  if (!response.ok) throw new Error(`Rafraîchissement ${provider} refusé (${response.status})`)
  const data = await response.json()
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? refreshToken, expiresIn: Number(data.expires_in ?? 3600) }
}

async function gmailMessages(token: string, ownEmail: string): Promise<MailScan> {
  const ids: Array<{ id: string; threadId: string }> = []
  let pageToken: string | null = null
  let hasMore = false
  do {
    const params = new URLSearchParams({
      q: `newer_than:${DISCOVERY_LOOKBACK_DAYS}d -category:promotions`,
      maxResults: String(Math.min(500, DISCOVERY_MAX_MESSAGES - ids.length)),
    })
    if (pageToken) params.set('pageToken', pageToken)
    const listResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!listResponse.ok) throw new Error(`Gmail ${listResponse.status}`)
    const page = await listResponse.json()
    ids.push(...((page.messages ?? []) as Array<{ id: string; threadId: string }>))
    pageToken = page.nextPageToken ?? null
    hasMore = Boolean(pageToken)
  } while (pageToken && ids.length < DISCOVERY_MAX_MESSAGES)

  const output: Mail[] = []
  for (let index = 0; index < ids.length; index += 20) {
    const batch = await Promise.all(ids.slice(index, index + 20).map(async ({ id, threadId }, offset) => {
      const absoluteIndex = index + offset
      const discoveryOnly = absoluteIndex >= ANALYSIS_MAX_MESSAGES
      const detailParams = discoveryOnly
        ? 'format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Auto-Submitted&metadataHeaders=Precedence&metadataHeaders=List-Id&metadataHeaders=List-Unsubscribe&metadataHeaders=X-Auto-Response-Suppress'
        : 'format=full'
      const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?${detailParams}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) return null
      const message = await response.json()
      const headers = message.payload?.headers ?? []
      const from = parseAddress(header(headers, 'From'))
      const to = parseAddressList(header(headers, 'To'))
      const direction = from.email === ownEmail ? 'outbound' as const : 'inbound' as const
      return {
        id,
        threadId,
        subject: header(headers, 'Subject'),
        from,
        to,
        sentAt: new Date(Number(message.internalDate ?? Date.now())).toISOString(),
        body: discoveryOnly ? '' : sanitizeBody(gmailBody(message.payload)),
        direction,
        headers: automationHeaders(headers),
        discoveryOnly,
      }
    }))
    output.push(...batch.filter((item): item is Mail => Boolean(item)))
  }
  return { messages: output, truncated: hasMore }
}

async function graphFolder(token: string, folder: 'Inbox' | 'SentItems', ownEmail: string, maximum: number): Promise<MailScan> {
  const select = 'id,conversationId,subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview'
  let nextUrl: string | null = `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages?$top=100&$orderby=receivedDateTime%20desc&$select=${select}`
  const raw: any[] = []
  while (nextUrl && raw.length < maximum) {
    const response = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) throw new Error(`Microsoft Graph ${response.status}`)
    const page = await response.json()
    raw.push(...(page.value ?? []))
    nextUrl = page['@odata.nextLink'] ?? null
  }
  const messages = raw.slice(0, maximum).map((message: any, index) => {
    const fromEmail = cleanEmail(message.from?.emailAddress?.address)
    const from = { email: fromEmail, name: cleanName(message.from?.emailAddress?.name, fromEmail) }
    const to = (message.toRecipients ?? []).map((recipient: any) => {
      const email = cleanEmail(recipient.emailAddress?.address)
      return { email, name: cleanName(recipient.emailAddress?.name, email) }
    }).filter((item: Address) => item.email)
    return {
      id: message.id,
      threadId: message.conversationId ?? message.id,
      subject: message.subject ?? '',
      from,
      to,
      sentAt: message.sentDateTime ?? message.receivedDateTime ?? new Date().toISOString(),
      body: index < Math.ceil(ANALYSIS_MAX_MESSAGES / 2) ? sanitizeBody(message.bodyPreview ?? '') : '',
      direction: folder === 'SentItems' || from.email === ownEmail ? 'outbound' as const : 'inbound' as const,
      discoveryOnly: index >= Math.ceil(ANALYSIS_MAX_MESSAGES / 2),
    }
  })
  return { messages, truncated: Boolean(nextUrl) }
}

async function microsoftMessages(token: string, ownEmail: string): Promise<MailScan> {
  const perFolder = Math.ceil(DISCOVERY_MAX_MESSAGES / 2)
  const [inbox, sent] = await Promise.all([
    graphFolder(token, 'Inbox', ownEmail, perFolder),
    graphFolder(token, 'SentItems', ownEmail, perFolder),
  ])
  return { messages: [...inbox.messages, ...sent.messages], truncated: inbox.truncated || sent.truncated }
}

/** Confiance en pourcentage entier 0-100 : le modèle renvoie parfois un ratio 0-1
 *  (0.9) que les colonnes integer rejettent — on normalise et on arrondit. */
function pct(value: unknown): number {
  const parsed = Number(value ?? 0)
  if (!Number.isFinite(parsed)) return 0
  return Math.round(Math.max(0, Math.min(100, parsed <= 1 ? parsed * 100 : parsed)))
}

function extractJson(value: string): Analysis {
  try { return JSON.parse(value) } catch {
    const match = value.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('Analyse IA non parsable')
    return JSON.parse(match[0])
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>
    return String(value.message ?? value.error_description ?? value.details ?? JSON.stringify(value))
  }
  return String(error ?? 'analyse impossible')
}

async function analyze(name: string, role: 'responsable' | 'contact', excerpts: string[]): Promise<Analysis> {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY')
  if (!apiKey) throw new Error('OPENROUTER_API_KEY non configurée')
  const corpus = excerpts.slice(-30).join('\n---\n').slice(0, 16000)
  const prompt = `Analyse le style comportemental et communicationnel de ${name}, qui est ${role === 'responsable' ? 'le responsable de compte connecté' : 'une personne suivie'}.
Base-toi uniquement sur les messages qu'il ou elle a réellement rédigés ci-dessous. Ne diagnostique aucune pathologie, n'infère aucune donnée sensible et ne cite pas les emails mot pour mot. Réponds uniquement en JSON :
{"executive_summary":"résumé en français","cognitive_mode":"mode dominant","cognitive_mode_confidence":0,"global_confidence":0,"behavioral_analysis_data":[{"trait":"nom","observation":"paraphrase factuelle","confidence":0}],"communication_style_data":{"tone":"","directness":"","decision_style":"","preferred_format":"","response_pattern":""}}
Messages :\n${corpus}`
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': Deno.env.get('SITE_URL') ?? 'https://tohu.app', 'X-Title': 'Tohu Email Behavior Analysis' },
    body: JSON.stringify({ model: Deno.env.get('OPENROUTER_MODEL') ?? 'google/gemini-2.5-flash-lite', temperature: 0.15, response_format: { type: 'json_object' }, max_tokens: 900, messages: [{ role: 'user', content: prompt }] }),
  })
  if (!response.ok) throw new Error(`OpenRouter ${response.status}`)
  const data = await response.json()
  return extractJson(String(data.choices?.[0]?.message?.content ?? ''))
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
    const { organizationId, provider, jobId } = await request.json().catch(() => ({}))
    if (!organizationId || !['google', 'microsoft'].includes(provider)) return json({ error: 'Paramètres invalides' }, 400)
    const { data: membership } = await supabase.from('memberships').select('id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle()
    if (!membership) return json({ error: 'Accès refusé' }, 403)
    const { data: connector } = await supabase.from('connectors').select('id,metadata').eq('organization_id', organizationId).eq('user_id', user.id).eq('provider', provider).maybeSingle()
    if (!connector) return json({ error: 'Connecteur introuvable' }, 404)
    const { data: tokenRows, error: tokenError } = await supabase.rpc('get_oauth_tokens_server', { p_connector_id: connector.id })
    const oauth = tokenRows?.[0]
    if (tokenError || !oauth) return json({ error: 'Jetons OAuth absents. Reconnecte le fournisseur.' }, 401)

    // jobId : le client peut pré-créer la ligne sync_jobs pour pouvoir la
    // sonder pendant que cet appel est encore en vol (sinon aucun accès au
    // progress avant la résolution complète de la requête).
    let reusedJobId: string | null = null
    if (typeof jobId === 'string') {
      const { data: existingJob } = await supabase.from('sync_jobs').select('id').eq('id', jobId).eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle()
      reusedJobId = existingJob?.id ?? null
    }
    if (reusedJobId) {
      await supabase.from('sync_jobs').update({ connector_id: connector.id, provider, status: 'running', current_step: 'Connexion au fournisseur', progress: 10, started_at: startedAt, payload: { provider } }).eq('id', reusedJobId)
      syncJobId = reusedJobId
    } else {
      const { data: job } = await supabase.from('sync_jobs').insert({
        organization_id: organizationId,
        connector_id: connector.id,
        user_id: user.id,
        provider,
        job_type: 'email_behavior_analysis',
        status: 'running',
        current_step: 'Connexion au fournisseur',
        progress: 10,
        started_at: startedAt,
        payload: { provider },
      }).select('id').single()
      syncJobId = job?.id ?? null
    }

    let accessToken = oauth.access_token as string | null
    let refreshToken = oauth.refresh_token as string | null
    const expiresSoon = !oauth.expires_at || new Date(oauth.expires_at).getTime() < Date.now() + 90_000
    if ((!accessToken || expiresSoon) && refreshToken) {
      const refreshed = await refreshAccessToken(provider, refreshToken)
      accessToken = refreshed.accessToken
      refreshToken = refreshed.refreshToken
      await supabase.rpc('store_oauth_tokens_server', { p_organization_id: organizationId, p_connector_id: connector.id, p_provider_account_id: oauth.provider_account_id, p_access_token: accessToken, p_refresh_token: refreshToken, p_expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString() })
    }
    if (!accessToken) throw new Error('Jeton OAuth indisponible')

    const ownEmail = cleanEmail((connector.metadata as any)?.account_email ?? user.email)
    const scan = provider === 'google' ? await gmailMessages(accessToken, ownEmail) : await microsoftMessages(accessToken, ownEmail)
    const messages = scan.messages
    if (syncJobId) await supabase.from('sync_jobs').update({ current_step: 'Lecture des métadonnées autorisées', progress: 35 }).eq('id', syncJobId)
    const { data: existingContacts } = await supabase.from('contacts').select('id,email,secondary_emails,full_name,owner_user_id,source_summary,is_tracked').eq('organization_id', organizationId).is('merged_into_contact_id', null)
    const contactByEmail = new Map<string, any>()
    for (const item of existingContacts ?? []) {
      for (const email of [item.email, ...(item.secondary_emails ?? [])]) {
        const normalized = cleanEmail(email)
        if (normalized) contactByEmail.set(normalized, item)
      }
    }
    const contactCorpus = new Map<string, string[]>()
    const responsibleCorpus: string[] = []
    let storedMessages = 0
    let skippedAutomated = 0
    const skippedReasons: Record<string, number> = {}
    let processedMessages = 0

    await runWithConcurrency(messages, MESSAGE_PROCESSING_CONCURRENCY, async (message) => {
      processedMessages++
      if (syncJobId && messages.length > 20 && processedMessages % 20 === 0) {
        void supabase.from('sync_jobs').update({ current_step: `Traitement des messages (${processedMessages}/${messages.length})`, progress: 35 + Math.round((processedMessages / messages.length) * 25) }).eq('id', syncJobId)
      }
      const externalByEmail = new Map(
        (message.direction === 'inbound' ? [message.from] : message.to)
          .filter((item) => item.email && item.email !== ownEmail)
          .map((item) => [item.email, item]),
      )
      const messageContacts: any[] = []

      for (const external of externalByEmail.values()) {
        let contact = contactByEmail.get(external.email)
        const sourceSummary = contact?.source_summary as Record<string, unknown> | undefined
        const manuallyIntegrated = ['manual', 'manual_integration'].includes(String(
          sourceSummary?.last_identity_source ?? sourceSummary?.source ?? sourceSummary?.discovered_from ?? '',
        ))
        const classification = classifyEmailAutomation({
          email: external.email,
          name: external.name,
          subject: message.subject,
          body: message.body,
          headers: message.headers,
        })
        if (classification.automated && !manuallyIntegrated) {
          skippedAutomated++
          for (const reason of classification.reasons) skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1
          continue
        }
        if (!contact) {
          let companyId: string | null = null
          const domain = corporateDomain(external.email)
          if (domain) {
            const { data: company } = await supabase.rpc('resolve_company_identity', {
              p_organization_id: organizationId,
              p_name: companyNameFromDomain(domain),
              p_domain: domain,
              p_industry: null,
              p_create_if_missing: true,
            }).maybeSingle()
            companyId = company?.company_id ?? null
          }
          const { data: resolved, error } = await supabase.rpc('resolve_contact_identity', {
            p_organization_id: organizationId,
            p_email: external.email,
            p_full_name: cleanName(external.name, external.email),
            p_company_id: companyId,
            p_owner_user_id: user.id,
            p_role_title: null,
            p_source: `email_${provider}`,
          }).maybeSingle()
          if (error || !resolved?.contact_id) continue
          contact = { id: resolved.contact_id, email: external.email, full_name: cleanName(external.name, external.email), owner_user_id: user.id, is_tracked: false }
          contactByEmail.set(external.email, contact)
        } else if (!contact.owner_user_id) {
          await supabase.from('contacts').update({ owner_user_id: user.id }).eq('id', contact.id)
          contact.owner_user_id = user.id
        }
        messageContacts.push(contact)
      }

      const primaryContact = messageContacts.find((item) => item.is_tracked === true) ?? messageContacts[0]
      if (!primaryContact || message.discoveryOnly) return
      const { data: thread } = await supabase.from('communication_threads').upsert({ organization_id: organizationId, provider, external_thread_id: message.threadId, subject: message.subject, updated_at: new Date().toISOString() }, { onConflict: 'organization_id,provider,external_thread_id' }).select('id').single()
      if (!thread) return
      const { error: messageError } = await supabase.from('communication_messages').upsert({ organization_id: organizationId, thread_id: thread.id, contact_id: primaryContact.id, provider, external_message_id: message.id, direction: message.direction, sent_at: message.sentAt, subject: message.subject, body_text: null, metadata: { from: message.from.email, to: message.to.map((item) => item.email), analyzed_without_body_storage: true } }, { onConflict: 'organization_id,provider,external_message_id' })
      if (!messageError) storedMessages++
      if (message.body && message.direction === 'outbound') responsibleCorpus.push(message.body)
      else if (message.body && primaryContact.is_tracked === true) contactCorpus.set(primaryContact.id, [...(contactCorpus.get(primaryContact.id) ?? []), message.body])
    })

    if (syncJobId) await supabase.from('sync_jobs').update({ current_step: 'Détection des personnes et organisations', progress: 60 }).eq('id', syncJobId)

    const analysisErrors: string[] = []
    let responsibleAnalyzed = false
    if (responsibleCorpus.length >= 3) {
      try {
        const result = await analyze((await supabase.from('profiles').select('full_name').eq('id', user.id).single()).data?.full_name ?? user.email ?? 'Responsable', 'responsable', responsibleCorpus)
        await supabase.from('user_behavioral_profiles').upsert({ organization_id: organizationId, user_id: user.id, global_confidence: pct(result.global_confidence), executive_summary: result.executive_summary ?? null, cognitive_mode: result.cognitive_mode ?? null, cognitive_mode_confidence: pct(result.cognitive_mode_confidence), behavioral_analysis_data: result.behavioral_analysis_data ?? [], communication_style_data: result.communication_style_data ?? {}, source_message_count: responsibleCorpus.length, updated_from: [provider, 'email'], updated_at: new Date().toISOString() }, { onConflict: 'organization_id,user_id' })
        responsibleAnalyzed = true
      } catch (error) {
        analysisErrors.push(`responsable: ${errorMessage(error)}`)
      }
    }

    let peopleAnalyzed = 0
    const candidates = [...contactCorpus.entries()].filter(([, excerpts]) => excerpts.length >= 3).sort((a, b) => b[1].length - a[1].length).slice(0, 12)
    for (let i = 0; i < candidates.length; i++) {
      const [contactId, excerpts] = candidates[i]
      try {
        const contact = [...contactByEmail.values()].find((item) => item.id === contactId)
        const result = await analyze(contact?.full_name ?? 'Contact', 'contact', excerpts)
        const { data: cognitiveProfile, error: profileError } = await supabase.from('cognitive_profiles').upsert({ organization_id: organizationId, contact_id: contactId, profile_version: 1, global_confidence: pct(result.global_confidence), summary: result.executive_summary ?? null, executive_summary: result.executive_summary ?? null, cognitive_mode: result.cognitive_mode ?? null, cognitive_mode_confidence: pct(result.cognitive_mode_confidence), behavioral_analysis_data: result.behavioral_analysis_data ?? [], updated_from: [provider, 'email'], updated_at: new Date().toISOString() }, { onConflict: 'organization_id,contact_id,profile_version' }).select('id').single()
        if (profileError || !cognitiveProfile) throw profileError ?? new Error('Profil cognitif non enregistré')
        const signals = (result.behavioral_analysis_data ?? []).slice(0, 6).map((item) => ({ organization_id: organizationId, contact_id: contactId, profile_id: cognitiveProfile.id, signal_type: item.trait ?? 'communication_style', text: item.observation ?? '', inference: item.trait ?? null, inference_level: 'observable', confidence: pct(item.confidence), source_type: `email_${provider}_analysis`, source_ref: `sync:${new Date().toISOString()}`, observed_at: new Date().toISOString() })).filter((item) => item.text)
        if (signals.length) {
          const { error: signalsError } = await supabase.from('behavioral_signals').insert(signals)
          if (signalsError) throw signalsError
        }
        peopleAnalyzed++
      } catch (error) {
        analysisErrors.push(`contact ${contactId}: ${errorMessage(error)}`)
      }
      if (syncJobId) await supabase.from('sync_jobs').update({ current_step: `Analyse comportementale (${i + 1}/${candidates.length})`, progress: 60 + Math.round(((i + 1) / candidates.length) * 30) }).eq('id', syncJobId)
    }

    if (syncJobId) await supabase.from('sync_jobs').update({ current_step: 'Mise à jour des profils comportementaux', progress: 90 }).eq('id', syncJobId)

    const discoveredDomains = new Set(
      [...contactByEmail.keys()].map(corporateDomain).filter((domain): domain is string => Boolean(domain)),
    ).size
    const syncSummary = {
      messages: storedMessages,
      messages_scanned: messages.length,
      discovery_truncated: scan.truncated,
      organizations_detected: discoveredDomains,
      people_analyzed: peopleAnalyzed,
      responsible_analyzed: responsibleAnalyzed,
      automated_messages_ignored: skippedAutomated,
      ignored_reasons: skippedReasons,
    }
    await supabase.from('connectors').update({ status: 'connected', last_synced_at: new Date().toISOString(), metadata: { ...(connector.metadata ?? {}), last_sync: syncSummary }, updated_at: new Date().toISOString() }).eq('id', connector.id)
    if (syncJobId) await supabase.from('sync_jobs').update({ status: 'succeeded', current_step: 'Synchronisation terminée', progress: 100, completed_at: new Date().toISOString(), payload: { provider, ...syncSummary, analysis_errors: analysisErrors.slice(0, 5) } }).eq('id', syncJobId)
    return json({ success: true, messages: storedMessages, responsibleAnalyzed, peopleAnalyzed, automatedMessagesIgnored: skippedAutomated, analysisErrors: analysisErrors.slice(0, 5) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Synchronisation impossible'
    if (syncJobId) {
      const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
      await supabase.from('sync_jobs').update({ status: 'failed', current_step: 'Échec de la synchronisation', error_code: 'EMAIL_SYNC_FAILED', error_message: message, completed_at: new Date().toISOString() }).eq('id', syncJobId)
    }
    return json({ error: message }, 500)
  }
})
