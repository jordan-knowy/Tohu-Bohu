import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { classifyEmailAutomation } from './email-classification.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
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
  /** Décidé par `selectMessagesByRelevance` (pas par position/date) : les
   * messages non retenus servent à découvrir le correspondant sans lancer
   * les traitements lourds de stockage et d'analyse comportementale. */
  discoveryOnly?: boolean
}
type MailScan = { messages: Mail[]; truncated: boolean; oldestSentAt: string | null }
type Analysis = {
  executive_summary?: string
  cognitive_mode?: string
  cognitive_mode_confidence?: number
  global_confidence?: number
  behavioral_analysis_data?: Array<{ trait?: string; observation?: string; confidence?: number }>
  communication_style_data?: Record<string, unknown>
  cognitive_profile_data?: Record<string, unknown>
}

const STATUS_SCHEMA = { type: 'string', enum: ['observed', 'emerging', 'insufficient'] }
const NULLABLE_NUMBER_SCHEMA = { type: ['number', 'null'] }
const NULLABLE_STRING_SCHEMA = { type: ['string', 'null'] }
const SOURCE_TYPES_SCHEMA = {
  type: 'array',
  items: { type: 'string', enum: ['email', 'meeting_transcript'] },
}

function strictObject(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }
}

const INTERPERSONAL_AXIS_SCHEMA = strictObject({
  status: STATUS_SCHEMA,
  score: NULLABLE_NUMBER_SCHEMA,
  label: NULLABLE_STRING_SCHEMA,
  observation: NULLABLE_STRING_SCHEMA,
  confidence: NULLABLE_NUMBER_SCHEMA,
  evidence_count: { type: 'integer', minimum: 0 },
  source_types: SOURCE_TYPES_SCHEMA,
  evolution: { type: ['string', 'null'], enum: ['rising', 'stable', 'declining', 'mixed', null] },
})

const PRIMARY_AXIS_SCHEMA = strictObject({
  status: STATUS_SCHEMA,
  raw_score: NULLABLE_NUMBER_SCHEMA,
  margin_pts: NULLABLE_NUMBER_SCHEMA,
  trend_pts: NULLABLE_NUMBER_SCHEMA,
  trend_label: { type: ['string', 'null'], enum: ['rising', 'stable', 'declining', null] },
  observation: NULLABLE_STRING_SCHEMA,
  confidence: NULLABLE_NUMBER_SCHEMA,
  evidence: { type: 'array', items: { type: 'string' } },
  evidence_count: { type: 'integer', minimum: 0 },
  source_types: SOURCE_TYPES_SCHEMA,
})

const SECONDARY_AXIS_SCHEMA = strictObject({
  status: STATUS_SCHEMA,
  score: NULLABLE_NUMBER_SCHEMA,
  observation: NULLABLE_STRING_SCHEMA,
  confidence: NULLABLE_NUMBER_SCHEMA,
  evidence_count: { type: 'integer', minimum: 0 },
  source_types: SOURCE_TYPES_SCHEMA,
})

const COGNITIVE_PROFILE_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'tohu_cognitive_profile_v3',
    strict: true,
    schema: strictObject({
      executive_summary: NULLABLE_STRING_SCHEMA,
      cognitive_mode: NULLABLE_STRING_SCHEMA,
      cognitive_mode_confidence: { type: 'number', minimum: 0, maximum: 100 },
      global_confidence: { type: 'number', minimum: 0, maximum: 100 },
      cognitive_profile_data: strictObject({
        schema_version: { type: 'integer', const: 3 },
        interpersonal: strictObject({
          assertiveness: INTERPERSONAL_AXIS_SCHEMA,
          warmth: INTERPERSONAL_AXIS_SCHEMA,
        }),
        primary_axes: strictObject({
          rythme: PRIMARY_AXIS_SCHEMA,
          argumentation: PRIMARY_AXIS_SCHEMA,
          engagement: PRIMARY_AXIS_SCHEMA,
          registre: PRIMARY_AXIS_SCHEMA,
          tonalite: PRIMARY_AXIS_SCHEMA,
          espace_parole: PRIMARY_AXIS_SCHEMA,
        }),
        secondary_axes: strictObject({
          orientation: SECONDARY_AXIS_SCHEMA,
          certainty: SECONDARY_AXIS_SCHEMA,
          novelty: SECONDARY_AXIS_SCHEMA,
          initiative: SECONDARY_AXIS_SCHEMA,
        }),
        posture: INTERPERSONAL_AXIS_SCHEMA,
      }),
    }),
  },
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
/** Plafond de messages « traitement complet » par relation, pour que le budget
 *  global se répartisse sur plusieurs relations prioritaires plutôt que d'être
 *  monopolisé par une seule (ex. une boîte qui reçoit beaucoup d'un seul tiers). */
const PER_CONTACT_MAX_MESSAGES = positiveIntegerEnv('EMAIL_PER_CONTACT_MAX_MESSAGES', 150)
/** Une relecture demandée depuis une fiche Personne est exhaustive pour ce
 * correspondant dans la fenêtre autorisée. Elle a son propre plafond, plus
 * élevé que le budget partagé d'une synchronisation globale. */
const TARGET_CONTACT_MAX_MESSAGES = positiveIntegerEnv('EMAIL_TARGET_CONTACT_MAX_MESSAGES', 2000)
const PROFILE_ANALYSIS_MAX_CONTACTS = positiveIntegerEnv('EMAIL_PROFILE_ANALYSIS_MAX_CONTACTS', 24)
const MEETING_CORPUS_MAX_CONTACTS = positiveIntegerEnv('EMAIL_MEETING_CORPUS_MAX_CONTACTS', 200)
const DISCOVERY_LOOKBACK_DAYS = positiveIntegerEnv('EMAIL_DISCOVERY_LOOKBACK_DAYS', 730)
/** Nombre de connecteurs traités par tick du cron de reprise du backfill —
 *  reste faible pour que le temps d'exécution total du tick reste borné,
 *  quitte à répartir sur plusieurs ticks (toutes les 6h) pour couvrir tout le monde. */
const BACKFILL_MAX_CONNECTORS_PER_RUN = positiveIntegerEnv('EMAIL_BACKFILL_MAX_CONNECTORS_PER_RUN', 2)
/** Les ticks incrémentaux (Partie C) sont beaucoup moins coûteux qu'un
 *  backfill (History API / delta = uniquement les nouveautés) — plus de
 *  connecteurs peuvent être traités par tick, plus fréquemment. */
const INCREMENTAL_MAX_CONNECTORS_PER_RUN = positiveIntegerEnv('EMAIL_INCREMENTAL_MAX_CONNECTORS_PER_RUN', 15)

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

/** Convertit un ISO8601 en date Gmail `before:` (YYYY/MM/DD, granularité jour) —
 *  utilisé pour reprendre la découverte plus loin dans le passé lors du tick
 *  de reprise du backfill, sans avoir à rejouer tout le scan depuis le début. */
function toGmailDateOnly(iso: string): string {
  const date = new Date(iso)
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`
}

/** Découverte Gmail — toujours en mode léger (métadonnées seulement, jamais le
 *  corps) sur toute la fenêtre de découverte : qui a droit au traitement complet
 *  (corps + stockage) se décide ensuite par pertinence, pas par position dans
 *  cette liste triée par date (voir `selectMessagesByRelevance` + `hydrateGmailBodies`).
 *  `beforeDate` (format Gmail YYYY/MM/DD) reprend une passe de backfill précédente
 *  plus loin dans le passé, sans rejouer ce qui a déjà été scanné. */
async function gmailMessages(token: string, ownEmail: string, beforeDate?: string | null, targetEmails: string[] = []): Promise<MailScan> {
  const ids: Array<{ id: string; threadId: string }> = []
  let pageToken: string | null = null
  let hasMore = false
  do {
    const targetQuery = targetEmails.length
      ? ` {${targetEmails.flatMap((email) => [`from:${email}`, `to:${email}`]).join(' ')}}`
      : ''
    // Une recherche ciblée relit tout l'historique que Gmail peut retourner
    // pour ces identités ; la fenêtre glissante ne concerne que les backfills
    // globaux, où elle est reprise progressivement par curseur.
    const lookbackQuery = targetEmails.length ? '' : `newer_than:${DISCOVERY_LOOKBACK_DAYS}d `
    const query = `${lookbackQuery}-category:promotions${beforeDate ? ` before:${beforeDate}` : ''}${targetQuery}`
    const params = new URLSearchParams({
      q: query,
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

  const detailParams = 'format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Auto-Submitted&metadataHeaders=Precedence&metadataHeaders=List-Id&metadataHeaders=List-Unsubscribe&metadataHeaders=X-Auto-Response-Suppress'
  const output: Mail[] = []
  for (let index = 0; index < ids.length; index += 20) {
    const batch = await Promise.all(ids.slice(index, index + 20).map(async ({ id, threadId }) => {
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
        body: '',
        direction,
        headers: automationHeaders(headers),
      }
    }))
    output.push(...batch.filter((item): item is Mail => Boolean(item)))
  }
  const oldestSentAt = output.reduce((oldest: string | null, mail) => (!oldest || mail.sentAt < oldest ? mail.sentAt : oldest), null)
  return { messages: output, truncated: hasMore, oldestSentAt }
}

/** Seconde passe Gmail, ciblée : récupère le corps complet uniquement pour les
 *  messages retenus par le calcul de pertinence (voir `selectMessagesByRelevance`). */
async function hydrateGmailBodies(token: string, mails: Mail[], selected: Set<string>): Promise<void> {
  const targets = mails.filter((mail) => selected.has(mail.id))
  for (let index = 0; index < targets.length; index += 20) {
    await Promise.all(targets.slice(index, index + 20).map(async (mail) => {
      const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${mail.id}?format=full`, { headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) return
      const message = await response.json()
      mail.body = sanitizeBody(gmailBody(message.payload))
    }))
  }
}

