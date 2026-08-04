// Récepteur webhook Read AI (public, verify_jwt=false). Read AI POSTe un rapport
// après chaque réunion (Zoom / Teams / Meet) : résumé + transcript + participants
// avec emails. On identifie l'organisation via le secret `?token=`, on résout les
// participants en contacts PAR EMAIL, puis on stocke dans le même pipeline que
// Google Meet (meetings + meeting_participants + meeting_transcripts).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.fr', 'live.com', 'live.fr',
  'yahoo.com', 'yahoo.fr', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
  'orange.fr', 'free.fr', 'wanadoo.fr', 'sfr.fr', 'laposte.net', 'gmx.com', 'msn.com',
])

function emailDomain(email: string | null | undefined): string | null {
  const at = String(email ?? '').trim().toLowerCase().split('@')[1]
  return at && at.includes('.') ? at : null
}
function corporateDomain(email: string | null | undefined): string | null {
  const domain = emailDomain(email)
  return domain && !FREE_EMAIL_DOMAINS.has(domain) ? domain : null
}
function companyNameFromDomain(domain: string): string {
  const core = domain.split('.').slice(0, -1).join(' ') || domain
  return core.charAt(0).toUpperCase() + core.slice(1)
}
function asText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return asText(obj.text ?? obj.summary ?? obj.value ?? null)
  }
  return null
}
// Read AI envoie les dates en Unix millisecondes (parfois secondes ou ISO) : on normalise.
function toIso(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'number') {
    const date = new Date(value < 1e12 ? value * 1000 : value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const raw = String(value).trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) return toIso(Number(raw))
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

type Participant = { email: string | null; name: string | null }

// Read AI a fait évoluer son format ; on lit défensivement les variantes connues.
function extractParticipants(p: Record<string, any>): Participant[] {
  const raw: any[] = []
  if (Array.isArray(p.participants)) raw.push(...p.participants)
  if (p.owner) raw.push(p.owner)
  if (Array.isArray(p.attendees)) raw.push(...p.attendees)
  const seen = new Set<string>()
  const out: Participant[] = []
  for (const item of raw) {
    const email = String(item?.email ?? '').trim().toLowerCase() || null
    const name = asText(item?.name ?? item?.display_name ?? item?.full_name) ?? (email ? email.split('@')[0] : null)
    const key = email ?? name ?? ''
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({ email, name })
  }
  return out
}

function extractTranscriptText(p: Record<string, any>): { text: string; speakerMap: Record<string, string> } {
  const speakerMap: Record<string, string> = {}
  const lines: string[] = []
  const push = (speaker: unknown, words: unknown) => {
    const name = asText((speaker as any)?.name ?? speaker) ?? 'Participant'
    const text = asText(words)
    if (!text) return
    speakerMap[name] = name
    lines.push(`${name} : ${text}`)
  }
  const t = p.transcript
  if (t && Array.isArray(t.speaker_blocks)) {
    for (const block of t.speaker_blocks) push(block?.speaker, block?.words ?? block?.text)
  } else if (Array.isArray(t)) {
    for (const block of t) push(block?.speaker, block?.words ?? block?.text)
  } else if (Array.isArray(p.transcript_segments)) {
    for (const block of p.transcript_segments) push(block?.speaker, block?.words ?? block?.text)
  }
  return { text: lines.join('\n'), speakerMap }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const token = new URL(req.url).searchParams.get('token')
    if (!token) return json({ error: 'token manquant' }, 401)
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

    // Le secret identifie l'organisation destinataire.
    const { data: connector } = await supabase.from('connectors')
      .select('organization_id,user_id,metadata')
      .eq('provider', 'read_ai').eq('status', 'connected')
      .eq('metadata->>webhook_secret', token).maybeSingle()
    if (!connector) return json({ error: 'Secret webhook invalide' }, 401)
    const organizationId = connector.organization_id as string
    const ownerUserId = connector.user_id as string

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return json({ error: 'Payload invalide' }, 400)
    const p = ((body as any).session ?? (body as any).data ?? body) as Record<string, any>

    const sessionId = asText(p.session_id ?? p.id ?? p.session_id) ?? `${Date.now()}`
    const participants = extractParticipants(p)
    const { text: transcriptText, speakerMap } = extractTranscriptText(p)

    // Ping / trigger sans contenu exploitable : on acquitte sans rien stocker.
    if (!participants.length && !transcriptText) return json({ success: true, ignored: true })

    // Entreprise déduite du premier participant à domaine professionnel.
    let companyId: string | null = null
    const primary = participants.find((participant) => corporateDomain(participant.email))
    const primaryDomain = primary ? corporateDomain(primary.email) : null
    if (primaryDomain) {
      const { data: company } = await supabase.rpc('resolve_company_identity', {
        p_organization_id: organizationId, p_name: companyNameFromDomain(primaryDomain), p_domain: primaryDomain, p_industry: null, p_create_if_missing: true,
      }).maybeSingle()
      companyId = (company as { company_id?: string } | null)?.company_id ?? null
    }

    const { data: meetingRow, error: meetingError } = await supabase.from('meetings').upsert({
      organization_id: organizationId, owner_user_id: ownerUserId, company_id: companyId,
      external_event_id: `readai:${sessionId}`,
      title: asText(p.title ?? p.session_title) ?? 'Réunion Read AI',
      starts_at: toIso(p.start_time ?? p.session_start_time),
      ends_at: toIso(p.end_time ?? p.session_end_time),
      platform: 'read_ai',
      description: asText(p.summary),
      raw_payload: body,
    }, { onConflict: 'organization_id,external_event_id' }).select('id').single()
    if (meetingError || !meetingRow) return json({ error: meetingError?.message ?? 'Réunion non enregistrée' }, 500)

    let participantsMatched = 0
    for (const participant of participants) {
      if (!participant.email) continue
      const { data: resolved } = await supabase.rpc('resolve_contact_identity', {
        p_organization_id: organizationId, p_email: participant.email, p_full_name: participant.name ?? participant.email,
        p_company_id: corporateDomain(participant.email) === primaryDomain ? companyId : null,
        p_owner_user_id: ownerUserId, p_role_title: null, p_source: 'read_ai',
      }).maybeSingle()
      const contactId = (resolved as { contact_id?: string } | null)?.contact_id ?? null
      const { error: participantError } = await supabase.from('meeting_participants').upsert({
        organization_id: organizationId, meeting_id: meetingRow.id, contact_id: contactId,
        email: participant.email, display_name: participant.name, name: participant.name,
        role_in_meeting: 'attendee', is_current_user: false,
      }, { onConflict: 'meeting_id,email' })
      if (!participantError) participantsMatched++
    }

    let transcriptStored = false
    if (transcriptText) {
      const { error: transcriptError } = await supabase.from('meeting_transcripts').upsert({
        organization_id: organizationId, meeting_id: meetingRow.id, provider: 'read_ai',
        transcript_text: transcriptText, speaker_map: speakerMap,
        // Read AI notifie les participants de l'enregistrement : consentement au niveau plateforme.
        consent_status: 'granted',
      }, { onConflict: 'meeting_id,provider' })
      transcriptStored = !transcriptError
    }

    await supabase.from('connectors').update({ last_synced_at: new Date().toISOString() })
      .eq('organization_id', organizationId).eq('user_id', ownerUserId).eq('provider', 'read_ai')

    return json({ success: true, meeting: meetingRow.id, participantsMatched, transcriptStored })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Traitement impossible' }, 500)
  }
})
