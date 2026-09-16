// Détecte les marqueurs personne (V6, scope='person') à partir des données
// RÉELLES de communication_messages/meetings, via les détecteurs déterministes
// PURS déjà écrits et testés (src/services/scoring/detectors.ts, copie Deno
// dans _shared/scoring-v6/detectors.ts). Alimente scoring.marker_event pour que
// score-batch-account-v6 puisse calculer de vrais scores de dyade (Satisfaction,
// Confiance & réciprocité) — jamais de marqueur fabriqué : un contact sans
// historique suffisant ne produit simplement aucun draft.
//
// Ne persiste que des drafts déterministes (S04/R01/R02/A01/A02/E05) —
// aucun appel LLM ici (voir classify-markers pour le volet sémantique,
// non câblé à ce jour). `status==='candidate'` est écrit avec is_candidate=true
// (traçabilité) mais n'entre jamais dans le calcul tant que non validé
// (cf. index scoring.marker_event_scoreable, filtré côté get_person_marker_events).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { runDeterministicDetectors, type DyadMeeting, type DyadMessage } from '../_shared/scoring-v6/detectors.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  const cronHeader = req.headers.get('x-cron-secret')
  let isCron = false
  if (cronHeader) {
    const { data: sec } = await supabase.from('app_secrets').select('value').eq('name', 'monitor_cron').maybeSingle()
    if (sec?.value && sec.value === cronHeader) isCron = true
  }
  if (!isCron) {
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    const segments = token.split('.')
    if (segments.length === 3) {
      try {
        const payload = JSON.parse(atob(segments[1].replace(/-/g, '+').replace(/_/g, '/')))
        if (payload?.role === 'service_role') isCron = true
      } catch { /* token non décodable : ignoré */ }
    }
  }
  if (!isCron) return jsonResponse({ error: 'Forbidden' }, 403)

  const now = new Date()

  const { data: companies, error: companiesErr } = await supabase
    .from('companies')
    .select('id, organization_id, account_settings(archived_at)')
  if (companiesErr) return jsonResponse({ error: companiesErr.message }, 500)

  let contactsProcessed = 0
  let eventsWritten = 0
  const errors: Array<{ companyId: string; message: string }> = []

  for (const row of (companies ?? []) as any[]) {
    const companyId = String(row.id)
    const organizationId = String(row.organization_id)
    const settings = Array.isArray(row.account_settings) ? row.account_settings[0] : row.account_settings
    if (settings?.archived_at) continue

    try {
      const { data: contacts } = await supabase.from('contacts').select('id')
        .eq('company_id', companyId).is('merged_into_contact_id', null)
      const contactIds = (contacts ?? []).map((c: any) => String(c.id))
      if (contactIds.length === 0) continue

      const [{ data: messages }, { data: participations }] = await Promise.all([
        supabase.from('communication_messages').select('id, contact_id, thread_id, direction, sent_at, subject').in('contact_id', contactIds),
        supabase.from('meeting_participants').select('contact_id, meeting_id, meetings(id, starts_at, ends_at)').in('contact_id', contactIds),
      ])

      const messagesByContact = new Map<string, DyadMessage[]>()
      for (const m of (messages ?? []) as any[]) {
        const list = messagesByContact.get(String(m.contact_id)) ?? []
        list.push({ id: String(m.id), threadId: String(m.thread_id), direction: m.direction, sentAt: m.sent_at, subject: m.subject })
        messagesByContact.set(String(m.contact_id), list)
      }
      const meetingsByContact = new Map<string, DyadMeeting[]>()
      for (const p of (participations ?? []) as any[]) {
        const meeting = Array.isArray(p.meetings) ? p.meetings[0] : p.meetings
        if (!meeting?.starts_at) continue
        const list = meetingsByContact.get(String(p.contact_id)) ?? []
        list.push({
          id: String(meeting.id), startsAt: meeting.starts_at,
          occurred: meeting.ends_at ? new Date(meeting.ends_at).getTime() < now.getTime() : new Date(meeting.starts_at).getTime() < now.getTime(),
          contactParticipated: true, // présence dans meeting_participants = seule preuve fiable (accept/decline non capté, cf. audit detectors.ts)
        })
        meetingsByContact.set(String(p.contact_id), list)
      }

      const events: Array<Record<string, unknown>> = []
      for (const contactId of contactIds) {
        const msgs = messagesByContact.get(contactId) ?? []
        const meets = meetingsByContact.get(contactId) ?? []
        if (msgs.length === 0 && meets.length === 0) continue
        const { drafts } = runDeterministicDetectors(msgs, meets, now.getTime())
        for (const d of drafts) {
          events.push({
            marker_id: d.markerId, contact_id: contactId, account_id: companyId,
            observed_at: d.observedAt, sense: d.sense, measure: d.measure, source: `detector:${d.detectorVersion}`,
            evidence_ref: d.evidenceRef, evidence_text: d.evidenceText, detector_version: d.detectorVersion,
            is_candidate: d.status === 'candidate',
            dedup_key: `det:${d.detectorVersion}:${d.markerId}:${contactId}:${d.evidenceRef}`,
          })
        }
        contactsProcessed++
      }

      if (events.length > 0) {
        const { data: inserted, error: upsertErr } = await supabase.rpc('upsert_person_marker_events', {
          p_organization_id: organizationId, p_events: events,
        })
        if (upsertErr) throw new Error(upsertErr.message)
        eventsWritten += Number(inserted ?? 0)
      }
    } catch (err) {
      errors.push({ companyId, message: err instanceof Error ? err.message : String(err) })
    }
  }

  return jsonResponse({ contactsProcessed, eventsWritten, errors })
})
