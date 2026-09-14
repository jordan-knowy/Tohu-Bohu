// Synchronise le calendrier Outlook/Microsoft 365 de façon prospective (passé
// récent + futur), à partir du connecteur "microsoft" standard (token délégué
// Calendars.Read déjà accordé à la connexion) — PAS le connecteur "teams" à
// consentement admin (celui-ci reste géré par sync-teams-meetings, pour les
// transcripts, et est inactif pour la quasi-totalité des comptes).
//
// Utilise /me/calendarView plutôt que /me/events : c'est la seule route Graph
// qui explose une série récurrente en occurrences concrètes avec leurs propres
// dates, plutôt que de renvoyer le seul événement maître de la série.
//
// Double mode identique à sync-google-calendar/index.ts (x-cron-secret → boucle
// multi-org service role ; Authorization → un seul connecteur de l'appelant).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { cleanEmail, errorMessage, upsertCalendarMeeting, type NormalizedCalendarEvent } from '../_shared/calendar-sync.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number(Deno.env.get(name))
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

const LOOKBACK_DAYS = positiveIntegerEnv('CALENDAR_SYNC_LOOKBACK_DAYS', 14)
const LOOKAHEAD_DAYS = positiveIntegerEnv('CALENDAR_SYNC_LOOKAHEAD_DAYS', 60)
const SMALL_MEETING_MAX_ATTENDEES = positiveIntegerEnv('CALENDAR_SYNC_SMALL_MEETING_MAX_ATTENDEES', 5)
const MAX_EVENTS_PER_CONNECTOR = positiveIntegerEnv('CALENDAR_SYNC_MAX_EVENTS_PER_CONNECTOR', 250)
const MAX_CONNECTORS_PER_CRON_RUN = positiveIntegerEnv('CALENDAR_SYNC_MAX_CONNECTORS_PER_RUN', 30)

async function appSecret(supabase: any, name: string): Promise<string | null> {
  const { data } = await supabase.from('app_secrets').select('value').eq('name', name).maybeSingle()
  return (data as { value?: string } | null)?.value ?? null
}

/** Même app de login existante que sync-teams-meetings/sync-email-analysis
 *  (MICROSOFT_CLIENT_ID/SECRET) — surtout pas les credentials de l'app Teams. */
async function refreshDelegatedToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const clientId = Deno.env.get('MICROSOFT_CLIENT_ID')
  const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET')
  if (!clientId || !clientSecret) throw new Error('Secrets OAuth microsoft (login) manquants')
  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token',
      scope: 'openid profile email offline_access User.Read Mail.Read Calendars.Read',
    }),
  })
  if (!response.ok) throw new Error(`Rafraîchissement microsoft refusé (${response.status})`)
  const data = await response.json()
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? refreshToken, expiresIn: Number(data.expires_in ?? 3600) }
}

export function normalizeMicrosoftEvent(item: any, ownEmail: string): NormalizedCalendarEvent | null {
  if (!item?.id || item.isAllDay) return null
  const organizerEmail = cleanEmail(item.organizer?.emailAddress?.address)
  const attendees = ((item.attendees ?? []) as any[]).map((attendee) => {
    const email = cleanEmail(attendee.emailAddress?.address)
    return {
      email,
      displayName: attendee.emailAddress?.name ?? null,
      organizer: email === organizerEmail,
      self: email === ownEmail,
    }
  }).filter((attendee) => attendee.email)
  if (!attendees.some((attendee) => attendee.self)) {
    attendees.push({ email: ownEmail, displayName: null, organizer: organizerEmail === ownEmail, self: true })
  }
  const isTeams = item.isOnlineMeeting && item.onlineMeetingProvider === 'teamsForBusiness'
  return {
    externalEventId: `microsoft:${item.id}`,
    title: item.subject ?? 'Réunion',
    startsAt: item.start?.dateTime ? `${item.start.dateTime}Z` : '',
    endsAt: item.end?.dateTime ? `${item.end.dateTime}Z` : null,
    status: item.isCancelled ? 'cancelled' : 'confirmed',
    meetingUrl: isTeams ? (item.onlineMeeting?.joinUrl ?? null) : null,
    calendarHtmlLink: item.webLink ?? null,
    platform: isTeams ? 'teams' : 'calendar_only',
    attendees,
    raw: item,
  }
}

async function listCalendarView(token: string, sinceIso: string, untilIso: string): Promise<any[]> {
  const select = 'id,subject,start,end,isCancelled,isAllDay,attendees,organizer,onlineMeeting,onlineMeetingProvider,isOnlineMeeting,webLink'
  let url: string | null =
    `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${encodeURIComponent(sinceIso)}&endDateTime=${encodeURIComponent(untilIso)}&$select=${select}&$top=100&$orderby=start/dateTime`
  const items: any[] = []
  while (url && items.length < MAX_EVENTS_PER_CONNECTOR) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' } })
    if (!response.ok) throw new Error(`Microsoft Graph (calendrier) ${response.status}`)
    const page = await response.json()
    items.push(...(page.value ?? []))
    url = page['@odata.nextLink'] ?? null
  }
  return items.slice(0, MAX_EVENTS_PER_CONNECTOR)
}