async function graphFolder(token: string, folder: 'Inbox' | 'SentItems', ownEmail: string, maximum: number, beforeIso?: string | null): Promise<MailScan> {
  const select = 'id,conversationId,subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview'
  const filterParam = beforeIso ? `&$filter=${encodeURIComponent(`receivedDateTime lt ${beforeIso}`)}` : ''
  let nextUrl: string | null = `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages?$top=100&$orderby=receivedDateTime%20desc&$select=${select}${filterParam}`
  const raw: any[] = []
  while (nextUrl && raw.length < maximum) {
    const response = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) throw new Error(`Microsoft Graph ${response.status}`)
    const page = await response.json()
    raw.push(...(page.value ?? []))
    nextUrl = page['@odata.nextLink'] ?? null
  }
  const messages = raw.slice(0, maximum).map((message: any) => {
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
      // bodyPreview est déjà inclus dans l'appel de liste ci-dessus (aucun coût
      // réseau supplémentaire) — qui a droit au traitement complet se décide par
      // pertinence dans le handler, pas ici (voir `selectMessagesByRelevance`).
      body: sanitizeBody(message.bodyPreview ?? ''),
      direction: folder === 'SentItems' || from.email === ownEmail ? 'outbound' as const : 'inbound' as const,
    }
  })
  const oldestSentAt = messages.reduce((oldest: string | null, mail) => (!oldest || mail.sentAt < oldest ? mail.sentAt : oldest), null)
  return { messages, truncated: Boolean(nextUrl), oldestSentAt }
}

async function microsoftMessages(token: string, ownEmail: string, beforeIso?: string | null): Promise<MailScan> {
  const perFolder = Math.ceil(DISCOVERY_MAX_MESSAGES / 2)
  const [inbox, sent] = await Promise.all([
    graphFolder(token, 'Inbox', ownEmail, perFolder, beforeIso),
    graphFolder(token, 'SentItems', ownEmail, perFolder, beforeIso),
  ])
  const oldestSentAt = [inbox.oldestSentAt, sent.oldestSentAt].filter((value): value is string => value !== null).sort()[0] ?? null
  return { messages: [...inbox.messages, ...sent.messages], truncated: inbox.truncated || sent.truncated, oldestSentAt }
}

/** Recherche Microsoft ciblée sur un correspondant. Le mode manuel ne doit
 * jamais parcourir plusieurs milliers de messages d'une boîte complète : ce
 * chemin borné évite les interruptions Edge 546 observées sur les grosses
 * boîtes et ne modifie aucun deltaLink. */
async function microsoftTargetMessages(token: string, ownEmail: string, targetEmails: string[]): Promise<MailScan> {
  const select = 'id,conversationId,subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview'
  const byId = new Map<string, any>()
  let truncated = false
  for (const targetEmail of targetEmails) {
    let nextUrl: string | null = `https://graph.microsoft.com/v1.0/me/messages?$top=100&$search=${encodeURIComponent(`"participants:${targetEmail}"`)}&$select=${select}`
    let fetched = 0
    while (nextUrl && fetched < TARGET_CONTACT_MAX_MESSAGES) {
      const response = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' } })
      if (!response.ok) throw new Error(`Microsoft Graph ciblé ${response.status}`)
      const page = await response.json()
      for (const message of page.value ?? []) byId.set(String(message.id), message)
      fetched += (page.value ?? []).length
      nextUrl = page['@odata.nextLink'] ?? null
    }
    if (nextUrl) truncated = true
  }
  const messages: Mail[] = [...byId.values()].map((message: any) => {
    const fromEmail = cleanEmail(message.from?.emailAddress?.address)
    const from = { email: fromEmail, name: cleanName(message.from?.emailAddress?.name, fromEmail) }
    const to = (message.toRecipients ?? []).map((recipient: any) => {
      const email = cleanEmail(recipient.emailAddress?.address)
      return { email, name: cleanName(recipient.emailAddress?.name, email) }
    }).filter((item: Address) => item.email)
    return {
      id: String(message.id),
      threadId: message.conversationId ?? message.id,
      subject: message.subject ?? '',
      from,
      to,
      sentAt: message.sentDateTime ?? message.receivedDateTime ?? new Date().toISOString(),
      body: sanitizeBody(message.bodyPreview ?? ''),
      direction: from.email === ownEmail ? 'outbound' as const : 'inbound' as const,
    }
  })
  const oldestSentAt = messages.reduce((oldest: string | null, mail) => (!oldest || mail.sentAt < oldest ? mail.sentAt : oldest), null)
  return { messages, truncated, oldestSentAt }
}

type MeetingCorpus = { excerpts: string[]; meetingCount: number }

function normalizedSpeaker(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Une transcription n'est utilisée que si le préfixe de locuteur correspond
 * exactement à une identité connue du contact. En cas d'ambiguïté, elle reste
 * visible dans l'historique mais n'alimente pas l'inférence comportementale. */
function attributedTranscriptExcerpt(transcript: string, identities: string[]): string | null {
  const speakers = new Set(identities
    .flatMap((identity) => {
      const email = cleanEmail(identity)
      return [identity, email.includes('@') ? email.split('@')[0] : '']
    })
    .map(normalizedSpeaker)
    .filter((identity) => identity.length >= 4))
  if (!speakers.size) return null

  const attributed = String(transcript ?? '').split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^(.+?)(?:\s+\(\d{1,2}:\d{2}(?::\d{2})?\))?\s*:\s*(.+)$/)
    if (!match || !speakers.has(normalizedSpeaker(match[1]))) return []
    const content = sanitizeBody(match[2])
    return content ? [content] : []
  })
  if (!attributed.length) return null
  return `[Transcription de réunion]\n${attributed.join('\n')}`.slice(0, 2400)
}

async function loadMeetingCorpus(
  supabase: ReturnType<typeof createClient>,
  organizationId: string,
  contactIds: string[],
  contactNames: Map<string, string>,
): Promise<Map<string, MeetingCorpus>> {
  const result = new Map<string, MeetingCorpus>()
  if (!contactIds.length) return result
  const { data: participantRows, error: participantError } = await supabase.from('meeting_participants')
    .select('meeting_id,contact_id,email,display_name')
    .eq('organization_id', organizationId)
    .eq('is_current_user', false)
    .in('contact_id', contactIds)
    .limit(2000)
  if (participantError) throw participantError

  const participantsByMeeting = new Map<string, any[]>()
  for (const participant of participantRows ?? []) {
    if (!participant.meeting_id || !participant.contact_id) continue
    participantsByMeeting.set(String(participant.meeting_id), [
      ...(participantsByMeeting.get(String(participant.meeting_id)) ?? []),
      participant,
    ])
  }
  const meetingIds = [...participantsByMeeting.keys()]
  if (!meetingIds.length) return result
  const { data: transcriptRows, error: transcriptError } = await supabase.from('meeting_transcripts')
    .select('meeting_id,transcript_text,created_at')
    .eq('organization_id', organizationId)
    .eq('consent_status', 'granted')
    .in('meeting_id', meetingIds)
    .order('created_at', { ascending: false })
    .limit(500)
  if (transcriptError) throw transcriptError

  const usedMeetingsByContact = new Map<string, Set<string>>()
  for (const transcript of transcriptRows ?? []) {
    const meetingId = String(transcript.meeting_id ?? '')
    for (const participant of participantsByMeeting.get(meetingId) ?? []) {
      const contactId = String(participant.contact_id)
      const excerpt = attributedTranscriptExcerpt(String(transcript.transcript_text ?? ''), [
        String(participant.display_name ?? ''),
        String(participant.email ?? ''),
        contactNames.get(contactId) ?? '',
      ])
      if (!excerpt) continue
      const used = usedMeetingsByContact.get(contactId) ?? new Set<string>()
      if (used.has(meetingId)) continue
      used.add(meetingId)
      usedMeetingsByContact.set(contactId, used)
      const current = result.get(contactId) ?? { excerpts: [], meetingCount: 0 }
      current.excerpts.push(excerpt)
      current.meetingCount++
      result.set(contactId, current)
    }
  }
  return result
}

/** Capture le historyId Gmail courant juste après un backfill complet — point
 *  de départ pour l'ingestion incrémentale (Partie C), sans avoir à rejouer
 *  tout l'historique pour savoir où « maintenant » se situe. */
async function bootstrapGmailHistoryId(token: string): Promise<string | null> {
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) return null
  const data = await response.json()
  return data.historyId ? String(data.historyId) : null
}

