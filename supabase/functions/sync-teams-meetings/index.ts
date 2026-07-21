// Synchronise les réunions Microsoft Teams pour une organisation cliente déjà
// connectée via connect-teams (consentement admin, tenant_id stocké dans
// connectors.metadata). Contrairement à Google Meet, l'accès aux transcripts est
// une permission Application (client_credentials, jeton "app-only" Tohu-Bohu),
// pas un jeton par utilisateur — mais on réutilise le calendrier Outlook déjà
// connecté (token délégué existant) pour savoir QUELLES réunions chercher, car
// l'API Graph ne permet pas de lister les réunions d'un utilisateur en app-only.
//
// ⚠️ Non testé en conditions réelles : aucun tenant M365 avec licence Teams n'est
// disponible à ce stade (voir le plan). Le format VTT des transcripts et la syntaxe
// exacte de certains filtres OData sont reconstitués depuis la documentation Graph,
// à confirmer dès qu'un premier client se connecte.
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

const LOOKBACK_DAYS = positiveIntegerEnv('TEAMS_SYNC_LOOKBACK_DAYS', 14)
const MAX_MEETINGS_PER_USER = positiveIntegerEnv('TEAMS_SYNC_MAX_MEETINGS_PER_USER', 20)

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

/** Voir app_secrets, section "pourquoi pas des variables d'environnement" dans connect-teams. */
async function appSecret(supabase: ReturnType<typeof createClient>, name: string): Promise<string | null> {
  const { data } = await supabase.from('app_secrets').select('value').eq('name', name).maybeSingle()
  return (data as { value?: string } | null)?.value ?? null
}

// ⚠️ Ce token délégué a été émis pour l'app de login existante (« Tohu Bohu »,
// MICROSOFT_CLIENT_ID/SECRET déjà utilisés par sync-email-analysis) — surtout pas
// les credentials de la nouvelle app Teams (TEAMS_SYNC_*), qui n'ont aucun lien
// avec ce token et feraient échouer le rafraîchissement.
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

/** Jeton "app-only" (client_credentials) scopé au tenant du client — c'est celui-ci,
 *  pas un jeton utilisateur, qui autorise la lecture des transcripts (permission
 *  Application consentie par l'admin du client via connect-teams). */
async function appOnlyToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials', scope: 'https://graph.microsoft.com/.default',
    }),
  })
  if (!response.ok) throw new Error(`Jeton app-only Microsoft refusé (${response.status}) — vérifier le consentement admin du tenant client`)
  const data = await response.json()
  return data.access_token
}

type TeamsCalendarEvent = { subject: string; startMs: number; endMs: number | null; joinUrl: string; attendees: Array<{ email: string; displayName: string | null }> }

async function teamsLinkedCalendarEvents(delegatedToken: string, sinceIso: string): Promise<TeamsCalendarEvent[]> {
  const select = 'subject,start,end,isOnlineMeeting,onlineMeetingProvider,onlineMeeting,attendees'
  const filter = `isOnlineMeeting eq true and onlineMeetingProvider eq 'teamsForBusiness' and start/dateTime ge '${sinceIso}'`
  let nextUrl: string | null = `https://graph.microsoft.com/v1.0/me/events?$select=${select}&$filter=${encodeURIComponent(filter)}&$top=50`
  const results: TeamsCalendarEvent[] = []
  while (nextUrl) {
    const response = await fetch(nextUrl, { headers: { Authorization: `Bearer ${delegatedToken}` } })
    if (!response.ok) throw new Error(`Microsoft Graph (calendrier) ${response.status}`)
    const page = await response.json()
    for (const item of (page.value ?? []) as any[]) {
      const joinUrl = item.onlineMeeting?.joinUrl
      const startMs = item.start?.dateTime ? new Date(`${item.start.dateTime}Z`).getTime() : null
      if (!joinUrl || !startMs) continue
      results.push({
        subject: item.subject ?? 'Réunion Teams',
        startMs, endMs: item.end?.dateTime ? new Date(`${item.end.dateTime}Z`).getTime() : null,
        joinUrl,
        attendees: ((item.attendees ?? []) as any[]).map((attendee) => ({
          email: cleanEmail(attendee.emailAddress?.address), displayName: attendee.emailAddress?.name ?? null,
        })).filter((attendee) => attendee.email),
      })
    }
    nextUrl = page['@odata.nextLink'] ?? null
  }
  return results.slice(0, MAX_MEETINGS_PER_USER)
}

/** Résout l'ID de réunion Teams à partir de son lien de participation — l'API Graph
 *  ne relie pas directement un événement Calendar à une ressource onlineMeeting. */