async function syncOneConnector(
  supabase: any,
  connector: { id: string; metadata: unknown },
  organizationId: string,
  userId: string,
): Promise<{ meetings: number; participants: number; errors: string[] }> {
  const { data: tokenRows, error: tokenError } = await supabase.rpc('get_oauth_tokens_server', { p_connector_id: connector.id })
  const oauth = tokenRows?.[0]
  if (tokenError || !oauth?.refresh_token) throw new Error('Jetons OAuth absents. Reconnecte Microsoft 365.')

  let accessToken = oauth.access_token as string | null
  const expiresSoon = !oauth.expires_at || new Date(oauth.expires_at).getTime() < Date.now() + 90_000
  if (!accessToken || expiresSoon) {
    const refreshed = await refreshDelegatedToken(oauth.refresh_token)
    accessToken = refreshed.accessToken
    await supabase.rpc('store_oauth_tokens_server', {
      p_organization_id: organizationId, p_connector_id: connector.id, p_provider_account_id: oauth.provider_account_id,
      p_access_token: refreshed.accessToken, p_refresh_token: refreshed.refreshToken, p_expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
    })
  }
  if (!accessToken) throw new Error('Jeton OAuth indisponible')

  const ownEmail = cleanEmail((connector.metadata as any)?.account_email)
  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString()
  const untilIso = new Date(Date.now() + LOOKAHEAD_DAYS * 86_400_000).toISOString()
  const items = await listCalendarView(accessToken, sinceIso, untilIso)

  let meetings = 0
  let participants = 0
  const errors: string[] = []
  for (const item of items) {
    try {
      const event = normalizeMicrosoftEvent(item, ownEmail)
      if (!event || !event.startsAt) continue
      const result = await upsertCalendarMeeting({
        supabase, organizationId, ownerUserId: userId, event, source: 'microsoft_calendar',
        smallMeetingMaxAttendees: SMALL_MEETING_MAX_ATTENDEES,
      })
      meetings++
      participants += result.participantsUpserted
    } catch (eventError) {
      errors.push(errorMessage(eventError))
    }
  }
  return { meetings, participants, errors }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const cronSecret = request.headers.get('x-cron-secret')

  try {
    if (cronSecret) {
      const expected = await appSecret(supabase, 'monitor_cron')
      if (!expected || cronSecret !== expected) return json({ error: 'Cron secret invalide' }, 401)

      const { data: connectors } = await supabase.from('connectors')
        .select('id, organization_id, user_id, metadata')
        .eq('provider', 'microsoft').eq('status', 'connected')
        .order('last_synced_at', { ascending: true, nullsFirst: true })
        .limit(MAX_CONNECTORS_PER_CRON_RUN)

      let meetings = 0, participants = 0, connectorsProcessed = 0
      const errors: string[] = []
      for (const connector of connectors ?? []) {
        try {
          const result = await syncOneConnector(supabase, connector, connector.organization_id, connector.user_id)
          meetings += result.meetings
          participants += result.participants
          connectorsProcessed++
          errors.push(...result.errors.slice(0, 3).map((message) => `${connector.id}: ${message}`))
          await supabase.from('connectors').update({ last_synced_at: new Date().toISOString() }).eq('id', connector.id)
        } catch (connectorError) {
          errors.push(`${connector.id}: ${errorMessage(connectorError)}`)
        }
      }
      return json({ ok: true, mode: 'cron', connectorsProcessed, meetings, participants, errors: errors.slice(0, 10) })
    }

    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Authentification requise' }, 401)
    const { data: { user }, error: userError } = await supabase.auth.getUser(authorization.replace('Bearer ', ''))
    if (userError || !user) return json({ error: 'Session invalide' }, 401)
    const { organizationId } = await request.json().catch(() => ({}))
    if (!organizationId) return json({ error: 'Paramètres invalides' }, 400)
    const { data: membership } = await supabase.from('memberships').select('id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle()
    if (!membership) return json({ error: 'Accès refusé' }, 403)
    const { data: connector } = await supabase.from('connectors').select('id,metadata').eq('organization_id', organizationId).eq('user_id', user.id).eq('provider', 'microsoft').maybeSingle()
    if (!connector) return json({ error: 'Connecteur Microsoft introuvable. Connecte Microsoft 365 d’abord.' }, 404)

    const result = await syncOneConnector(supabase, connector, organizationId, user.id)
    await supabase.from('connectors').update({ last_synced_at: new Date().toISOString() }).eq('id', connector.id)
    return json({ success: true, meetings: result.meetings, participants: result.participants, errors: result.errors.slice(0, 5) })
  } catch (error) {
    return json({ error: errorMessage(error) || 'Synchronisation impossible' }, 500)
  }
})