/** Ingestion incrémentale Gmail : ne renvoie que les messages ajoutés depuis
 *  `historyId` (History API), traitement complet direct vu le faible volume
 *  attendu par tick — pas besoin du budget de pertinence du backfill complet.
 *  `expired: true` signale un historyId trop ancien (inactivité prolongée,
 *  Gmail ne garantit sa rétention qu'environ 7 jours) : l'appelant doit alors
 *  retomber en mode backfill plutôt que de traiter ceci comme une erreur. */
async function gmailIncrementalMessages(token: string, ownEmail: string, historyId: string): Promise<{ messages: Mail[]; newHistoryId: string | null; expired: boolean }> {
  const addedIds = new Set<string>()
  let pageToken: string | null = null
  let newHistoryId: string | null = null
  do {
    const params = new URLSearchParams({ startHistoryId: historyId, historyTypes: 'messageAdded' })
    if (pageToken) params.set('pageToken', pageToken)
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/history?${params}`, { headers: { Authorization: `Bearer ${token}` } })
    if (response.status === 404) return { messages: [], newHistoryId: null, expired: true }
    if (!response.ok) throw new Error(`Gmail history ${response.status}`)
    const page = await response.json()
    for (const entry of page.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        if (added.message?.id) addedIds.add(added.message.id)
      }
    }
    if (page.historyId) newHistoryId = String(page.historyId)
    pageToken = page.nextPageToken ?? null
  } while (pageToken)

  const output: Mail[] = []
  const ids = [...addedIds]
  for (let index = 0; index < ids.length; index += 20) {
    const batch = await Promise.all(ids.slice(index, index + 20).map(async (id) => {
      const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) return null
      const message = await response.json()
      const headers = message.payload?.headers ?? []
      const from = parseAddress(header(headers, 'From'))
      const to = parseAddressList(header(headers, 'To'))
      const direction = from.email === ownEmail ? 'outbound' as const : 'inbound' as const
      return {
        id,
        threadId: message.threadId ?? id,
        subject: header(headers, 'Subject'),
        from,
        to,
        sentAt: new Date(Number(message.internalDate ?? Date.now())).toISOString(),
        body: sanitizeBody(gmailBody(message.payload)),
        direction,
        headers: automationHeaders(headers),
      }
    }))
    output.push(...batch.filter((item): item is Mail => Boolean(item)))
  }
  return { messages: output, newHistoryId, expired: false }
}

const MS_DELTA_SELECT = 'id,conversationId,subject,from,toRecipients,receivedDateTime,sentDateTime,body'

/** Capture un deltaLink Microsoft Graph « à partir de maintenant » sans
 *  énumérer l'historique existant — `$deltatoken=latest` est le mécanisme
 *  documenté par Graph pour ça, bien moins coûteux qu'un premier parcours
 *  complet de la boîte. */
async function bootstrapMicrosoftDeltaLink(token: string, folder: 'Inbox' | 'SentItems'): Promise<string | null> {
  const response = await fetch(`https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages/delta?$deltatoken=latest&$select=${MS_DELTA_SELECT}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) return null
  const data = await response.json()
  return data['@odata.deltaLink'] ?? null
}

/** Ingestion incrémentale Microsoft : ne renvoie que les changements depuis
 *  `deltaLink`. `expired: true` (Graph renvoie 410 Gone) signale un lien trop
 *  ancien : l'appelant doit retomber en mode backfill. */
async function graphDeltaMessages(token: string, folder: 'Inbox' | 'SentItems', ownEmail: string, deltaLink: string): Promise<{ messages: Mail[]; newDeltaLink: string | null; expired: boolean }> {
  let url: string | null = deltaLink
  const raw: any[] = []
  let newDeltaLink: string | null = null
  while (url) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (response.status === 410) return { messages: [], newDeltaLink: null, expired: true }
    if (!response.ok) throw new Error(`Microsoft Graph delta ${response.status}`)
    const page = await response.json()
    raw.push(...(page.value ?? []))
    if (page['@odata.deltaLink']) newDeltaLink = page['@odata.deltaLink']
    url = page['@odata.nextLink'] ?? null
  }
  const messages = raw.filter((message: any) => !message['@removed']).map((message: any) => {
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
      body: sanitizeBody(message.body?.content ?? ''),
      direction: folder === 'SentItems' || from.email === ownEmail ? 'outbound' as const : 'inbound' as const,
    }
  })
  return { messages, newDeltaLink, expired: false }
}

/** Confiance en pourcentage entier 0-100 : le modèle renvoie parfois un ratio 0-1
 *  (0.9) que les colonnes integer rejettent — on normalise et on arrondit. */
function pct(value: unknown): number {
  const parsed = Number(value ?? 0)
  if (!Number.isFinite(parsed)) return 0
  return Math.round(Math.max(0, Math.min(100, parsed <= 1 ? parsed * 100 : parsed)))
}

function extractJson(value: string): Analysis {
  const normalized = value.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')

  try { return JSON.parse(normalized) } catch {
    // Certains modèles ajoutent une courte phrase avant/après le JSON. On
    // cherche alors un objet complet en respectant les accolades présentes
    // dans les chaînes, plutôt que de prendre aveuglément de la première à
    // la dernière accolade.
    for (let start = normalized.indexOf('{'); start >= 0; start = normalized.indexOf('{', start + 1)) {
      let depth = 0
      let inString = false
      let escaped = false
      for (let index = start; index < normalized.length; index++) {
        const char = normalized[index]
        if (inString) {
          if (escaped) escaped = false
          else if (char === '\\') escaped = true
          else if (char === '"') inString = false
          continue
        }
        if (char === '"') inString = true
        else if (char === '{') depth++
        else if (char === '}' && --depth === 0) {
          try { return JSON.parse(normalized.slice(start, index + 1)) } catch { break }
        }
      }
    }
    throw new Error('Analyse IA non parsable')
  }
}

function openRouterContent(data: any): string {
  const content = data?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === 'string' ? part : String(part?.text ?? '')).join('')
  }
  return ''
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>
    return String(value.message ?? value.error_description ?? value.details ?? JSON.stringify(value))
  }
  return String(error ?? 'analyse impossible')
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function maturityFor(interactionCount: number): 'none' | 'emerging' | 'usable' | 'consolidated' | 'refined' {
  if (interactionCount < 3) return 'none'
  if (interactionCount < 10) return 'emerging'
  if (interactionCount < 25) return 'usable'
  if (interactionCount < 50) return 'consolidated'
  return 'refined'
}

const PRIMARY_AXIS_IDS = [
  'rythme',
  'argumentation',
  'engagement',
  'registre',
  'tonalite',
  'espace_parole',
] as const

function structuredBehavioralSignals(profile: Record<string, unknown>): Array<{ trait: string; observation: string; confidence: number }> {
  const axes = asRecord(profile.primary_axes)
  return PRIMARY_AXIS_IDS.flatMap((trait) => {
    const axis = asRecord(axes[trait])
    const observation = typeof axis.observation === 'string' ? axis.observation.trim() : ''
    if (!observation || axis.status === 'insufficient') return []
    return [{ trait, observation, confidence: pct(axis.confidence) }]
  })
}

function assertCurrentCognitiveSchema(profile: Record<string, unknown>): void {
  if (Number(profile.schema_version) !== 3) throw new Error('Le moteur a retourné un profil comportemental dans un ancien format.')
  const axes = asRecord(profile.primary_axes)
  const missing = PRIMARY_AXIS_IDS.filter((axisId) => !axes[axisId] || typeof axes[axisId] !== 'object')
  if (missing.length) throw new Error(`Profil comportemental incomplet : axes manquants (${missing.join(', ')}).`)
}

function isRetriableAnalysisError(error: unknown): boolean {
  const message = errorMessage(error)
  return message === 'Analyse IA non parsable'
    || message === 'Le moteur a retourné un profil comportemental dans un ancien format.'
    || message.startsWith('Profil comportemental incomplet :')
}

