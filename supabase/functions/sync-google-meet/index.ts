// Synchronise les réunions Google Meet : liste les conferenceRecords (API Meet v2,
// distincte de Calendar), récupère leurs transcripts, et les recoupe avec les
// événements Calendar (mêmes scopes que sync-email-analysis) pour obtenir les emails
// des participants — l'API Meet n'expose que des noms d'affichage, jamais d'email.
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

const LOOKBACK_DAYS = positiveIntegerEnv('MEET_SYNC_LOOKBACK_DAYS', 14)
const MAX_CONFERENCES = positiveIntegerEnv('MEET_SYNC_MAX_CONFERENCES', 30)
// Tolérance de rapprochement conferenceRecord ↔ événement Calendar : l'API Meet ne
// référence pas directement l'événement, on recoupe par proximité temporelle du début.
const MATCH_TOLERANCE_MS = 10 * 60 * 1000

const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.fr',
  'hotmail.com', 'hotmail.fr', 'live.com', 'live.fr', 'msn.com',
  'icloud.com', 'me.com', 'yahoo.com', 'yahoo.fr', 'proton.me', 'protonmail.com',
  'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'laposte.net',
  'gmx.com', 'gmx.fr', 'aol.com', 'mac.com',
  'avocat.com', 'avocat.fr',
])

