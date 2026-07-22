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
async function gmailMessages(token: string, ownEmail: string, beforeDate?: string | null): Promise<MailScan> {
  const ids: Array<{ id: string; threadId: string }> = []
  let pageToken: string | null = null
  let hasMore = false
  do {
    const query = `newer_than:${DISCOVERY_LOOKBACK_DAYS}d -category:promotions${beforeDate ? ` before:${beforeDate}` : ''}`
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

/** Priorité garantie à toute relation déjà suivie (personne OU entreprise) —
 *  dépasse largement tout score organique pour ne jamais être évincée par le
 *  volume d'un tiers non suivi, même très actif. */
const TRACKED_RELEVANCE_BOOST = 100_000

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
  budget: number,
): { selectedIds: Set<string>; contactsPrioritized: number } {
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
    const tracked = contact?.is_tracked === true || (domain !== null && trackedDomains.has(domain))
    const total = stat.inbound + stat.outbound
    const reciprocityBonus = stat.inbound > 0 && stat.outbound > 0 ? total * 0.5 : 0
    const recencyDays = (now - new Date(stat.lastSentAt).getTime()) / 86_400_000
    const recencyBonus = Math.max(0, 60 - recencyDays)
    const score = (tracked ? TRACKED_RELEVANCE_BOOST : 0) + total + reciprocityBonus + recencyBonus
    return { email, score, stat }
  }).sort((a, b) => b.score - a.score)

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
  return { selectedIds, contactsPrioritized }
}

type SyncParams = {
  supabase: ReturnType<typeof createClient>
  organizationId: string
  provider: 'google' | 'microsoft'
  actingUserId: string
  actingUserEmail: string | null
  connector: { id: string; metadata: any }
  jobId: string | null
}

/** Cœur de la synchronisation, extrait pour être appelable soit une fois
 *  (déclenchement interactif, JWT utilisateur) soit en boucle sur plusieurs
 *  connecteurs (tick cron de reprise du backfill, multi-tenant). Ne lève
 *  jamais — retourne { success:false, error } pour que l'appelant en boucle
 *  puisse continuer sur les connecteurs suivants sans s'interrompre. */
async function runEmailSync(params: SyncParams): Promise<Record<string, unknown>> {
  const { supabase, organizationId, provider, actingUserId, actingUserEmail, connector } = params
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

    const ownEmail = cleanEmail((connector.metadata as any)?.account_email ?? actingUserEmail)
    // Reprise de backfill : si une passe précédente s'est arrêtée avant la fin
    // de la fenêtre de 2 ans (discovery_truncated), on continue plus loin dans
    // le passé plutôt que de tout rescanner depuis le début.
    const backfillBefore: string | null = (connector.metadata as any)?.backfill_before ?? null
    const scan = provider === 'google'
      ? await gmailMessages(accessToken, ownEmail, backfillBefore)
      : await microsoftMessages(accessToken, ownEmail, backfillBefore)
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

    // Qui a droit au traitement complet (corps + stockage) se décide par
    // pertinence de la relation sur toute la fenêtre découverte, pas par
    // simple position chronologique — une boîte très bruitée noierait sinon
    // les vraies relations derrière du volume automatisé récent.
    const { data: trackedCompanyRows } = await supabase.from('companies').select('domain').eq('organization_id', organizationId).eq('is_tracked', true)
    const trackedDomains = new Set((trackedCompanyRows ?? []).map((row: any) => String(row.domain ?? '').toLowerCase().trim()).filter(Boolean))
    const relevance = selectMessagesByRelevance(messages, ownEmail, contactByEmail, trackedDomains, ANALYSIS_MAX_MESSAGES)
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
            p_owner_user_id: actingUserId,
            p_role_title: null,
            p_source: `email_${provider}`,
          }).maybeSingle()
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
        const result = await analyze((await supabase.from('profiles').select('full_name').eq('id', actingUserId).single()).data?.full_name ?? actingUserEmail ?? 'Responsable', 'responsable', responsibleCorpus)
        await supabase.from('user_behavioral_profiles').upsert({ organization_id: organizationId, user_id: actingUserId, global_confidence: pct(result.global_confidence), executive_summary: result.executive_summary ?? null, cognitive_mode: result.cognitive_mode ?? null, cognitive_mode_confidence: pct(result.cognitive_mode_confidence), behavioral_analysis_data: result.behavioral_analysis_data ?? [], communication_style_data: result.communication_style_data ?? {}, source_message_count: responsibleCorpus.length, updated_from: [provider, 'email'], updated_at: new Date().toISOString() }, { onConflict: 'organization_id,user_id' })
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

    // Curseur de reprise : tant que la fenêtre découverte n'est pas
    // entièrement couverte (discovery_truncated), on avance le point de
    // reprise plus loin dans le passé pour la prochaine passe (manuelle ou
    // via le cron de continuation) plutôt que de repartir de zéro.
    const backfillComplete = !scan.truncated
    const nextBackfillBefore = backfillComplete
      ? null
      : provider === 'google'
        ? (scan.oldestSentAt ? toGmailDateOnly(scan.oldestSentAt) : backfillBefore)
        : (scan.oldestSentAt ?? backfillBefore)

    // Le backfill vient de se terminer : on capture le curseur incrémental
    // (Partie C) juste après cette passe, pour qu'il n'y ait aucun trou entre
    // ce que le backfill a couvert et le point de départ de l'ingestion continue.
    const incrementalCursorPatch: Record<string, unknown> = {}
    if (backfillComplete) {
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
      backfill_complete: backfillComplete,
    }
    await supabase.from('connectors').update({
      status: 'connected',
      last_synced_at: new Date().toISOString(),
      metadata: { ...(connector.metadata ?? {}), last_sync: syncSummary, backfill_complete: backfillComplete, backfill_before: nextBackfillBefore, ...incrementalCursorPatch },
      updated_at: new Date().toISOString(),
    }).eq('id', connector.id)
    if (syncJobId) await supabase.from('sync_jobs').update({ status: 'succeeded', current_step: 'Synchronisation terminée', progress: 100, completed_at: new Date().toISOString(), payload: { provider, ...syncSummary, analysis_errors: analysisErrors.slice(0, 5) } }).eq('id', syncJobId)
    return { success: true, messages: storedMessages, responsibleAnalyzed, peopleAnalyzed, automatedMessagesIgnored: skippedAutomated, analysisErrors: analysisErrors.slice(0, 5), backfillComplete }
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

    const { data: existingContacts } = await supabase.from('contacts').select('id,email,secondary_emails,full_name,owner_user_id,source_summary,is_tracked').eq('organization_id', organizationId).is('merged_into_contact_id', null)
    const contactByEmail = new Map<string, any>()
    for (const item of existingContacts ?? []) {
      for (const email of [item.email, ...(item.secondary_emails ?? [])]) {
        const normalized = cleanEmail(email)
        if (normalized) contactByEmail.set(normalized, item)
      }
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
      : (candidates ?? []).filter((row: any) => (row.metadata as any)?.backfill_complete !== true)
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
  const { organizationId, provider, jobId } = body
  if (!organizationId || !['google', 'microsoft'].includes(provider)) return json({ error: 'Paramètres invalides' }, 400)
  const { data: membership } = await supabase.from('memberships').select('id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle()
  if (!membership) return json({ error: 'Accès refusé' }, 403)
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
  })
  return json(result, result.success ? 200 : 500)
})