async function analyze(
  name: string,
  role: 'responsable' | 'contact',
  excerpts: string[],
  previousProfile: Record<string, unknown> = {},
  interactionCount = excerpts.length,
): Promise<Analysis> {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY')
  if (!apiKey) throw new Error('OPENROUTER_API_KEY non configurée')
  const corpus = excerpts.slice(-30).join('\n---\n').slice(0, 16000)
  // Une fiche V1/V2 ne doit servir ni de contrat de sortie ni d'exemple au
  // modèle : il avait tendance à en recopier la structure. Elle sera
  // reconstruite depuis les preuves, puis les prochains calculs V3 pourront
  // de nouveau utiliser la continuité statistique du profil précédent.
  const compatiblePreviousProfile = Number(previousProfile.schema_version) === 3 ? previousProfile : {}
  const previous = Object.keys(compatiblePreviousProfile).length ? JSON.stringify(compatiblePreviousProfile).slice(0, 8000) : '{}'
  const prompt = `Tu construis le profil comportemental évolutif de ${name}, ${role === 'responsable' ? 'responsable de compte connecté' : 'personne suivie'}.
Tu disposes de ${interactionCount} interactions attribuées à cette personne. Analyse uniquement ce qu'elle a réellement rédigé dans les emails ou prononcé dans les passages de réunion explicitement attribués. Le profil précédent sert de mémoire statistique : conserve une tendance si les nouvelles preuves la confirment, nuance-la si elles la contredisent, et ne la remplace jamais sans preuves convergentes.

Règles impératives :
- aucune pathologie, donnée sensible ou personnalité essentialisée ;
- aucune citation mot pour mot ni texte d'exemple dans "observation" — seule "evidence" peut paraphraser un verbatim daté ;
- chaque observation doit être une paraphrase propre à cette personne ;
- les identifiants et axes du schéma sont fixes et doivent tous être présents ;
- status vaut "observed" si plusieurs preuves convergent, "emerging" si la tendance reste fragile, "insufficient" sans preuve ;
- pour "insufficient", tous les champs numériques et textuels de l'axe valent null et "evidence" est vide ;
- pour interpersonal/posture (inchangés) : score et confidence entre 0 et 100, evolution vaut "rising"/"stable"/"declining"/"mixed"/null ; assertiveness conciliant(0)→assertif(100), warmth distant(0)→chaleureux(100) ;
- pour chaque axe primaire (primary_axes) : "raw_score" est la position 0-100 sur l'axe du pôle gauche (0) vers le pôle droit (100) — rythme Posé(0)→Rapide(100), argumentation Récit(0)→Chiffré(100), engagement Implicite(0)→Explicite(100), registre Formel(0)→Direct(100), tonalité Sobre(0)→Chaleureux(100), espace_parole Écoute(0)→Occupe(100) ; "margin_pts" est TON incertitude estimée en points (peu de preuves → marge large, ex. 15-20 ; preuves nombreuses et convergentes → marge étroite, ex. 5-8) ; "trend_pts" est le delta signé de "raw_score" par rapport au profil précédent sur la période récente (null si aucun profil précédent ou axe alors insuffisant), "trend_label" vaut "rising"/"stable"/"declining" en cohérence avec le signe (stable si |trend_pts| <= 3) ; "evidence" contient 2 à 3 items COURTS mélangeant si possible un verbatim paraphrasé daté (jamais mot pour mot), une observation quantifiée (durée, fréquence), et un ratio/compte ;
- pour chaque axe secondaire (secondary_axes) : "score" suit la même échelle 0-100 pôle gauche→droit (orientation Tâche(0)→Relation(100), certainty Prudent(0)→Affirmatif(100), novelty Éprouvé(0)→Exploratoire(100), initiative Suit(0)→Mène(100)) ; pas de champ "evidence" ici, seulement "observation" ;
- evidence_count compte les preuves distinctes ; source_types contient uniquement les valeurs réellement présentes parmi "email" et "meeting_transcript".

Réponds uniquement avec ce JSON strict :
{
  "executive_summary": "synthèse personnalisée ou null",
  "cognitive_mode": "posture dominante personnalisée ou null",
  "cognitive_mode_confidence": 0,
  "global_confidence": 0,
  "cognitive_profile_data": {
    "schema_version": 3,
    "interpersonal": {
      "assertiveness": {"status":"insufficient","score":null,"label":null,"observation":null,"confidence":null,"evidence_count":0,"source_types":[],"evolution":null},
      "warmth": {"status":"insufficient","score":null,"label":null,"observation":null,"confidence":null,"evidence_count":0,"source_types":[],"evolution":null}
    },
    "primary_axes": {
      "rythme": {"status":"insufficient","raw_score":null,"margin_pts":null,"trend_pts":null,"trend_label":null,"observation":null,"confidence":null,"evidence":[],"evidence_count":0,"source_types":[]},
      "argumentation": {"status":"insufficient","raw_score":null,"margin_pts":null,"trend_pts":null,"trend_label":null,"observation":null,"confidence":null,"evidence":[],"evidence_count":0,"source_types":[]},
      "engagement": {"status":"insufficient","raw_score":null,"margin_pts":null,"trend_pts":null,"trend_label":null,"observation":null,"confidence":null,"evidence":[],"evidence_count":0,"source_types":[]},
      "registre": {"status":"insufficient","raw_score":null,"margin_pts":null,"trend_pts":null,"trend_label":null,"observation":null,"confidence":null,"evidence":[],"evidence_count":0,"source_types":[]},
      "tonalite": {"status":"insufficient","raw_score":null,"margin_pts":null,"trend_pts":null,"trend_label":null,"observation":null,"confidence":null,"evidence":[],"evidence_count":0,"source_types":[]},
      "espace_parole": {"status":"insufficient","raw_score":null,"margin_pts":null,"trend_pts":null,"trend_label":null,"observation":null,"confidence":null,"evidence":[],"evidence_count":0,"source_types":[]}
    },
    "secondary_axes": {
      "orientation": {"status":"insufficient","score":null,"observation":null,"confidence":null,"evidence_count":0,"source_types":[]},
      "certainty": {"status":"insufficient","score":null,"observation":null,"confidence":null,"evidence_count":0,"source_types":[]},
      "novelty": {"status":"insufficient","score":null,"observation":null,"confidence":null,"evidence_count":0,"source_types":[]},
      "initiative": {"status":"insufficient","score":null,"observation":null,"confidence":null,"evidence_count":0,"source_types":[]}
    },
    "posture": {"status":"insufficient","score":null,"label":null,"observation":null,"confidence":null,"evidence_count":0,"source_types":[],"evolution":null}
  }
}

Profil précédent : ${previous}
Nouveaux extraits :\n${corpus}`
  const requestAnalysis = async (retry: boolean): Promise<Analysis> => {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': Deno.env.get('SITE_URL') ?? 'https://tohu.app', 'X-Title': 'Tohu Email Behavior Analysis' },
      body: JSON.stringify({
        model: Deno.env.get('OPENROUTER_MODEL') ?? 'google/gemini-2.5-flash-lite',
        temperature: retry ? 0 : 0.1,
        response_format: COGNITIVE_PROFILE_RESPONSE_FORMAT,
        // Empêche OpenRouter de choisir un fournisseur qui ignorerait le
        // JSON Schema et retomberait silencieusement sur l'ancien format.
        provider: { require_parameters: true },
        max_tokens: retry ? 7000 : 6000,
        messages: [{
          role: 'user',
          content: retry
            ? `${prompt}\n\nIMPORTANT : la tentative précédente a produit un JSON invalide, tronqué ou dans un ancien schéma. Repars exclusivement du contrat ci-dessus : cognitive_profile_data.schema_version doit valoir 3 et les six primary_axes doivent tous être présents. Réponds de façon compacte, sans Markdown ni commentaire avant ou après l'objet JSON, et ferme impérativement toutes les structures JSON.`
            : prompt,
        }],
      }),
    })
    if (!response.ok) throw new Error(`OpenRouter ${response.status}`)
    const data = await response.json()
    const content = openRouterContent(data)
    try {
      const result = extractJson(content)
      assertCurrentCognitiveSchema(asRecord(result.cognitive_profile_data))
      return result
    } catch (error) {
      // Ne jamais journaliser `content` : il peut contenir des paraphrases
      // issues des emails. Les métadonnées suffisent au diagnostic.
      console.warn('Réponse comportementale invalide', {
        retry,
        finishReason: data?.choices?.[0]?.finish_reason ?? null,
        contentLength: content.length,
        validationError: errorMessage(error),
      })
      throw error
    }
  }

  try {
    return await requestAnalysis(false)
  } catch (error) {
    if (!isRetriableAnalysisError(error)) throw error
    return await requestAnalysis(true)
  }
}

/** Priorité garantie à toute relation déjà suivie (personne OU entreprise) —
 *  dépasse largement tout score organique pour ne jamais être évincée par le
 *  volume d'un tiers non suivi, même très actif. */
const TRACKED_RELEVANCE_BOOST = 100_000
const MISSING_V3_PROFILE_BOOST = 200_000

type RelevanceStat = { inbound: number; outbound: number; lastSentAt: string; messages: Mail[] }

/** Décide, sur toute la fenêtre découverte (pas seulement les plus récents),
 *  quels messages ont droit au traitement complet (corps + stockage) — par
 *  pertinence de la relation (suivi, fréquence, réciprocité, récence) plutôt
 *  que par simple position chronologique dans une boîte parfois très bruitée. */