function cleanEmail(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

function corporateDomain(email: string): string | null {
  const domain = cleanEmail(email).split('@')[1] ?? ''
  return domain && !PUBLIC_EMAIL_DOMAINS.has(domain) ? domain : null
}

function companyNameFromDomain(domain: string): string {
  const base = domain.split('.')[0] ?? domain
  return base.split(/[-_]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') || domain
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

type CalendarAttendee = { email: string; displayName: string | null; organizer: boolean }
type CalendarMeeting = { title: string; startMs: number; endMs: number | null; attendees: CalendarAttendee[] }

async function meetLinkedCalendarEvents(token: string, sinceIso: string): Promise<CalendarMeeting[]> {
  const results: CalendarMeeting[] = []
  let pageToken: string | null = null
  do {
    const params = new URLSearchParams({
      timeMin: sinceIso, singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
      fields: 'nextPageToken,items(summary,start,end,attendees,conferenceData)',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) throw new Error(`Google Calendar ${response.status}`)
    const page = await response.json()
    for (const item of (page.items ?? []) as any[]) {
      const isMeet = item.conferenceData?.conferenceSolution?.key?.type === 'hangoutsMeet'
      const startMs = item.start?.dateTime ? new Date(item.start.dateTime).getTime() : null
      if (!isMeet || !startMs) continue
      results.push({
        title: item.summary ?? 'Réunion Google Meet',
        startMs,
        endMs: item.end?.dateTime ? new Date(item.end.dateTime).getTime() : null,
        attendees: ((item.attendees ?? []) as any[]).map((attendee) => ({
          email: cleanEmail(attendee.email), displayName: attendee.displayName ?? null, organizer: Boolean(attendee.organizer),
        })).filter((attendee) => attendee.email),
      })
    }
    pageToken = page.nextPageToken ?? null
  } while (pageToken)
  return results
}

async function listConferenceRecords(token: string, sinceIso: string): Promise<any[]> {
  const records: any[] = []
  let pageToken: string | null = null
  do {
    const params = new URLSearchParams({ filter: `start_time>="${sinceIso}"`, pageSize: '50' })
    if (pageToken) params.set('pageToken', pageToken)
    const response = await fetch(`https://meet.googleapis.com/v2/conferenceRecords?${params}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) {
      // Compte Google personnel ou Meet non activé pour le Workspace : pas une erreur
      // fatale, juste aucune conférence à synchroniser.
      if (response.status === 403 || response.status === 404) return []
      throw new Error(`Google Meet API ${response.status}`)
    }
    const page = await response.json()
    records.push(...(page.conferenceRecords ?? []))
    pageToken = page.nextPageToken ?? null
  } while (pageToken && records.length < MAX_CONFERENCES)
  return records.slice(0, MAX_CONFERENCES)
}

async function listAll(token: string, url: string, arrayKey: string): Promise<any[]> {
  const items: any[] = []
  let pageToken: string | null = null
  do {
    const separator = url.includes('?') ? '&' : '?'
    const pageUrl = pageToken ? `${url}${separator}pageToken=${encodeURIComponent(pageToken)}` : url
    const response = await fetch(pageUrl, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) return items
    const page = await response.json()
    items.push(...(page[arrayKey] ?? []))
    pageToken = page.nextPageToken ?? null
  } while (pageToken)
  return items
}

function participantLabel(participant: any): string {
  return participant?.signedinUser?.displayName ?? participant?.anonymousUser?.displayName ?? participant?.phoneUser?.displayName ?? 'Participant'
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
      job_type: 'google_meet_sync', status: 'running', current_step: 'Connexion au fournisseur', progress: 10, started_at: startedAt, payload: {},
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

    const ownEmail = cleanEmail((connector.metadata as any)?.account_email ?? user.email)
    const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString()

    const [calendarMeetings, conferenceRecords] = await Promise.all([
      meetLinkedCalendarEvents(accessToken, sinceIso),
      listConferenceRecords(accessToken, sinceIso),
    ])
    if (syncJobId) await supabase.from('sync_jobs').update({ current_step: 'Lecture des conférences Google Meet', progress: 35 }).eq('id', syncJobId)

    let meetingsSynced = 0
    let transcriptsSynced = 0
    let participantsMatched = 0
    const errors: string[] = []

    for (const record of conferenceRecords) {
      try {
        const recordStart = record.startTime ? new Date(record.startTime).getTime() : null
        if (!recordStart) continue
        // Rapprochement avec l'événement Calendar le plus proche dans le temps : l'API
        // Meet ne référence pas l'ID d'événement, seulement l'espace de réunion.
        const matchedEvent = calendarMeetings
          .filter((meeting) => Math.abs(meeting.startMs - recordStart) <= MATCH_TOLERANCE_MS)
          .sort((a, b) => Math.abs(a.startMs - recordStart) - Math.abs(b.startMs - recordStart))[0] ?? null

        const externalAttendees = (matchedEvent?.attendees ?? []).filter((attendee) => attendee.email !== ownEmail)
        let companyId: string | null = null
        const primaryAttendee = externalAttendees[0] ?? null
        if (primaryAttendee) {
          const domain = corporateDomain(primaryAttendee.email)
          if (domain) {
            const { data: company } = await supabase.rpc('resolve_company_identity', {
              p_organization_id: organizationId, p_name: companyNameFromDomain(domain), p_domain: domain, p_industry: null, p_create_if_missing: true,
            }).maybeSingle()
            companyId = company?.company_id ?? null
          }
        }

        const { data: meetingRow, error: meetingError } = await supabase.from('meetings').upsert({
          organization_id: organizationId,
          owner_user_id: user.id,
          company_id: companyId,
          external_event_id: record.name,
          title: matchedEvent?.title ?? 'Réunion Google Meet',
          starts_at: record.startTime, ends_at: record.endTime ?? null,
          platform: 'google_meet',
          raw_payload: record,
        }, { onConflict: 'organization_id,external_event_id' }).select('id').single()
        if (meetingError || !meetingRow) throw meetingError ?? new Error('Réunion non enregistrée')
        meetingsSynced++

        for (const attendee of externalAttendees) {
          let contactId: string | null = null
          const { data: resolved } = await supabase.rpc('resolve_contact_identity', {
            p_organization_id: organizationId, p_email: attendee.email, p_full_name: attendee.displayName ?? attendee.email,
            p_company_id: companyId, p_owner_user_id: user.id, p_role_title: null, p_source: 'google_meet',
          }).maybeSingle()
          contactId = resolved?.contact_id ?? null
          const { error: participantError } = await supabase.from('meeting_participants').upsert({
            organization_id: organizationId, meeting_id: meetingRow.id, contact_id: contactId,
            email: attendee.email, display_name: attendee.displayName, name: attendee.displayName,
            role_in_meeting: attendee.organizer ? 'organizer' : 'attendee', is_current_user: false,
          }, { onConflict: 'meeting_id,email' })
          if (!participantError) participantsMatched++
        }

        const transcripts = await listAll(accessToken, `https://meet.googleapis.com/v2/${record.name}/transcripts`, 'transcripts')
        if (!transcripts.length) continue
        const participants = await listAll(accessToken, `https://meet.googleapis.com/v2/${record.name}/participants`, 'participants')
        const speakerByName = new Map(participants.map((participant) => [participant.name as string, participantLabel(participant)]))

        const allEntries: any[] = []
        for (const transcript of transcripts) {
          const entries = await listAll(accessToken, `https://meet.googleapis.com/v2/${transcript.name}/entries`, 'transcriptEntries')
          allEntries.push(...entries)
        }
        if (!allEntries.length) continue
        allEntries.sort((a, b) => new Date(a.startTime ?? 0).getTime() - new Date(b.startTime ?? 0).getTime())
        const transcriptText = allEntries.map((entry) => {
          const speaker = speakerByName.get(entry.participant) ?? 'Participant'
          const time = entry.startTime ? new Date(entry.startTime).toISOString().slice(11, 16) : ''
          return `${speaker}${time ? ` (${time})` : ''} : ${entry.text ?? ''}`
        }).join('\n')
        const speakerMap = Object.fromEntries([...speakerByName.entries()])

        const { error: transcriptError } = await supabase.from('meeting_transcripts').upsert({
          organization_id: organizationId, meeting_id: meetingRow.id, provider: 'google_meet',
          transcript_text: transcriptText, speaker_map: speakerMap,
          // Meet affiche un bandeau à tous les participants dès que la transcription
          // démarre : le consentement est déjà géré au niveau de la plateforme.
          consent_status: 'granted',
        }, { onConflict: 'meeting_id,provider' })
        if (transcriptError) throw transcriptError
        transcriptsSynced++
      } catch (recordError) {
        errors.push(recordError instanceof Error ? recordError.message : String(recordError))
      }
    }

    if (syncJobId) await supabase.from('sync_jobs').update({ current_step: 'Synchronisation terminée', progress: 100, status: 'succeeded', completed_at: new Date().toISOString(), payload: { meetings: meetingsSynced, transcripts: transcriptsSynced, errors: errors.slice(0, 5) } }).eq('id', syncJobId)
    return json({ success: true, meetings: meetingsSynced, transcripts: transcriptsSynced, participantsMatched, errors: errors.slice(0, 5) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Synchronisation impossible'
    if (syncJobId) {
      const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
      await supabase.from('sync_jobs').update({ status: 'failed', current_step: 'Échec de la synchronisation', error_code: 'GOOGLE_MEET_SYNC_FAILED', error_message: message, completed_at: new Date().toISOString() }).eq('id', syncJobId)
    }
    return json({ error: message }, 500)
  }
})
