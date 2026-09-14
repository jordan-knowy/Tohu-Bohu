// Synchronise le calendrier Google Calendar de façon prospective (passé récent +
// futur), indépendamment de l'API Google Meet (sync-google-meet), qui ne voit que
// des conférences déjà démarrées — jamais un rendez-vous à venir. C'est cette
// fonction qui alimente réellement le bloc "Prochain rendez-vous" des fiches
// Personnes : sans elle, `meetings` ne contient jamais de ligne future.
//
// Double mode (même pattern que monitor-contacts/index.ts) :
//  - x-cron-secret : boucle sur tous les connecteurs Google connectés de toutes
//    les organisations (service role, aucun utilisateur authentifié) ;
//  - Authorization : synchronise uniquement le connecteur Google de l'appelant
//    (bouton "Synchroniser" de ConnectorsPage.tsx).
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

export function normalizeGoogleEvent(item: any, ownEmail: string): NormalizedCalendarEvent | null {
  if (!item?.id || !item.start?.dateTime) return null // ignore les événements "journée entière" (pas d'heure exploitable)
  const attendees = ((item.attendees ?? []) as any[]).map((attendee) => ({
    email: cleanEmail(attendee.email),
    displayName: attendee.displayName ?? null,
    organizer: Boolean(attendee.organizer),
    self: Boolean(attendee.self) || cleanEmail(attendee.email) === ownEmail,
  })).filter((attendee) => attendee.email)
  if (!attendees.some((attendee) => attendee.self)) {
    attendees.push({ email: ownEmail, displayName: null, organizer: true, self: true })
  }
  const meetLink = item.conferenceData?.entryPoints?.find((entry: any) => entry.entryPointType === 'video')?.uri ?? item.hangoutLink ?? null
  const platform: NormalizedCalendarEvent['platform'] =
    item.conferenceData?.conferenceSolution?.key?.type === 'hangoutsMeet' ? 'google_meet' : 'calendar_only'
  return {
    externalEventId: `google:${item.id}`,
    title: item.summary ?? 'Réunion',
    startsAt: item.start.dateTime,
    endsAt: item.end?.dateTime ?? null,
    status: item.status === 'cancelled' ? 'cancelled' : 'confirmed',
    meetingUrl: meetLink,
    calendarHtmlLink: item.htmlLink ?? null,
    platform,
    attendees,
    raw: item,
  }
}

async function listCalendarEvents(token: string, sinceIso: string, untilIso: string): Promise<any[]> {
  // showDeleted=true est indispensable : sans lui, un événement annulé disparaît
  // simplement du flux au lieu de renvoyer status=cancelled — on manquerait
  // silencieusement l'annulation au lieu de la propager.
  const items: any[] = []
  let pageToken: string | null = null
  do {
    const params = new URLSearchParams({
      timeMin: sinceIso, timeMax: untilIso, singleEvents: 'true', orderBy: 'startTime', showDeleted: 'true',
      maxResults: '250',
      fields: 'nextPageToken,items(id,status,summary,start,end,attendees,conferenceData,hangoutLink,htmlLink)',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) throw new Error(`Google Calendar ${response.status}`)
    const page = await response.json()
    items.push(...(page.items ?? []))
    pageToken = page.nextPageToken ?? null
  } while (pageToken && items.length < MAX_EVENTS_PER_CONNECTOR)
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
  if (tokenError || !oauth) throw new Error('Jetons OAuth absents. Reconnecte Google Workspace.')

  let accessToken = oauth.access_token as string | null
  let refreshToken = oauth.refresh_token as string | null
  const expiresSoon = !oauth.expires_at || new Date(oauth.expires_at).getTime() < Date.now() + 90_000
  if ((!accessToken || expiresSoon) && refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken)
    accessToken = refreshed.accessToken
    refreshToken = refreshed.refreshToken
    await supabase.rpc('store_oauth_tokens_server', {
      p_organization_id: organizationId, p_connector_id: connector.id, p_provider_account_id: oauth.provider_account_id,
      p_access_token: accessToken, p_refresh_token: refreshToken, p_expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
    })
  }
  if (!accessToken) throw new Error('Jeton OAuth indisponible')

  const ownEmail = cleanEmail((connector.metadata as any)?.account_email)
  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString()
  const untilIso = new Date(Date.now() + LOOKAHEAD_DAYS * 86_400_000).toISOString()
  const items = await listCalendarEvents(accessToken, sinceIso, untilIso)

  let meetings = 0
  let participants = 0
  const errors: string[] = []
  for (const item of items) {
    try {
      const event = normalizeGoogleEvent(item, ownEmail)
      if (!event) continue
      const result = await upsertCalendarMeeting({
        supabase, organizationId, ownerUserId: userId, event, source: 'google_calendar',
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
        .eq('provider', 'google').eq('status', 'connected')
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
    const { data: connector } = await supabase.from('connectors').select('id,metadata').eq('organization_id', organizationId).eq('user_id', user.id).eq('provider', 'google').maybeSingle()
    if (!connector) return json({ error: 'Connecteur Google introuvable. Connecte Google Workspace d’abord.' }, 404)

    const result = await syncOneConnector(supabase, connector, organizationId, user.id)
    await supabase.from('connectors').update({ last_synced_at: new Date().toISOString() }).eq('id', connector.id)
    return json({ success: true, meetings: result.meetings, participants: result.participants, errors: result.errors.slice(0, 5) })
  } catch (error) {
    return json({ error: errorMessage(error) || 'Synchronisation impossible' }, 500)
  }
})