function selectMessagesByRelevance(
  messages: Mail[],
  ownEmail: string,
  contactByEmail: Map<string, any>,
  trackedDomains: Set<string>,
  trackedCompanyIds: Set<string>,
  currentV3ProfileContactIds: Set<string>,
  budget: number,
): { selectedIds: Set<string>; contactsPrioritized: number; missingProfileContactIds: Set<string> } {
  const statsByEmail = new Map<string, RelevanceStat>()
  for (const message of messages) {
    const externals = (message.direction === 'inbound' ? [message.from] : message.to)
      .filter((item) => item.email && item.email !== ownEmail)
    for (const external of externals) {
      const contact = contactByEmail.get(external.email)
      const sourceSummary = contact?.source_summary as Record<string, unknown> | undefined
      const manuallyIntegrated = ['manual', 'manual_integration'].includes(String(
        sourceSummary?.last_identity_source ?? sourceSummary?.source ?? sourceSummary?.discovered_from ?? '',
      ))
      const classification = classifyEmailAutomation({
        email: external.email, name: external.name, subject: message.subject, body: message.body, headers: message.headers,
      })
      if (classification.automated && !manuallyIntegrated) continue
      const stat = statsByEmail.get(external.email) ?? { inbound: 0, outbound: 0, lastSentAt: message.sentAt, messages: [] }
      if (message.direction === 'inbound') stat.inbound++
      else stat.outbound++
      if (message.sentAt > stat.lastSentAt) stat.lastSentAt = message.sentAt
      stat.messages.push(message)
      statsByEmail.set(external.email, stat)
    }
  }

  const now = Date.now()
  const ranked = [...statsByEmail.entries()].map(([email, stat]) => {
    const contact = contactByEmail.get(email)
    const domain = corporateDomain(email)
    const tracked = contact?.is_tracked === true
      || trackedCompanyIds.has(String(contact?.company_id ?? ''))
      || (domain !== null && trackedDomains.has(domain))
    const missingCurrentProfile = tracked && contact?.id && !currentV3ProfileContactIds.has(String(contact.id))
    const total = stat.inbound + stat.outbound
    const reciprocityBonus = stat.inbound > 0 && stat.outbound > 0 ? total * 0.5 : 0
    const recencyDays = (now - new Date(stat.lastSentAt).getTime()) / 86_400_000
    const recencyBonus = Math.max(0, 60 - recencyDays)
    const score = (missingCurrentProfile ? MISSING_V3_PROFILE_BOOST : tracked ? TRACKED_RELEVANCE_BOOST : 0)
      + total + reciprocityBonus + recencyBonus
    return { email, score, stat, contactId: contact?.id ? String(contact.id) : null, missingCurrentProfile }
  }).sort((a, b) => b.score - a.score)

  const missingProfileContactIds = new Set(ranked
    .filter((entry) => entry.missingCurrentProfile && entry.contactId && entry.stat.inbound >= 3)
    .map((entry) => entry.contactId as string))

  const selectedIds = new Set<string>()
  let remaining = budget
  let contactsPrioritized = 0
  for (const entry of ranked) {
    if (remaining <= 0) break
    const topMessages = [...entry.stat.messages].sort((a, b) => b.sentAt.localeCompare(a.sentAt)).slice(0, PER_CONTACT_MAX_MESSAGES)
    let addedForThisContact = false
    for (const message of topMessages) {
      if (remaining <= 0) break
      if (selectedIds.has(message.id)) continue
      selectedIds.add(message.id)
      remaining--
      addedForThisContact = true
    }
    if (addedForThisContact) contactsPrioritized++
  }
  return { selectedIds, contactsPrioritized, missingProfileContactIds }
}

type SyncParams = {
  supabase: ReturnType<typeof createClient>
  organizationId: string
  provider: 'google' | 'microsoft'
  actingUserId: string
  actingUserEmail: string | null
  connector: { id: string; metadata: any }
  jobId: string | null
  manualContactId?: string | null
}

/** Cœur de la synchronisation, extrait pour être appelable soit une fois
 *  (déclenchement interactif, JWT utilisateur) soit en boucle sur plusieurs
 *  connecteurs (tick cron de reprise du backfill, multi-tenant). Ne lève
 *  jamais — retourne { success:false, error } pour que l'appelant en boucle
 *  puisse continuer sur les connecteurs suivants sans s'interrompre. */
