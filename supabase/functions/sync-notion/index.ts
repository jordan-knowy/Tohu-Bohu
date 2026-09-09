import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { blockText, notionApi, NotionError, notionPageUrl, NOTION_REAUTH_ERRORS, richText } from '../_shared/notion.ts'
import { analyze, asRecord, attributedTranscriptExcerpt, errorMessage, persistContactProfile } from '../_shared/behavior-analysis.ts'
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } })
const checked = async (query: any) => { const result = await query; if (result.error) throw new Error(result.error.message); return result.data }

async function allBlockText(token: string, rootId: string): Promise<string> {
  const lines: string[] = [], queue = [rootId]
  while (queue.length && lines.join('\n').length < 120000) {
    const id = queue.shift()!, page = await notionApi(token, `/blocks/${id}/children?page_size=100`)
    for (const block of page.results ?? []) {
      const value = blockText(block)
      if (value) lines.push(value)
      if (block.has_children) queue.push(block.id)
    }
    let cursor = page.next_cursor
    while (page.has_more && cursor) {
      const next = await notionApi(token, `/blocks/${id}/children?page_size=100&start_cursor=${encodeURIComponent(cursor)}`)
      for (const block of next.results ?? []) { const value = blockText(block); if (value) lines.push(value); if (block.has_children) queue.push(block.id) }
      cursor = next.next_cursor
      if (!next.has_more) break
    }
  }
  return lines.join('\n').trim()
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let connector: any, state: any, lease: string | null = null
  try {
    const { data: { user } } = await db.auth.getUser((req.headers.get('Authorization') ?? '').replace('Bearer ', ''))
    if (!user) return json({ error: 'Session invalide' }, 401)
    const { organizationId } = await req.json()
    if (!await checked(db.from('memberships').select('id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle())) return json({ error: 'Accès refusé' }, 403)
    connector = await checked(db.from('connectors').select('*').eq('organization_id', organizationId).eq('user_id', user.id).eq('provider', 'notion').single())
    lease = crypto.randomUUID()
    if (!await checked(db.rpc('claim_connector_sync', { p_connector_id: connector.id, p_lease_id: lease }))) { lease = null; return json({ pending: true, retryAfter: 5 }) }
    state = (await checked(db.from('connector_sync_state').select('state').eq('connector_id', connector.id).single())).state ?? {}
    if (state.retryAt > Date.now()) return json({ pending: true, retryAfter: Math.ceil((state.retryAt - Date.now()) / 1000) })
    const oauth = (await checked(db.rpc('get_oauth_tokens_server', { p_connector_id: connector.id })))?.[0]
    if (!oauth?.access_token) throw new NotionError('unauthorized', 401)
    const token = oauth.access_token
    if (!state.phase || state.phase === 'done') {
      const job = await checked(db.from('sync_jobs').insert({ organization_id: organizationId, connector_id: connector.id, user_id: user.id, provider: 'notion', job_type: 'notion_meeting_notes_sync', status: 'running', current_step: 'Lecture des notes de réunion Notion', progress: 5, started_at: new Date().toISOString(), payload: {} }).select('id').single())
      state = { phase: 'query', notes: [], index: 0, count: 0, profilesUpdated: 0, analysisErrors: [], jobId: job.id, watermark: state.watermark ?? null, before: null, newest: state.watermark ?? null }
    }
    if (state.phase === 'query') {
      const filters: any[] = []
      if (state.watermark) filters.push({ property: 'last_edited_time', filter: { operator: 'date_after', value: { type: 'exact', value: state.watermark } } })
      if (state.before) filters.push({ property: 'last_edited_time', filter: { operator: 'date_before', value: { type: 'exact', value: state.before } } })
      const page = await notionApi(token, '/blocks/meeting_notes/query', { method: 'POST', body: JSON.stringify({ limit: 50, sort: [{ property: 'last_edited_time', direction: 'descending' }], ...(filters.length ? { filter: filters.length === 1 ? filters[0] : { operator: 'and', filters } } : {}) }) })
      const fresh = (page.results ?? []).filter((item: any) => !state.notes.some((known: any) => known.id === item.id))
      state.notes.push(...fresh)
      if (!state.newest && fresh[0]?.last_edited_time) state.newest = fresh[0].last_edited_time
      if (page.has_more && fresh.length) state.before = fresh[fresh.length - 1].last_edited_time
      else state.phase = 'process'
    } else if (state.index < state.notes.length) {
      const note = state.notes[state.index], info = note.meeting_notes ?? {}, children = info.children ?? {}
      const sectionIds = [children.summary_block_id, children.notes_block_id, children.transcript_block_id].filter(Boolean)
      const sections: string[] = []
      for (const id of sectionIds) sections.push(await allBlockText(token, id))
      const transcript = sections.filter(Boolean).join('\n\n')
      const title = richText(info.title) || 'Réunion Notion'
      const pageId = note.parent?.page_id ?? note.id
      const sourceUrl = notionPageUrl(pageId)
      const meeting = await checked(db.from('meetings').upsert({ organization_id: organizationId, owner_user_id: user.id, external_event_id: `notion:${note.id}`, title, starts_at: info.calendar_event?.start_time ?? info.recording?.start_time ?? note.created_time, ends_at: info.calendar_event?.end_time ?? info.recording?.end_time ?? null, platform: 'Notion', meeting_type: 'other', raw_payload: { provider: 'notion', block_id: note.id, page_id: pageId, source_url: sourceUrl, status: info.status, workspace_id: connector.metadata.workspace_id, last_edited_time: note.last_edited_time } }, { onConflict: 'organization_id,external_event_id' }).select('id').single())
      await checked(db.from('meeting_transcripts').upsert({ organization_id: organizationId, meeting_id: meeting.id, provider: 'notion', transcript_text: transcript || `[${title}] Notes en cours de génération dans Notion.`, speaker_map: { source_url: sourceUrl, notion_block_id: note.id }, consent_status: 'granted' }, { onConflict: 'meeting_id,provider' }))
      await checked(db.from('meeting_participants').delete().eq('meeting_id', meeting.id))
      const analysable: Array<{ id: string; full_name: string; email: string | null }> = []
      for (const attendeeId of info.calendar_event?.attendees ?? []) {
        const attendee = await notionApi(token, `/users/${attendeeId}`)
        const email = attendee.person?.email?.trim().toLowerCase() ?? null
        let contactId = null
        if (email && attendeeId !== connector.metadata.owner_user_id) {
          const resolved = await checked(db.rpc('resolve_contact_identity', { p_organization_id: organizationId, p_email: email, p_full_name: attendee.name ?? email, p_company_id: null, p_owner_user_id: user.id, p_source: 'notion' }).maybeSingle())
          contactId = resolved?.contact_id ?? null
          if (contactId) {
            const contact = await checked(db.from('contacts').select('id,full_name,email').eq('organization_id', organizationId).eq('id', contactId).single())
            analysable.push(contact)
          }
        }
        await checked(db.from('meeting_participants').insert({ organization_id: organizationId, meeting_id: meeting.id, contact_id: contactId, email, display_name: attendee.name, role_in_meeting: 'participant', is_current_user: attendeeId === connector.metadata.owner_user_id }))
      }
      // Même pipeline que les transcriptions Read AI : analyse uniquement les
      // prises de parole attribuables à un participant rapproché.
      for (const contact of analysable.slice(0, 5)) {
        const excerpt = attributedTranscriptExcerpt(transcript, [contact.full_name, contact.email ?? ''])
        if (!excerpt) continue
        try {
          const [{ count: messageCount }, { count: meetingCount }, { data: previous }] = await Promise.all([
            db.from('communication_messages').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('contact_id', contact.id).eq('direction', 'inbound'),
            db.from('meeting_participants').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('contact_id', contact.id),
            db.from('cognitive_profiles').select('cognitive_profile_data,updated_from').eq('organization_id', organizationId).eq('contact_id', contact.id).eq('profile_version', 1).maybeSingle(),
          ])
          const interactions = (messageCount ?? 0) + (meetingCount ?? 0)
          const result = await analyze(contact.full_name, 'contact', [excerpt], asRecord(previous?.cognitive_profile_data), interactions, { client: db, organizationId, userId: user.id })
          await persistContactProfile(db, { organizationId, contactId: contact.id, result, messageCount: messageCount ?? 0, meetingCount: meetingCount ?? 0, interactionCount: interactions, updatedFrom: [...new Set<string>([...(previous?.updated_from ?? []), 'notion', 'meeting_transcript'])], signalSource: 'notion_meeting_notes', sourceRef: sourceUrl, observedAt: info.calendar_event?.start_time ?? note.created_time })
          state.profilesUpdated++
        } catch (error) { state.analysisErrors.push(`${contact.full_name}: ${errorMessage(error)}`) }
      }
      state.index++; state.count++
      if (state.index >= state.notes.length) state.phase = 'done'
    } else state.phase = 'done'
    const complete = state.phase === 'done'
    if (complete && state.newest) state.watermark = state.newest
    state.retryAt = null
    await checked(db.from('connector_sync_state').update({ state }).eq('connector_id', connector.id).eq('lease_id', lease))
    const progress = complete ? 100 : state.phase === 'query' ? 5 : Math.min(95, 10 + Math.floor(state.index / Math.max(1, state.notes.length) * 85))
    await checked(db.from('sync_jobs').update({ status: complete ? 'succeeded' : 'running', current_step: complete ? 'Synchronisation Notion terminée' : 'Import et analyse des notes de réunion Notion', progress, completed_at: complete ? new Date().toISOString() : null, payload: { meetings: state.count, profiles_updated: state.profilesUpdated, analysis_errors: state.analysisErrors.slice(0, 5) } }).eq('id', state.jobId))
    await checked(db.from('connectors').update({ status: 'connected', ...(complete ? { last_synced_at: new Date().toISOString() } : {}), metadata: { ...connector.metadata, last_error: null } }).eq('id', connector.id))
    return json({ success: true, pending: !complete, progress, meetings: state.count, profilesUpdated: state.profilesUpdated })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Synchronisation Notion impossible'
    if (connector && state && error instanceof NotionError && error.retryAfter) { state.retryAt = Date.now() + error.retryAfter * 1000; await db.from('connector_sync_state').update({ state }).eq('connector_id', connector.id); return json({ pending: true, retryAfter: error.retryAfter, progress: 5, meetings: state.count ?? 0, profilesUpdated: state.profilesUpdated ?? 0 }) }
    if (connector) await db.from('connectors').update({ status: error instanceof NotionError && NOTION_REAUTH_ERRORS.includes(error.code) ? 'needs_reauth' : 'error', metadata: { ...connector.metadata, last_error: message } }).eq('id', connector.id)
    if (state?.jobId) await db.from('sync_jobs').update({ status: 'failed', error_message: message, completed_at: new Date().toISOString() }).eq('id', state.jobId)
    return json({ error: message }, 500)
  } finally { if (connector && lease) await db.from('connector_sync_state').update({ lease_until: null, lease_id: null }).eq('connector_id', connector.id).eq('lease_id', lease) }
})