async function resolveOnlineMeetingId(appToken: string, userEmail: string, joinUrl: string): Promise<string | null> {
  const filter = `JoinWebUrl eq '${joinUrl.replace(/'/g, "''")}'`
  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userEmail)}/onlineMeetings?$filter=${encodeURIComponent(filter)}`, {
    headers: { Authorization: `Bearer ${appToken}` },
  })
  if (!response.ok) return null
  const data = await response.json()
  return data.value?.[0]?.id ?? null
}

async function listTranscripts(appToken: string, userEmail: string, meetingId: string): Promise<Array<{ id: string }>> {
  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userEmail)}/onlineMeetings/${meetingId}/transcripts`, {
    headers: { Authorization: `Bearer ${appToken}` },
  })
  if (!response.ok) return []
  const data = await response.json()
  return data.value ?? []
}

async function fetchTranscriptVtt(appToken: string, userEmail: string, meetingId: string, transcriptId: string): Promise<string | null> {
  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userEmail)}/onlineMeetings/${meetingId}/transcripts/${transcriptId}/content?$format=text/vtt`, {
    headers: { Authorization: `Bearer ${appToken}` },
  })
  if (!response.ok) return null
  return await response.text()
}

/** Parseur WebVTT minimal : Teams encode le locuteur en tag <v Nom>texte</v> à
 *  l'intérieur de chaque cue. Format à valider contre un vrai transcript Teams. */
function parseVtt(vtt: string): Array<{ speaker: string; text: string; startMs: number }> {
  const timeToMs = (value: string): number => {
    const match = value.match(/(\d+):(\d{2}):(\d{2})\.(\d{3})/)
    if (!match) return 0
    const [, h, m, s, ms] = match
    return (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000 + Number(ms)
  }
  const blocks = vtt.replace(/\r\n/g, '\n').split(/\n\n+/)
  const entries: Array<{ speaker: string; text: string; startMs: number }> = []
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean)
    const timingLine = lines.find((line) => line.includes('-->'))
    if (!timingLine) continue
    const startMs = timeToMs(timingLine.split('-->')[0]?.trim() ?? '')
    const textLines = lines.slice(lines.indexOf(timingLine) + 1).join(' ')
    const speakerMatch = textLines.match(/<v\s+([^>]+)>/)
    const speaker = speakerMatch?.[1]?.trim() ?? 'Participant'
    const text = textLines.replace(/<v\s+[^>]+>/g, '').replace(/<\/v>/g, '').trim()
    if (text) entries.push({ speaker, text, startMs })
  }
  return entries
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

    const { data: teamsConnector } = await supabase.from('connectors').select('id,metadata').eq('organization_id', organizationId).eq('provider', 'teams').eq('status', 'connected').maybeSingle()
    const tenantId = (teamsConnector?.metadata as any)?.tenant_id as string | undefined
    if (!teamsConnector || !tenantId) return json({ error: 'Teams non connecté pour cette organisation. Un admin Microsoft 365 doit d’abord cliquer « Connecter Teams ».' }, 404)

    const clientId = await appSecret(supabase, 'teams_sync_client_id')
    const clientSecret = await appSecret(supabase, 'teams_sync_client_secret')
    if (!clientId || !clientSecret) return json({ error: 'Secrets Teams non configurés (teams_sync_client_id / teams_sync_client_secret dans app_secrets)' }, 500)

    const { data: job } = await supabase.from('sync_jobs').insert({
      organization_id: organizationId, connector_id: teamsConnector.id, user_id: user.id, provider: 'teams',
      job_type: 'teams_meeting_sync', status: 'running', current_step: 'Obtention du jeton applicatif', progress: 10, started_at: startedAt, payload: {},
    }).select('id').single()
    syncJobId = job?.id ?? null

    const appToken = await appOnlyToken(tenantId, clientId, clientSecret)

    // Les réunions à chercher sont celles des utilisateurs déjà connectés à Outlook
    // dans cette org (mêmes personnes qui ont déjà autorisé Calendars.Read en délégué) —
    // c'est la seule façon de savoir QUELLES réunions un jeton app-only doit chercher.
    const { data: microsoftConnectors } = await supabase.from('connectors').select('id,metadata').eq('organization_id', organizationId).eq('provider', 'microsoft').eq('status', 'connected')
    if (syncJobId) await supabase.from('sync_jobs').update({ current_step: 'Lecture des calendriers Outlook connectés', progress: 30 }).eq('id', syncJobId)

    const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString()
    let meetingsSynced = 0
    let transcriptsSynced = 0
    let participantsMatched = 0
    const errors: string[] = []

    for (const msConnector of microsoftConnectors ?? []) {
      try {
        const userEmail = (msConnector.metadata as any)?.account_email as string | undefined
        if (!userEmail) continue
        const { data: tokenRows } = await supabase.rpc('get_oauth_tokens_server', { p_connector_id: msConnector.id })
        const oauth = tokenRows?.[0]
        if (!oauth?.refresh_token) continue
        // Le token délégué sert uniquement à découvrir les réunions via le calendrier
        // de l'utilisateur — il ne donne jamais accès aux transcripts (ça, c'est le rôle
        // du jeton app-only ci-dessus, consenti par l'admin du tenant client).
        let delegatedToken = oauth.access_token as string | null
        const expiresSoon = !oauth.expires_at || new Date(oauth.expires_at).getTime() < Date.now() + 90_000
        if (!delegatedToken || expiresSoon) {
          const refreshed = await refreshDelegatedToken(oauth.refresh_token)
          delegatedToken = refreshed.accessToken
          await supabase.rpc('store_oauth_tokens_server', { p_organization_id: organizationId, p_connector_id: msConnector.id, p_provider_account_id: oauth.provider_account_id, p_access_token: refreshed.accessToken, p_refresh_token: refreshed.refreshToken, p_expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString() })
        }
        const events = await teamsLinkedCalendarEvents(delegatedToken, sinceIso)

        for (const event of events) {
          try {
            const externalAttendees = event.attendees.filter((attendee) => attendee.email !== userEmail)
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

            const externalEventId = `teams:${event.joinUrl}`
            const { data: meetingRow, error: meetingError } = await supabase.from('meetings').upsert({
              organization_id: organizationId, owner_user_id: user.id, company_id: companyId,
              external_event_id: externalEventId, title: event.subject,
              starts_at: new Date(event.startMs).toISOString(), ends_at: event.endMs ? new Date(event.endMs).toISOString() : null,
              platform: 'teams', raw_payload: { joinUrl: event.joinUrl },
            }, { onConflict: 'organization_id,external_event_id' }).select('id').single()
            if (meetingError || !meetingRow) throw meetingError ?? new Error('Réunion non enregistrée')
            meetingsSynced++

            for (const attendee of externalAttendees) {
              const { data: resolved } = await supabase.rpc('resolve_contact_identity', {
                p_organization_id: organizationId, p_email: attendee.email, p_full_name: attendee.displayName ?? attendee.email,
                p_company_id: companyId, p_owner_user_id: user.id, p_role_title: null, p_source: 'teams',
              }).maybeSingle()
              const { error: participantError } = await supabase.from('meeting_participants').upsert({
                organization_id: organizationId, meeting_id: meetingRow.id, contact_id: resolved?.contact_id ?? null,
                email: attendee.email, display_name: attendee.displayName, name: attendee.displayName,
                role_in_meeting: 'attendee', is_current_user: false,
              }, { onConflict: 'meeting_id,email' })
              if (!participantError) participantsMatched++
            }

            const onlineMeetingId = await resolveOnlineMeetingId(appToken, userEmail, event.joinUrl)
            if (!onlineMeetingId) continue
            const transcripts = await listTranscripts(appToken, userEmail, onlineMeetingId)
            if (!transcripts.length) continue

            const allEntries: Array<{ speaker: string; text: string; startMs: number }> = []
            for (const transcript of transcripts) {
              const vtt = await fetchTranscriptVtt(appToken, userEmail, onlineMeetingId, transcript.id)
              if (vtt) allEntries.push(...parseVtt(vtt))
            }
            if (!allEntries.length) continue
            allEntries.sort((a, b) => a.startMs - b.startMs)
            const speakerMap: Record<string, string> = {}
            for (const entry of allEntries) speakerMap[entry.speaker] = entry.speaker
            const transcriptText = allEntries.map((entry) => {
              const totalSeconds = Math.floor(entry.startMs / 1000)
              const time = `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`
              return `${entry.speaker} (${time}) : ${entry.text}`
            }).join('\n')

            const { error: transcriptError } = await supabase.from('meeting_transcripts').upsert({
              organization_id: organizationId, meeting_id: meetingRow.id, provider: 'teams',
              transcript_text: transcriptText, speaker_map: speakerMap,
              // Comme Meet, Teams affiche un bandeau de consentement à tous les
              // participants dès que la transcription démarre.
              consent_status: 'granted',
            }, { onConflict: 'meeting_id,provider' })
            if (transcriptError) throw transcriptError
            transcriptsSynced++
          } catch (eventError) {
            errors.push(eventError instanceof Error ? eventError.message : String(eventError))
          }
        }
      } catch (userError) {
        errors.push(userError instanceof Error ? userError.message : String(userError))
      }
    }

    if (syncJobId) await supabase.from('sync_jobs').update({ current_step: 'Synchronisation terminée', progress: 100, status: 'succeeded', completed_at: new Date().toISOString(), payload: { meetings: meetingsSynced, transcripts: transcriptsSynced, errors: errors.slice(0, 5) } }).eq('id', syncJobId)
    return json({ success: true, meetings: meetingsSynced, transcripts: transcriptsSynced, participantsMatched, errors: errors.slice(0, 5) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Synchronisation impossible'
    if (syncJobId) {
      const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
      await supabase.from('sync_jobs').update({ status: 'failed', current_step: 'Échec de la synchronisation', error_code: 'TEAMS_SYNC_FAILED', error_message: message, completed_at: new Date().toISOString() }).eq('id', syncJobId)
    }
    return json({ error: message }, 500)
  }
})