async function runEmailSync(params: SyncParams): Promise<Record<string, unknown>> {
  const { supabase, organizationId, provider, actingUserId, actingUserEmail, connector } = params
  const manualContactId = params.manualContactId ?? null
  let syncJobId: string | null = params.jobId
  const startedAt = new Date().toISOString()
  try {
    const { data: tokenRows, error: tokenError } = await supabase.rpc('get_oauth_tokens_server', { p_connector_id: connector.id })
    const oauth = tokenRows?.[0]
    if (tokenError || !oauth) throw new Error('Jetons OAuth absents. Reconnecte le fournisseur.')

    if (syncJobId) {
      await supabase.from('sync_jobs').update({ connector_id: connector.id, provider, status: 'running', current_step: 'Connexion au fournisseur', progress: 10, started_at: startedAt, payload: { provider } }).eq('id', syncJobId)
    } else {
      const { data: job } = await supabase.from('sync_jobs').insert({
        organization_id: organizationId,
        connector_id: connector.id,
        user_id: actingUserId,
        provider,
        job_type: 'email_behavior_analysis',
        status: 'running',
        current_step: 'Connexion au fournisseur',
        progress: 10,
        started_at: startedAt,
        payload: { provider, contact_id: manualContactId },
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

    const ownEmail = cleanEmail((connector.metadata as any)?.account_email ?? actingUserEmail)
    let targetEmails: string[] = []
    if (manualContactId) {
      const [{ data: target, error: targetError }, { data: targetAliases, error: aliasError }] = await Promise.all([
        supabase.from('contacts')
          .select('email,secondary_emails')
          .eq('organization_id', organizationId)
          .eq('id', manualContactId)
          .is('merged_into_contact_id', null)
          .maybeSingle(),
        supabase.from('contact_identity_aliases')
          .select('identity_value')
          .eq('organization_id', organizationId)
          .eq('contact_id', manualContactId)
          .eq('identity_type', 'email'),
      ])
      if (targetError) throw targetError
      if (aliasError) throw aliasError
      if (!target) throw new Error('Personne introuvable dans cet espace.')
      targetEmails = [...new Set([
        target.email,
        ...(target.secondary_emails ?? []),
        ...(targetAliases ?? []).map((alias: any) => alias.identity_value),
      ].map(cleanEmail).filter(Boolean))]
      if (!targetEmails.length) throw new Error('Aucune adresse email disponible pour cette personne.')
    }
    // Reprise de backfill : si une passe précédente s'est arrêtée avant la fin
    // de la fenêtre de 2 ans (discovery_truncated), on continue plus loin dans
    // le passé plutôt que de tout rescanner depuis le début.
    const backfillBefore: string | null = manualContactId ? null : (connector.metadata as any)?.backfill_before ?? null
    const rawScan = provider === 'google'
      ? await gmailMessages(accessToken, ownEmail, backfillBefore, targetEmails)
      : manualContactId
        ? await microsoftTargetMessages(accessToken, ownEmail, targetEmails)
        : await microsoftMessages(accessToken, ownEmail, backfillBefore)
    const scan = manualContactId
      ? {
          ...rawScan,
          messages: rawScan.messages.filter((message) =>
            [message.from.email, ...message.to.map((recipient) => recipient.email)].some((email) => targetEmails.includes(cleanEmail(email))),
          ),
        }
      : rawScan
    const messages = scan.messages
    if (syncJobId) await supabase.from('sync_jobs').update({ current_step: 'Lecture des métadonnées autorisées', progress: 35 }).eq('id', syncJobId)
    const [
      { data: existingContacts },
      { data: identityAliases, error: identityAliasError },
      { data: trackedCompanyRows, error: trackedCompaniesError },
      { data: existingProfileRows, error: existingProfilesError },
    ] = await Promise.all([
      supabase.from('contacts').select('id,email,secondary_emails,full_name,owner_user_id,source_summary,is_tracked,company_id').eq('organization_id', organizationId).is('merged_into_contact_id', null),
      supabase.from('contact_identity_aliases').select('contact_id,identity_value').eq('organization_id', organizationId).eq('identity_type', 'email'),
      supabase.from('companies').select('id,domain').eq('organization_id', organizationId).eq('is_tracked', true),
      supabase.from('cognitive_profiles').select('contact_id,cognitive_profile_data').eq('organization_id', organizationId).eq('profile_version', 1),
    ])
    if (identityAliasError) throw identityAliasError
    if (trackedCompaniesError) throw trackedCompaniesError
    if (existingProfilesError) throw existingProfilesError
    const contactByEmail = new Map<string, any>()
    const contactById = new Map<string, any>()
    for (const item of existingContacts ?? []) {
      contactById.set(String(item.id), item)
      for (const email of [item.email, ...(item.secondary_emails ?? [])]) {
        const normalized = cleanEmail(email)
        if (normalized) contactByEmail.set(normalized, item)
      }
    }
    for (const alias of identityAliases ?? []) {
      const contact = contactById.get(String(alias.contact_id))
      const normalized = cleanEmail(alias.identity_value)
      if (contact && normalized) contactByEmail.set(normalized, contact)
    }
    // En relecture ciblée, la fiche explicitement demandée est autoritaire.
    // Une ancienne identité alias peut encore pointer vers un doublon et ne
    // doit jamais détourner ses messages vers une autre fiche.
    if (manualContactId) {
      const targetContact = contactById.get(manualContactId)
      if (targetContact) {
        for (const email of targetEmails) contactByEmail.set(email, targetContact)
      }
    }

    // Qui a droit au traitement complet (corps + stockage) se décide par
    // pertinence de la relation sur toute la fenêtre découverte, pas par
    // simple position chronologique — une boîte très bruitée noierait sinon
    // les vraies relations derrière du volume automatisé récent.
    const trackedDomains = new Set((trackedCompanyRows ?? []).map((row: any) => String(row.domain ?? '').toLowerCase().trim()).filter(Boolean))
    const trackedCompanyIds = new Set((trackedCompanyRows ?? []).map((row: any) => String(row.id)))
    const currentV3ProfileContactIds = new Set((existingProfileRows ?? [])
      .filter((row: any) => Number(asRecord(row.cognitive_profile_data).schema_version) === 3)
      .map((row: any) => String(row.contact_id)))
    const relevance = manualContactId
      ? { selectedIds: new Set(messages.map((message) => message.id)), contactsPrioritized: targetEmails.length ? 1 : 0, missingProfileContactIds: new Set<string>() }
      : selectMessagesByRelevance(messages, ownEmail, contactByEmail, trackedDomains, trackedCompanyIds, currentV3ProfileContactIds, ANALYSIS_MAX_MESSAGES)
    for (const message of messages) message.discoveryOnly = !relevance.selectedIds.has(message.id)
    if (provider === 'google') await hydrateGmailBodies(accessToken, messages, relevance.selectedIds)

    const contactCorpus = new Map<string, string[]>()
    const responsibleCorpus: string[] = []
    let storedMessages = 0
    let skippedAutomated = 0
    const skippedReasons: Record<string, number> = {}
    let processedMessages = 0

    await runWithConcurrency(messages, MESSAGE_PROCESSING_CONCURRENCY, async (message) => {
      processedMessages++
      if (syncJobId && messages.length > 20 && processedMessages % 20 === 0) {
        void supabase.from('sync_jobs').update({ current_step: `Traitement des messages (${processedMessages}/${messages.length})`, progress: 35 + Math.round((processedMessages / messages.length) * 25) }).eq('id', syncJobId as string)
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
        const explicitlyTargeted = Boolean(manualContactId && contact?.id === manualContactId)
        if (classification.automated && !manuallyIntegrated && !explicitlyTargeted) {
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
            p_owner_user_id: actingUserId,
            p_role_title: null,
            p_source: `email_${provider}`,
          }).maybeSingle()
          if (error || !resolved?.contact_id) continue
          contact = { id: resolved.contact_id, email: external.email, full_name: cleanName(external.name, external.email), owner_user_id: actingUserId, is_tracked: false, company_id: companyId }
          contactByEmail.set(external.email, contact)
        } else if (!contact.owner_user_id) {
          await supabase.from('contacts').update({ owner_user_id: actingUserId }).eq('id', contact.id)
          contact.owner_user_id = actingUserId
        }
        messageContacts.push(contact)
      }

      const primaryContact = (manualContactId ? messageContacts.find((item) => item.id === manualContactId) : null)
        ?? messageContacts.find((item) => item.is_tracked === true)
        ?? messageContacts[0]
      if (!primaryContact || message.discoveryOnly) return
      const { data: thread } = await supabase.from('communication_threads').upsert({ organization_id: organizationId, provider, external_thread_id: message.threadId, subject: message.subject, updated_at: new Date().toISOString() }, { onConflict: 'organization_id,provider,external_thread_id' }).select('id').single()
      if (!thread) return
      const { error: messageError } = await supabase.from('communication_messages').upsert({ organization_id: organizationId, thread_id: thread.id, contact_id: primaryContact.id, provider, external_message_id: message.id, direction: message.direction, sent_at: message.sentAt, subject: message.subject, body_text: null, metadata: { from: message.from.email, to: message.to.map((item) => item.email), analyzed_without_body_storage: true } }, { onConflict: 'organization_id,provider,external_message_id' })
      if (!messageError) storedMessages++
      if (message.body && message.direction === 'outbound') responsibleCorpus.push(message.body)
      else if (message.body && (
        primaryContact.is_tracked === true
        || trackedCompanyIds.has(String(primaryContact.company_id ?? ''))
        || trackedDomains.has(corporateDomain(String(primaryContact.email ?? '')) ?? '')
        || primaryContact.id === manualContactId
      )) {
        contactCorpus.set(primaryContact.id, [...(contactCorpus.get(primaryContact.id) ?? []), `[Email]\n${message.body}`])
      }
    })

    if (syncJobId) await supabase.from('sync_jobs').update({ current_step: 'Détection des personnes et organisations', progress: 60 }).eq('id', syncJobId)

    const analysisErrors: string[] = []
    let responsibleAnalyzed = false
    if (!manualContactId && responsibleCorpus.length >= 3) {
      try {
        const result = await analyze((await supabase.from('profiles').select('full_name').eq('id', actingUserId).single()).data?.full_name ?? actingUserEmail ?? 'Responsable', 'responsable', responsibleCorpus)
        const cognitiveProfileData = asRecord(result.cognitive_profile_data)
        assertCurrentCognitiveSchema(cognitiveProfileData)
        const now = new Date().toISOString()
        await supabase.from('user_behavioral_profiles').upsert({
          organization_id: organizationId,
          user_id: actingUserId,
          global_confidence: pct(result.global_confidence),
          executive_summary: result.executive_summary ?? null,
          cognitive_mode: result.cognitive_mode ?? null,
          cognitive_mode_confidence: pct(result.cognitive_mode_confidence),
          behavioral_analysis_data: structuredBehavioralSignals(cognitiveProfileData),
          communication_style_data: asRecord(cognitiveProfileData.secondary_axes),
          cognitive_profile_data: cognitiveProfileData,
          source_message_count: responsibleCorpus.length,
          source_interaction_count: responsibleCorpus.length,
          maturity_level: maturityFor(responsibleCorpus.length),
          analysis_version: 3,
          last_analyzed_at: now,
          updated_from: [provider, 'email'],
          updated_at: now,
        }, { onConflict: 'organization_id,user_id' })
        responsibleAnalyzed = true
      } catch (error) {
        analysisErrors.push(`responsable: ${errorMessage(error)}`)
      }
    }

    let peopleAnalyzed = 0
    const emailCandidateIds = [...contactCorpus.entries()]
      .sort((a, b) => {
        const aMissing = currentV3ProfileContactIds.has(a[0]) ? 0 : 1
        const bMissing = currentV3ProfileContactIds.has(b[0]) ? 0 : 1
        return bMissing - aMissing || b[1].length - a[1].length
      })
      .slice(0, manualContactId ? 1 : PROFILE_ANALYSIS_MAX_CONTACTS)
      .map(([contactId]) => contactId)
    const meetingOnlyCandidateIds = manualContactId
      ? [manualContactId]
      : [...contactById.values()]
        .filter((contact) => (
          contact.is_tracked === true || trackedCompanyIds.has(String(contact.company_id ?? ''))
        ) && !contactCorpus.has(String(contact.id)))
        .sort((a, b) => {
          const aMissing = currentV3ProfileContactIds.has(String(a.id)) ? 0 : 1
          const bMissing = currentV3ProfileContactIds.has(String(b.id)) ? 0 : 1
          return bMissing - aMissing
        })
        .slice(0, MEETING_CORPUS_MAX_CONTACTS)
        .map((contact) => String(contact.id))
    const meetingCandidateIds = [...new Set([
      ...emailCandidateIds,
      ...meetingOnlyCandidateIds,
    ])]
    let meetingCorpus = new Map<string, MeetingCorpus>()
    try {
      meetingCorpus = await loadMeetingCorpus(
        supabase,
        organizationId,
        meetingCandidateIds,
        new Map([...contactById.values()].map((contact) => [String(contact.id), String(contact.full_name ?? '')])),
      )
    } catch (error) {
      analysisErrors.push(`transcriptions de réunion: ${errorMessage(error)}`)
    }
    for (const [contactId, corpus] of meetingCorpus) {
      if (corpus.meetingCount >= 3 && !currentV3ProfileContactIds.has(contactId)) {
        relevance.missingProfileContactIds.add(contactId)
      }
    }
    const combinedCorpus = new Map<string, string[]>()
    for (const contactId of meetingCandidateIds) {
      const excerpts = [...(contactCorpus.get(contactId) ?? []), ...(meetingCorpus.get(contactId)?.excerpts ?? [])]
      if (excerpts.length) combinedCorpus.set(contactId, excerpts)
    }
    // Toute nouvelle preuve peut affiner un profil existant. Le seuil de trois
    // porte sur le corpus attribué total, pas sur la seule passe courante.
    const candidates = [...combinedCorpus.entries()]
      .filter(([contactId, excerpts]) => excerpts.length > 0 && (!manualContactId || contactId === manualContactId))
      .sort((a, b) => {
        const aMissing = currentV3ProfileContactIds.has(a[0]) ? 0 : 1
        const bMissing = currentV3ProfileContactIds.has(b[0]) ? 0 : 1
        return bMissing - aMissing || b[1].length - a[1].length
      })
      .slice(0, manualContactId ? 1 : PROFILE_ANALYSIS_MAX_CONTACTS)
    let targetInteractionCount = 0
    for (let i = 0; i < candidates.length; i++) {
      const [contactId, excerpts] = candidates[i]
      try {
        const contact = contactById.get(contactId) ?? [...contactByEmail.values()].find((item) => item.id === contactId)
        const attributedMeetingCount = meetingCorpus.get(contactId)?.meetingCount ?? 0
        const [{ count: interactionCountRaw, error: countError }, { data: previousRaw, error: previousError }] = await Promise.all([
          supabase.from('communication_messages').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('contact_id', contactId).eq('direction', 'inbound'),
          supabase.from('cognitive_profiles').select('cognitive_profile_data').eq('organization_id', organizationId).eq('contact_id', contactId).eq('profile_version', 1).maybeSingle(),
        ])
        if (countError) throw countError
        if (previousError) throw previousError
        const messageCount = interactionCountRaw ?? 0
        const interactionCount = messageCount + attributedMeetingCount
        if (manualContactId && contactId === manualContactId) targetInteractionCount = interactionCount
        if (interactionCount < 3) continue
        const previousProfile = asRecord(previousRaw?.cognitive_profile_data)
        const result = await analyze(contact?.full_name ?? 'Contact', 'contact', excerpts, previousProfile, interactionCount)
        const cognitiveProfileData = asRecord(result.cognitive_profile_data)
        // Ne jamais remplacer un profil existant par une réponse ancienne ou
        // tronquée : le front V57 exige les six axes fixes de schema_version 3.
        assertCurrentCognitiveSchema(cognitiveProfileData)
        const structuredSignals = structuredBehavioralSignals(cognitiveProfileData)
        const now = new Date().toISOString()
        const { data: cognitiveProfile, error: profileError } = await supabase.from('cognitive_profiles').upsert({
          organization_id: organizationId,
          contact_id: contactId,
          profile_version: 1,
          global_confidence: pct(result.global_confidence),
          summary: result.executive_summary ?? null,
          executive_summary: result.executive_summary ?? null,
          cognitive_mode: result.cognitive_mode ?? null,
          cognitive_mode_confidence: pct(result.cognitive_mode_confidence),
          behavioral_analysis_data: structuredSignals,
          communication_style_data: asRecord(cognitiveProfileData.secondary_axes),
          cognitive_profile_data: cognitiveProfileData,
          source_message_count: messageCount,
          source_meeting_count: attributedMeetingCount,
          source_interaction_count: interactionCount,
          maturity_level: maturityFor(interactionCount),
          analysis_version: 3,
          last_analyzed_at: now,
          updated_from: attributedMeetingCount ? [provider, 'email', 'meeting_transcript'] : [provider, 'email'],
          updated_at: now,
        }, { onConflict: 'organization_id,contact_id,profile_version' }).select('id').single()
        if (profileError || !cognitiveProfile) throw profileError ?? new Error('Profil cognitif non enregistré')
        const signalSource = attributedMeetingCount ? 'mixed_exchange_analysis' : `email_${provider}_analysis`
        const signals = structuredSignals.map((item) => ({ organization_id: organizationId, contact_id: contactId, profile_id: cognitiveProfile.id, signal_type: item.trait, text: item.observation, inference: item.trait, inference_level: 'observable', confidence: pct(item.confidence), source_type: signalSource, source_ref: `sync:${now}`, observed_at: now }))
        if (signals.length) {
          const { error: signalsError } = await supabase.from('behavioral_signals').insert(signals)
          if (signalsError) throw signalsError
        }
        currentV3ProfileContactIds.add(contactId)
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

    // Curseur de reprise : tant que la fenêtre découverte n'est pas
    // entièrement couverte (discovery_truncated), on avance le point de
    // reprise plus loin dans le passé pour la prochaine passe (manuelle ou
    // via le cron de continuation) plutôt que de repartir de zéro.
    const backfillComplete = manualContactId ? Boolean((connector.metadata as any)?.backfill_complete) : !scan.truncated
    const nextBackfillBefore = backfillComplete
      ? null
      : provider === 'google'
        ? (scan.oldestSentAt ? toGmailDateOnly(scan.oldestSentAt) : backfillBefore)
        : (scan.oldestSentAt ?? backfillBefore)

    // Le backfill vient de se terminer : on capture le curseur incrémental
    // (Partie C) juste après cette passe, pour qu'il n'y ait aucun trou entre
    // ce que le backfill a couvert et le point de départ de l'ingestion continue.
    const incrementalCursorPatch: Record<string, unknown> = {}
    if (backfillComplete && !manualContactId) {
      if (provider === 'google') {
        const historyId = await bootstrapGmailHistoryId(accessToken)
        if (historyId) incrementalCursorPatch.gmail_history_id = historyId
      } else {
        const [deltaInbox, deltaSent] = await Promise.all([
          bootstrapMicrosoftDeltaLink(accessToken, 'Inbox'),
          bootstrapMicrosoftDeltaLink(accessToken, 'SentItems'),
        ])
        if (deltaInbox) incrementalCursorPatch.ms_delta_link_inbox = deltaInbox
        if (deltaSent) incrementalCursorPatch.ms_delta_link_sent = deltaSent
      }
    }

    const profilesPending = [...relevance.missingProfileContactIds]
      .filter((contactId) => !currentV3ProfileContactIds.has(contactId)).length
    const syncSummary = {
      messages: storedMessages,
      messages_scanned: messages.length,
      discovery_truncated: scan.truncated,
      organizations_detected: discoveredDomains,
      people_analyzed: peopleAnalyzed,
      responsible_analyzed: responsibleAnalyzed,
      automated_messages_ignored: skippedAutomated,
      ignored_reasons: skippedReasons,
      relationships_prioritized: relevance.contactsPrioritized,
      profiles_pending: profilesPending,
      backfill_complete: backfillComplete,
    }
    const targetDiagnostics = manualContactId ? {
      messagesScanned: messages.length,
      inboundMessages: messages.filter((message) => message.direction === 'inbound' && targetEmails.includes(message.from.email)).length,
      emailExcerpts: contactCorpus.get(manualContactId)?.length ?? 0,
      meetingExcerpts: meetingCorpus.get(manualContactId)?.excerpts.length ?? 0,
      attributedInteractions: targetInteractionCount,
    } : {}
    const connectorMetadata = manualContactId
      ? { ...(connector.metadata ?? {}), last_manual_cognitive_sync: { contact_id: manualContactId, at: new Date().toISOString(), ...syncSummary } }
      : { ...(connector.metadata ?? {}), last_sync: syncSummary, profile_backfill_pending: profilesPending, backfill_complete: backfillComplete, backfill_before: nextBackfillBefore, ...incrementalCursorPatch }
    await supabase.from('connectors').update({
      status: 'connected',
      last_synced_at: new Date().toISOString(),
      metadata: connectorMetadata,
      updated_at: new Date().toISOString(),
    }).eq('id', connector.id)
    if (syncJobId) await supabase.from('sync_jobs').update({ status: 'succeeded', current_step: 'Synchronisation terminée', progress: 100, completed_at: new Date().toISOString(), payload: { provider, contact_id: manualContactId, ...syncSummary, analysis_errors: analysisErrors.slice(0, 5) } }).eq('id', syncJobId)
    return { success: true, contactId: manualContactId, messages: storedMessages, responsibleAnalyzed, peopleAnalyzed, profilesPending, automatedMessagesIgnored: skippedAutomated, analysisErrors: analysisErrors.slice(0, 5), backfillComplete, ...targetDiagnostics }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Synchronisation impossible'
    if (syncJobId) {
      await supabase.from('sync_jobs').update({ status: 'failed', current_step: 'Échec de la synchronisation', error_code: 'EMAIL_SYNC_FAILED', error_message: message, completed_at: new Date().toISOString() }).eq('id', syncJobId)
    }
    return { success: false, error: message }
  }
}

/** Ingestion quasi temps réel (Partie C) pour un connecteur déjà entièrement
 *  backfillé : ne va chercher que ce qui est arrivé depuis le dernier tick
 *  (History API Gmail / delta Microsoft), sans rejouer le budget de
 *  pertinence du backfill complet — le volume attendu par tick est faible,
 *  chaque nouveau message reçoit directement le traitement complet. Ne fait
 *  pas de ré-analyse comportementale (coûteuse en LLM) à chaque tick : ça
 *  reste porté par le cycle habituel (score-batch / prochain backfill). */
async function runIncrementalSync(params: SyncParams): Promise<Record<string, unknown>> {
  const { supabase, organizationId, provider, actingUserId, actingUserEmail, connector } = params
  try {
    const { data: tokenRows, error: tokenError } = await supabase.rpc('get_oauth_tokens_server', { p_connector_id: connector.id })
    const oauth = tokenRows?.[0]
    if (tokenError || !oauth) throw new Error('Jetons OAuth absents.')

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

    const ownEmail = cleanEmail((connector.metadata as any)?.account_email ?? actingUserEmail)
    let messages: Mail[] = []
    let expired = false
    const cursorPatch: Record<string, unknown> = {}

    if (provider === 'google') {
      const historyId = (connector.metadata as any)?.gmail_history_id ?? null
      if (!historyId) throw new Error('Curseur Gmail manquant — attend le prochain backfill complet.')
      const result = await gmailIncrementalMessages(accessToken, ownEmail, historyId)
      expired = result.expired
      messages = result.messages
      if (!expired && result.newHistoryId) cursorPatch.gmail_history_id = result.newHistoryId
    } else {
      const deltaInbox = (connector.metadata as any)?.ms_delta_link_inbox ?? null
      const deltaSent = (connector.metadata as any)?.ms_delta_link_sent ?? null
      if (!deltaInbox || !deltaSent) throw new Error('Curseur Microsoft manquant — attend le prochain backfill complet.')
      const [inbox, sent] = await Promise.all([
        graphDeltaMessages(accessToken, 'Inbox', ownEmail, deltaInbox),
        graphDeltaMessages(accessToken, 'SentItems', ownEmail, deltaSent),
      ])
      expired = inbox.expired || sent.expired
      messages = [...inbox.messages, ...sent.messages]
      if (!expired) {
        if (inbox.newDeltaLink) cursorPatch.ms_delta_link_inbox = inbox.newDeltaLink
        if (sent.newDeltaLink) cursorPatch.ms_delta_link_sent = sent.newDeltaLink
      }
    }

    if (expired) {
      // Curseur trop ancien (inactivité prolongée) : on retombe en mode
      // backfill plutôt que de laisser l'ingestion continue en échec silencieux —
      // un futur tick de backfill regénérera un curseur frais une fois complet.
      await supabase.from('connectors').update({
        metadata: { ...(connector.metadata ?? {}), backfill_complete: false, backfill_before: null, gmail_history_id: null, ms_delta_link_inbox: null, ms_delta_link_sent: null },
        updated_at: new Date().toISOString(),
      }).eq('id', connector.id)
      return { success: true, expired: true, messages: 0 }
    }

    if (!messages.length) {
      if (Object.keys(cursorPatch).length) {
        await supabase.from('connectors').update({ metadata: { ...(connector.metadata ?? {}), ...cursorPatch }, updated_at: new Date().toISOString() }).eq('id', connector.id)
      }
      return { success: true, messages: 0 }
    }

    const [{ data: existingContacts }, { data: identityAliases, error: identityAliasError }] = await Promise.all([
      supabase.from('contacts').select('id,email,secondary_emails,full_name,owner_user_id,source_summary,is_tracked').eq('organization_id', organizationId).is('merged_into_contact_id', null),
      supabase.from('contact_identity_aliases').select('contact_id,identity_value').eq('organization_id', organizationId).eq('identity_type', 'email'),
    ])
    if (identityAliasError) throw identityAliasError
    const contactByEmail = new Map<string, any>()
    const contactById = new Map<string, any>()
    for (const item of existingContacts ?? []) {
      contactById.set(String(item.id), item)
      for (const email of [item.email, ...(item.secondary_emails ?? [])]) {
        const normalized = cleanEmail(email)
        if (normalized) contactByEmail.set(normalized, item)
      }
    }
    for (const alias of identityAliases ?? []) {
      const contact = contactById.get(String(alias.contact_id))
      const normalized = cleanEmail(alias.identity_value)
      if (contact && normalized) contactByEmail.set(normalized, contact)
    }

    let storedMessages = 0
    await runWithConcurrency(messages, MESSAGE_PROCESSING_CONCURRENCY, async (message) => {
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
        const classification = classifyEmailAutomation({ email: external.email, name: external.name, subject: message.subject, body: message.body, headers: message.headers })
        if (classification.automated && !manuallyIntegrated) continue
        if (!contact) {
          let companyId: string | null = null
          const domain = corporateDomain(external.email)
          if (domain) {
            const { data: company } = await supabase.rpc('resolve_company_identity', { p_organization_id: organizationId, p_name: companyNameFromDomain(domain), p_domain: domain, p_industry: null, p_create_if_missing: true }).maybeSingle()
            companyId = company?.company_id ?? null
          }
          const { data: resolved, error } = await supabase.rpc('resolve_contact_identity', { p_organization_id: organizationId, p_email: external.email, p_full_name: cleanName(external.name, external.email), p_company_id: companyId, p_owner_user_id: actingUserId, p_role_title: null, p_source: `email_${provider}` }).maybeSingle()
          if (error || !resolved?.contact_id) continue
          contact = { id: resolved.contact_id, email: external.email, full_name: cleanName(external.name, external.email), owner_user_id: actingUserId, is_tracked: false }
          contactByEmail.set(external.email, contact)
        } else if (!contact.owner_user_id) {
          await supabase.from('contacts').update({ owner_user_id: actingUserId }).eq('id', contact.id)
          contact.owner_user_id = actingUserId
        }
        messageContacts.push(contact)
      }
      const primaryContact = messageContacts.find((item) => item.is_tracked === true) ?? messageContacts[0]
      if (!primaryContact) return
      const { data: thread } = await supabase.from('communication_threads').upsert({ organization_id: organizationId, provider, external_thread_id: message.threadId, subject: message.subject, updated_at: new Date().toISOString() }, { onConflict: 'organization_id,provider,external_thread_id' }).select('id').single()
      if (!thread) return
      const { error: messageError } = await supabase.from('communication_messages').upsert({ organization_id: organizationId, thread_id: thread.id, contact_id: primaryContact.id, provider, external_message_id: message.id, direction: message.direction, sent_at: message.sentAt, subject: message.subject, body_text: null, metadata: { from: message.from.email, to: message.to.map((item) => item.email), analyzed_without_body_storage: true } }, { onConflict: 'organization_id,provider,external_message_id' })
      if (!messageError) storedMessages++
    })

    await supabase.from('connectors').update({
      metadata: { ...(connector.metadata ?? {}), ...cursorPatch },
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', connector.id)
    return { success: true, messages: storedMessages }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Ingestion incrémentale impossible' }
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const body = await request.json().catch(() => ({} as any))

  // Mode cron : reprise automatique du backfill pour les connecteurs pas
  // encore complets, tous organismes confondus (même mécanisme d'authentification
  // que monitor-contacts/monitor-company-news — x-cron-secret contre app_secrets).
  const cronHeader = request.headers.get('x-cron-secret')
  let isCron = false
  if (cronHeader) {
    const { data: secret } = await supabase.from('app_secrets').select('value').eq('name', 'monitor_cron').maybeSingle()
    if (secret?.value && secret.value === cronHeader) isCron = true
  }

  if (isCron) {
    // Deux cadences distinctes appellent cette même fonction : le tick de
    // reprise du backfill (6h, body par défaut '{}') et le tick d'ingestion
    // incrémentale (fréquent, body `{"mode":"incremental"}`) — voir les crons
    // tohu-bohu-email-backfill / tohu-bohu-email-incremental.
    const incremental = body.mode === 'incremental'
    const { data: candidates } = await supabase.from('connectors')
      .select('id, organization_id, user_id, provider, metadata, last_synced_at')
      .in('provider', ['google', 'microsoft'])
      .eq('status', 'connected')
      .order('last_synced_at', { ascending: true, nullsFirst: true })
    let pool = incremental
      ? (candidates ?? []).filter((row: any) => (row.metadata as any)?.backfill_complete === true)
      : (candidates ?? []).filter((row: any) =>
          (row.metadata as any)?.backfill_complete !== true
          || Number((row.metadata as any)?.profile_backfill_pending ?? 0) > 0)
    if (body.organizationId) pool = pool.filter((row: any) => row.organization_id === body.organizationId)
    const selected = pool.slice(0, incremental ? INCREMENTAL_MAX_CONNECTORS_PER_RUN : BACKFILL_MAX_CONNECTORS_PER_RUN)

    const results: Record<string, unknown>[] = []
    for (const row of selected) {
      const result = incremental
        ? await runIncrementalSync({
            supabase,
            organizationId: row.organization_id,
            provider: row.provider as 'google' | 'microsoft',
            actingUserId: row.user_id,
            actingUserEmail: null,
            connector: { id: row.id, metadata: row.metadata },
            jobId: null,
          })
        : await runEmailSync({
            supabase,
            organizationId: row.organization_id,
            provider: row.provider as 'google' | 'microsoft',
            actingUserId: row.user_id,
            actingUserEmail: null,
            connector: { id: row.id, metadata: row.metadata },
            jobId: null,
          })
      results.push({ connectorId: row.id, organizationId: row.organization_id, ...result })
    }
    return json({ mode: incremental ? 'cron_incremental' : 'cron_backfill', candidates: pool.length, processed: results.length, results })
  }

  const authorization = request.headers.get('Authorization')
  if (!authorization) return json({ error: 'Authentification requise' }, 401)
  const { data: { user }, error: userError } = await supabase.auth.getUser(authorization.replace('Bearer ', ''))
  if (userError || !user) return json({ error: 'Session invalide' }, 401)
  const { organizationId, provider, jobId, contactId } = body
  if (!organizationId || !['google', 'microsoft'].includes(provider)) return json({ error: 'Paramètres invalides' }, 400)
  const { data: membership } = await supabase.from('memberships').select('id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle()
  if (!membership) return json({ error: 'Accès refusé' }, 403)
  if (contactId) {
    const { data: target } = await supabase.from('contacts').select('id').eq('organization_id', organizationId).eq('id', contactId).is('merged_into_contact_id', null).maybeSingle()
    if (!target) return json({ error: 'Personne introuvable dans cet espace' }, 404)
  }
  const { data: connector } = await supabase.from('connectors').select('id,metadata').eq('organization_id', organizationId).eq('user_id', user.id).eq('provider', provider).maybeSingle()
  if (!connector) return json({ error: 'Connecteur introuvable' }, 404)

  let reusedJobId: string | null = null
  if (typeof jobId === 'string') {
    const { data: existingJob } = await supabase.from('sync_jobs').select('id').eq('id', jobId).eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle()
    reusedJobId = existingJob?.id ?? null
  }

  const result = await runEmailSync({
    supabase,
    organizationId,
    provider,
    actingUserId: user.id,
    actingUserEmail: user.email ?? null,
    connector,
    jobId: reusedJobId,
    manualContactId: typeof contactId === 'string' ? contactId : null,
  })
  return json(result, result.success ? 200 : 500)
})
