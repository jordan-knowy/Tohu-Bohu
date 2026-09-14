// Logique métier partagée entre tous les connecteurs calendrier (Google, Microsoft,
// et un futur 3e provider) : upsert idempotent d'un événement dans meetings/
// meeting_participants, calcul individuel/collectif, matching de participants.
// Un nouveau provider construit juste un NormalizedCalendarEvent[] et appelle
// upsertCalendarMeeting — aucune règle métier à réécrire.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.fr',
  'hotmail.com', 'hotmail.fr', 'live.com', 'live.fr', 'msn.com',
  'icloud.com', 'me.com', 'yahoo.com', 'yahoo.fr', 'proton.me', 'protonmail.com',
  'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'laposte.net',
  'gmx.com', 'gmx.fr', 'aol.com', 'mac.com',
  'avocat.com', 'avocat.fr',
])

export function cleanEmail(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

export function corporateDomain(email: string): string | null {
  const domain = cleanEmail(email).split('@')[1] ?? ''
  return domain && !PUBLIC_EMAIL_DOMAINS.has(domain) ? domain : null
}

export function companyNameFromDomain(domain: string): string {
  const base = domain.split('.')[0] ?? domain
  return base.split(/[-_]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') || domain
}

/** `String(error)` renvoie "[object Object]" pour une PostgrestError ou tout objet
 *  d'erreur qui n'est pas une instance d'Error (cas de la plupart des erreurs
 *  renvoyées par supabase-js) — indispensable pour des logs de cron exploitables. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>
    return String(obj.message ?? obj.error ?? obj.details ?? JSON.stringify(obj))
  }
  return String(error)
}

export type NormalizedAttendee = { email: string; displayName: string | null; organizer: boolean; self: boolean }

export type NormalizedCalendarEvent = {
  /** Préfixé par provider ('google:{id}' | 'microsoft:{id}') pour ne jamais collisionner entre sources. */
  externalEventId: string
  title: string
  startsAt: string
  endsAt: string | null
  status: 'confirmed' | 'cancelled'
  /** Lien de visioconférence à "rejoindre", si présent. */
  meetingUrl: string | null
  /** Lien "ouvrir dans l'agenda" du provider. */
  calendarHtmlLink: string | null
  platform: 'google_meet' | 'teams' | 'calendar_only'
  attendees: NormalizedAttendee[]
  raw: unknown
}

/** Individuelle = 1:1 ou petit meeting (≤ seuil de participants hors soi-même).
 *  Collective = standup, weekly, webinar — jamais de "prochain rendez-vous"
 *  individuel ni de briefing pour ses participants, même déjà fichés. */
export function meetingScopeOf(event: Pick<NormalizedCalendarEvent, 'attendees'>, maxAttendees: number): 'individual' | 'collective' {
  const others = event.attendees.filter((attendee) => !attendee.self)
  return others.length <= maxAttendees ? 'individual' : 'collective'
}

export type UpsertCalendarMeetingInput = {
  supabase: SupabaseClient
  organizationId: string
  ownerUserId: string
  event: NormalizedCalendarEvent
  source: string
  smallMeetingMaxAttendees: number
  /** true : ne réécrit pas meeting_scope/status/meeting_url/calendar_html_link/raw_payload —
   *  utilisé quand un autre passage calendrier a déjà posé ces champs sur la même ligne
   *  (convergence sync-google-meet ↔ sync-google-calendar sur le même external_event_id). */
  preserveCalendarFields?: boolean
}

export type UpsertCalendarMeetingResult = { meetingId: string; participantsUpserted: number }

export async function upsertCalendarMeeting(input: UpsertCalendarMeetingInput): Promise<UpsertCalendarMeetingResult> {
  const { supabase, organizationId, ownerUserId, event, source, smallMeetingMaxAttendees } = input
  const scope = meetingScopeOf(event, smallMeetingMaxAttendees)
  const others = event.attendees.filter((attendee) => !attendee.self)

  let companyId: string | null = null
  const primary = others[0] ?? null
  if (primary) {
    const domain = corporateDomain(primary.email)
    if (domain) {
      const { data: company } = await supabase.rpc('resolve_company_identity', {
        p_organization_id: organizationId, p_name: companyNameFromDomain(domain), p_domain: domain, p_industry: null, p_create_if_missing: true,
      }).maybeSingle()
      companyId = (company as { company_id?: string } | null)?.company_id ?? null
    }
  }

  const payload: Record<string, unknown> = {
    organization_id: organizationId,
    owner_user_id: ownerUserId,
    company_id: companyId,
    external_event_id: event.externalEventId,
    title: event.title,
    starts_at: event.startsAt,
    ends_at: event.endsAt,
    platform: event.platform,
  }
  if (!input.preserveCalendarFields) {
    Object.assign(payload, {
      status: event.status,
      meeting_scope: scope,
      meeting_url: event.meetingUrl,
      calendar_html_link: event.calendarHtmlLink,
      raw_payload: event.raw,
    })
  }

  const { data: meetingRow, error: meetingError } = await supabase.from('meetings')
    .upsert(payload, { onConflict: 'organization_id,external_event_id' })
    .select('id').single()
  if (meetingError || !meetingRow) throw meetingError ?? new Error('Réunion non enregistrée')

  let participantsUpserted = 0
  for (const attendee of others) {
    const { data: resolved } = await supabase.rpc('resolve_contact_identity', {
      p_organization_id: organizationId,
      p_email: attendee.email,
      p_full_name: attendee.displayName ?? attendee.email,
      p_company_id: companyId,
      p_owner_user_id: ownerUserId,
      p_role_title: null,
      p_source: source,
      p_create_if_missing: scope === 'individual',
    }).maybeSingle()
    // contact_id reste null pour un membre Tohu (resolve_contact_identity renvoie
    // alors 0 ligne) ou pour un inconnu en réunion collective : c'est voulu, pas
    // une erreur — rien de spécial à faire ici, la garantie vient de la RPC.
    const { error: participantError } = await supabase.from('meeting_participants').upsert({
      organization_id: organizationId,
      meeting_id: meetingRow.id,
      contact_id: (resolved as { contact_id?: string } | null)?.contact_id ?? null,
      email: attendee.email,
      display_name: attendee.displayName,
      role_in_meeting: attendee.organizer ? 'organizer' : 'attendee',
      is_current_user: false,
    }, { onConflict: 'meeting_id,email' })
    if (!participantError) participantsUpserted++
  }

  return { meetingId: meetingRow.id as string, participantsUpserted }
}
