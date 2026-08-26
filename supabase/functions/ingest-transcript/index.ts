// Ingestion manuelle d'un transcript déposé (glisser-déposer côté UI).
//
// Le client a déjà : (1) uploadé le fichier dans le bucket `tohu-documents`,
// (2) pré-créé une ligne `sync_jobs` (job_type='transcript_analysis'). Cette
// fonction télécharge le fichier, parse les formats .txt/.vtt/.srt en un
// transcript normalisé "Nom (m:ss) : texte", identifie les intervenants et les
// résout vers des contacts EXISTANTS (jamais de contact fantôme), crée
// meetings + meeting_participants + meeting_transcripts (même modèle que le
// webhook Read AI), puis lance l'analyse comportementale partagée
// (_shared/behavior-analysis.ts) pour enrichir le profil de chaque participant
// reconnu — avec traçabilité (source_type='manual_transcript_analysis').
//
// Aucune clé IA côté client : l'appel OpenRouter se fait ici, côté serveur.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  analyze,
  asRecord,
  attributedTranscriptExcerpt,
  errorMessage,
  normalizedSpeaker,
  persistContactProfile,
  type UsageLogContext,
} from '../_shared/behavior-analysis.ts'
import { logAiUsage } from '../_shared/ai-usage.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

// Nombre maximum d'intervenants analysés à chaud (budget d'exécution) — les
// éventuels suivants seront repris par le batch d'analyse existant.
const MAX_ANALYZED_PARTICIPANTS = 8
const MAX_TRANSCRIPT_CHARS = 1_000_000

type ParsedTranscript = { transcriptText: string; speakers: string[]; speakerMap: Record<string, string> }
type ContactRow = { id: string; full_name: string | null; email: string | null }

// ── Extraction engagements + moments depuis le transcript ──────────────────
// Le transcript est stocké (meeting_transcripts) : citer un verbatim est donc
// légitime. Un engagement n'est conservé que si sa phrase source apparaît
// réellement dans le transcript (garde-fou anti-invention).
type TranscriptEngagement = { content: string; confidence: number; due_date: string | null; source_quote: string | null }
type TranscriptMoment = { title: string; summary: string | null; occurred_date: string | null; impact: 'friction' | 'reinforce' | 'milestone'; confidence: number }

function normCommitment(value: string): string {
  return value.toLowerCase().replace(/^nous\s*:\s*/, '').replace(/\s+—\s+échéance.*$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

async function extractTranscriptContext(name: string, transcriptText: string, usageLog?: UsageLogContext): Promise<{ engagements: TranscriptEngagement[]; moments: TranscriptMoment[] }> {
  const empty = { engagements: [] as TranscriptEngagement[], moments: [] as TranscriptMoment[] }
  const apiKey = Deno.env.get('OPENROUTER_API_KEY')
  if (!apiKey || !transcriptText.trim()) return empty
  const corpus = transcriptText.slice(0, 16000)
  const prompt = `À partir de ce transcript de réunion avec ${name}, relève deux choses, uniquement à partir de faits réellement présents (jamais inventé).

1) ENGAGEMENTS — promesses/actions que ${name} ("contact") OU nous ("nous") s'est engagé à faire :
- "text" : reformulation courte et actionnable ;
- "owner" : "contact" ou "nous" ;
- "due_date" : échéance AAAA-MM-JJ si mentionnée, sinon null ;
- "confidence" : 0 à 100 ;
- "source_quote" : la phrase EXACTE du transcript, copiée mot pour mot, qui prouve l'engagement (≤ 240 caractères) ; null si aucune.

2) MOMENTS QUI COMPTENT — jalons observables (avancées ET tensions), 4 à 10 :
- "title" court et factuel ; "summary" une phrase ou null ; "occurred_date" AAAA-MM-JJ ou null ;
- "impact" : "friction" | "reinforce" | "milestone" ; "confidence" 0 à 100.

Réponds uniquement en JSON : {"engagements":[{"text":"...","owner":"contact","due_date":null,"confidence":0,"source_quote":null}],"moments":[{"title":"...","summary":null,"occurred_date":null,"impact":"milestone","confidence":0}]}

Transcript :\n${corpus}`
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Tohu Transcript Context Extraction' },
    body: JSON.stringify({
      model: Deno.env.get('OPENROUTER_ANALYSIS_MODEL') ?? 'google/gemini-3.1-flash-lite',
      temperature: 0,
      response_format: { type: 'json_object' },
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!response.ok) throw new Error(`OpenRouter ${response.status}`)
  const data = await response.json()
  if (usageLog) await logAiUsage(usageLog.client, { organizationId: usageLog.organizationId, userId: usageLog.userId, fn: 'ingest-transcript:extractContext', model: Deno.env.get('OPENROUTER_ANALYSIS_MODEL') ?? 'google/gemini-3.1-flash-lite', usage: data?.usage })
  const raw = asRecord(data).choices
  const content = Array.isArray(raw) ? String(asRecord(asRecord(raw[0]).message).content ?? '{}') : '{}'
  const parsed = asRecord(JSON.parse(content))
  const normText = (v: string) => v.toLowerCase().replace(/\s+/g, ' ').trim()
  const corpusNorm = normText(corpus)
  const engagements = (Array.isArray(parsed.engagements) ? parsed.engagements : [])
    .map((entry) => asRecord(entry))
    .filter((entry) => typeof entry.text === 'string' && String(entry.text).trim().length > 3)
    .slice(0, 20)
    .map((entry) => {
      const owner = entry.owner === 'nous' ? 'nous' : 'contact'
      const text = String(entry.text).trim().slice(0, 300)
      const dueDate = typeof entry.due_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(entry.due_date) ? String(entry.due_date).slice(0, 10) : null
      const rawQuote = typeof entry.source_quote === 'string' ? entry.source_quote.trim().replace(/^[«"']\s*|\s*[»"']$/g, '').slice(0, 240) : ''
      const quoteVerified = rawQuote.length >= 8 && corpusNorm.includes(normText(rawQuote))
      const base = owner === 'nous' ? `Nous : ${text}` : text
      return {
        content: dueDate ? `${base} — échéance ${dueDate}` : base,
        confidence: Number.isFinite(Number(entry.confidence)) ? Math.max(0, Math.min(100, Number(entry.confidence))) : 50,
        due_date: dueDate,
        source_quote: quoteVerified ? rawQuote : null,
      }
    })
  const moments = (Array.isArray(parsed.moments) ? parsed.moments : [])
    .map((entry) => asRecord(entry))
    .filter((entry) => typeof entry.title === 'string' && String(entry.title).trim().length > 3)
    .slice(0, 12)
    .map((entry) => ({
      title: String(entry.title).trim().slice(0, 200),
      summary: typeof entry.summary === 'string' && String(entry.summary).trim() ? String(entry.summary).trim().slice(0, 400) : null,
      occurred_date: typeof entry.occurred_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(entry.occurred_date) ? String(entry.occurred_date).slice(0, 10) : null,
      impact: entry.impact === 'friction' ? 'friction' as const : entry.impact === 'reinforce' ? 'reinforce' as const : 'milestone' as const,
      confidence: Number.isFinite(Number(entry.confidence)) ? Math.max(0, Math.min(100, Number(entry.confidence))) : 50,
    }))
  return { engagements, moments }
}

// ── Parsing des formats de transcript ─────────────────────────────────────

function secondsToClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`
}

// "00:01:23.400" (VTT) ou "00:01:23,400" (SRT) ou "01:23" → secondes.
function parseTimestamp(raw: string): number | null {
  const cleaned = raw.trim().replace(',', '.')
  const match = cleaned.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.\d{1,3})?$/)
  if (!match) return null
  const h = match[1] ? Number(match[1]) : 0
  const m = Number(match[2])
  const sec = Number(match[3])
  return h * 3600 + m * 60 + sec
}

function cleanSpeakerName(raw: string): string {
  return raw.replace(/["<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)
}

function addLine(lines: string[], speakers: Set<string>, speaker: string, at: number | null, text: string): void {
  const name = cleanSpeakerName(speaker) || 'Participant'
  const body = text.replace(/\s+/g, ' ').trim()
  if (!body) return
  speakers.add(name)
  lines.push(at != null ? `${name} (${secondsToClock(at)}) : ${body}` : `${name} : ${body}`)
}

// Une ligne texte de type "Nom : propos" (avec horodatage optionnel).
const SPEAKER_LINE = /^(.+?)(?:\s+[([]?\d{1,2}:\d{2}(?::\d{2})?[)\]]?)?\s*:\s*(.+)$/

function parseTxt(raw: string): ParsedTranscript {
  const speakers = new Set<string>()
  const lines: string[] = []
  let lastSpeaker: string | null = null
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const match = line.match(SPEAKER_LINE)
    // On exige un préfixe locuteur court et plausible (pas une phrase entière
    // ni une URL) pour éviter de confondre un ":" de ponctuation avec un
    // marqueur de locuteur.
    if (match && match[1].length <= 60 && !match[1].includes('http')) {
      lastSpeaker = cleanSpeakerName(match[1])
      addLine(lines, speakers, lastSpeaker, null, match[2])
    } else if (lastSpeaker) {
      // Continuation du dernier locuteur (paragraphe multi-lignes).
      addLine(lines, speakers, lastSpeaker, null, line)
    }
  }
  return { transcriptText: lines.join('\n'), speakers: [...speakers], speakerMap: Object.fromEntries([...speakers].map((s) => [s, s])) }
}

function parseCueBlocks(raw: string, timeSeparator: RegExp): ParsedTranscript {
  const speakers = new Set<string>()
  const lines: string[] = []
  const blocks = raw.replace(/^WEBVTT.*$/im, '').split(/\r?\n\r?\n+/)
  for (const block of blocks) {
    const blockLines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (!blockLines.length) continue
    let at: number | null = null
    const textLines: string[] = []
    for (const bl of blockLines) {
      const timeMatch = bl.match(timeSeparator)
      if (timeMatch) { at = parseTimestamp(timeMatch[1]); continue }
      if (/^\d+$/.test(bl) && textLines.length === 0) continue // index SRT
      textLines.push(bl)
    }
    if (!textLines.length) continue
    let joined = textLines.join(' ')
    // Locuteur : balise VTT "<v Nom>" ou préfixe "Nom:".
    let speaker = 'Participant'
    const voice = joined.match(/^<v\s+([^>]+)>/i)
    if (voice) {
      speaker = voice[1]
      joined = joined.replace(/^<v\s+[^>]+>/i, '')
    } else {
      const prefixed = joined.match(/^([^:]{1,60}):\s*(.+)$/)
      if (prefixed && !prefixed[1].includes('http')) { speaker = prefixed[1]; joined = prefixed[2] }
    }
    joined = joined.replace(/<\/?[^>]+>/g, ' ') // retire les balises restantes
    addLine(lines, speakers, speaker, at, joined)
  }
  return { transcriptText: lines.join('\n'), speakers: [...speakers], speakerMap: Object.fromEntries([...speakers].map((s) => [s, s])) }
}

function parseTranscript(fileName: string, raw: string): ParsedTranscript {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase()
  const text = raw.slice(0, MAX_TRANSCRIPT_CHARS)
  if (ext === 'vtt') return parseCueBlocks(text, /(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})\s*-->/)
  if (ext === 'srt') return parseCueBlocks(text, /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})\s*-->/)
  return parseTxt(text)
}

// ── Résolution intervenant → contact existant (conservatrice) ─────────────

function matchSpeakerToContact(speaker: string, contacts: ContactRow[]): ContactRow | null {
  const nSpeaker = normalizedSpeaker(speaker)
  if (nSpeaker.length < 3) return null
  const exact = contacts.filter((c) => normalizedSpeaker(c.full_name) === nSpeaker)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return null // homonymes → on n'attribue pas
  // Tous les mots du locuteur présents dans un unique nom de contact
  // (ex. "Marie" → "Marie Durand" si elle est la seule "Marie").
  const speakerTokens = nSpeaker.split(' ').filter(Boolean)
  const candidates = contacts.filter((c) => {
    const nameTokens = normalizedSpeaker(c.full_name).split(' ').filter(Boolean)
    return speakerTokens.length > 0 && speakerTokens.every((t) => nameTokens.includes(t))
  })
  return candidates.length === 1 ? candidates[0] : null
}

// ── Handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authorization = req.headers.get('Authorization')
  if (!authorization) return json({ error: 'Authentification requise.' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authorization } },
  })
  const admin: SupabaseClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  const { data: { user }, error: userError } = await userClient.auth.getUser()
  if (userError || !user) return json({ error: 'Session invalide.' }, 401)

  const { jobId } = await req.json().catch(() => ({})) as { jobId?: string }
  if (!jobId) return json({ error: 'jobId manquant.' }, 400)

  // Le job doit appartenir au caller (RLS via userClient) et être du bon type.
  const { data: job, error: jobError } = await userClient.from('sync_jobs')
    .select('id,organization_id,user_id,job_type,status,payload')
    .eq('id', jobId).maybeSingle()
  if (jobError || !job) return json({ error: 'Job introuvable.' }, 404)
  if (job.job_type !== 'transcript_analysis' || job.user_id !== user.id) return json({ error: 'Job non autorisé.' }, 403)

  const organizationId = job.organization_id as string
  const payload = asRecord(job.payload)
  const storagePath = String(payload.storage_path ?? '')
  const fileName = String(payload.file_name ?? 'transcript.txt')
  const meetingTitle = (typeof payload.title === 'string' && payload.title.trim()) ? payload.title.trim() : `Transcript — ${fileName}`
  const startsAt = typeof payload.meeting_date === 'string' && payload.meeting_date ? payload.meeting_date : new Date().toISOString()
  // Défense en profondeur : le chemin doit vivre dans le dossier de l'org.
  if (!storagePath || !storagePath.startsWith(`${organizationId}/`)) {
    await failJob(admin, jobId, 'Chemin de fichier invalide.', 'invalid_path')
    return json({ error: 'Chemin de fichier invalide.' }, 400)
  }

  const setStep = (step: string, progress: number) =>
    admin.from('sync_jobs').update({ status: 'running', current_step: step, progress }).eq('id', jobId)

  try {
    await admin.from('sync_jobs').update({ status: 'running', started_at: new Date().toISOString(), current_step: 'Lecture du fichier', progress: 5 }).eq('id', jobId)

    // 1) Téléchargement + parsing.
    const { data: fileData, error: downloadError } = await admin.storage.from('tohu-documents').download(storagePath)
    if (downloadError || !fileData) throw new Error(`Fichier introuvable : ${downloadError?.message ?? storagePath}`)
    const raw = await fileData.text()
    await setStep('Analyse du transcript', 20)
    const parsed = parseTranscript(fileName, raw)
    if (!parsed.transcriptText.trim()) throw new Error('Transcript vide ou illisible.')

    // 2) Résolution des intervenants vers des contacts existants.
    await setStep('Identification des intervenants', 35)
    const { data: contactRows, error: contactError } = await admin.from('contacts')
      .select('id,full_name,email')
      .eq('organization_id', organizationId)
      .is('merged_into_contact_id', null)
      .limit(5000)
    if (contactError) throw contactError
    const contacts = (contactRows ?? []) as ContactRow[]
    const resolved = parsed.speakers.map((speaker) => ({ speaker, contact: matchSpeakerToContact(speaker, contacts) }))

    // 3) Réunion + participants + transcript (idempotent sur le job).
    await setStep('Enregistrement de la réunion', 45)
    const { data: meetingRow, error: meetingError } = await admin.from('meetings').upsert({
      organization_id: organizationId,
      owner_user_id: job.user_id,
      external_event_id: `manual:${jobId}`,
      title: meetingTitle,
      starts_at: startsAt,
      platform: 'manual_upload',
      description: null,
      raw_payload: { source: 'manual_upload', file_name: fileName, storage_path: storagePath, speakers: parsed.speakers },
    }, { onConflict: 'organization_id,external_event_id' }).select('id').single()
    if (meetingError || !meetingRow) throw new Error(meetingError?.message ?? 'Réunion non enregistrée.')
    const meetingId = meetingRow.id as string

    await admin.from('meeting_participants').delete().eq('organization_id', organizationId).eq('meeting_id', meetingId)
    const participantRows = resolved.map(({ speaker, contact }) => ({
      organization_id: organizationId,
      meeting_id: meetingId,
      contact_id: contact?.id ?? null,
      email: contact?.email ?? null,
      display_name: speaker,
      name: speaker,
      role_in_meeting: 'attendee',
      is_current_user: false,
    }))
    if (participantRows.length) {
      const { error: participantError } = await admin.from('meeting_participants').insert(participantRows)
      if (participantError) throw participantError
    }

    await admin.from('meeting_transcripts').upsert({
      organization_id: organizationId,
      meeting_id: meetingId,
      provider: 'manual_upload',
      transcript_text: parsed.transcriptText,
      speaker_map: parsed.speakerMap,
      // L'uploadeur atteste du consentement via la case à cocher de l'UI.
      consent_status: payload.consent === false ? 'unknown' : 'granted',
    }, { onConflict: 'meeting_id,provider' })

    // 4) Analyse comportementale par intervenant reconnu (avec extrait attribué).
    const analysable = resolved
      .filter((r): r is { speaker: string; contact: ContactRow } => Boolean(r.contact))
      .map((r) => ({ ...r, excerpt: attributedTranscriptExcerpt(parsed.transcriptText, [r.speaker, r.contact.email ?? '', r.contact.full_name ?? '']) }))
      .filter((r) => Boolean(r.excerpt))
      .slice(0, MAX_ANALYZED_PARTICIPANTS)

    let profilesUpdated = 0
    const analysisErrors: string[] = []
    for (let i = 0; i < analysable.length; i++) {
      const { speaker, contact, excerpt } = analysable[i]
      await setStep(`Analyse comportementale (${i + 1}/${analysable.length})`, 55 + Math.round(((i) / Math.max(1, analysable.length)) * 35))
      try {
        const [{ count: msgCount }, { count: mtgCount }, { data: prev }] = await Promise.all([
          admin.from('communication_messages').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('contact_id', contact.id).eq('direction', 'inbound'),
          admin.from('meeting_participants').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('contact_id', contact.id),
          admin.from('cognitive_profiles').select('cognitive_profile_data,updated_from').eq('organization_id', organizationId).eq('contact_id', contact.id).eq('profile_version', 1).maybeSingle(),
        ])
        const messageCount = msgCount ?? 0
        const meetingCount = mtgCount ?? 0
        const interactionCount = messageCount + meetingCount
        const previousProfile = asRecord(prev?.cognitive_profile_data)
        const prevUpdatedFrom = Array.isArray(prev?.updated_from) ? prev!.updated_from.map(String) : []
        const result = await analyze(contact.full_name ?? speaker, 'contact', [excerpt as string], previousProfile, interactionCount, { client: admin, organizationId, userId: job.user_id as string })
        await persistContactProfile(admin, {
          organizationId,
          contactId: contact.id,
          result,
          messageCount,
          meetingCount,
          interactionCount,
          updatedFrom: [...new Set([...prevUpdatedFrom, 'manual_upload', 'meeting_transcript'])],
          signalSource: 'manual_transcript_analysis',
          sourceRef: `transcript:${meetingId}`,
          observedAt: startsAt,
        })
        profilesUpdated++
      } catch (error) {
        analysisErrors.push(`${speaker}: ${errorMessage(error)}`)
      }
    }

    // 5) Engagements pris + moments qui comptent, rattachés au contact ciblé
    // (fiche d'origine si fournie, sinon le premier intervenant reconnu).
    let commitmentsAdded = 0
    const targetContactId = String(payload.contact_id ?? '')
    const targetContact = analysable.find((r) => r.contact.id === targetContactId)?.contact ?? analysable[0]?.contact ?? null
    if (targetContact) {
      await setStep('Extraction des engagements', 92)
      try {
        const ctx = await extractTranscriptContext(targetContact.full_name ?? 'Contact', parsed.transcriptText, { client: admin, organizationId, userId: job.user_id as string })
        if (ctx.engagements.length) {
          const { data: existing } = await admin.from('person_memory_entries')
            .select('content').eq('organization_id', organizationId).eq('contact_id', targetContact.id).eq('entry_type', 'commitment')
          const seen = new Set((existing ?? []).map((r) => normCommitment(String(r.content ?? ''))))
          const fresh = ctx.engagements
            .filter((e) => { const key = normCommitment(e.content); if (seen.has(key)) return false; seen.add(key); return true })
            .map((e) => ({
              organization_id: organizationId,
              contact_id: targetContact.id,
              author_user_id: job.user_id,
              entry_type: 'commitment',
              content: e.content,
              visibility: 'workspace',
              processing_status: 'ready',
              source_type: 'manual_transcript_analysis',
              source_label: 'Tohu · transcript',
              confidence: e.confidence,
              inference_level: 'strong_inference',
              observed_at: startsAt,
              source_excerpt: e.source_quote,
              source_occurred_at: startsAt,
              source_direction: null,
            }))
          if (fresh.length) {
            const { error: memErr } = await admin.from('person_memory_entries').insert(fresh)
            if (memErr) analysisErrors.push(`engagements: ${memErr.message}`); else commitmentsAdded = fresh.length
          }
        }
        if (ctx.moments.length) {
          const { data: existingMoments } = await admin.from('person_key_moments')
            .select('title').eq('organization_id', organizationId).eq('contact_id', targetContact.id)
          const seenM = new Set((existingMoments ?? []).map((r) => normCommitment(String(r.title ?? ''))))
          const freshM = ctx.moments
            .filter((m) => { const key = normCommitment(m.title); if (seenM.has(key)) return false; seenM.add(key); return true })
            .map((m) => ({
              organization_id: organizationId,
              contact_id: targetContact.id,
              occurred_at: m.occurred_date ? new Date(m.occurred_date).toISOString() : startsAt,
              title: m.title,
              summary: m.summary,
              impact: m.impact,
              confidence: m.confidence,
              source_label: 'Tohu · transcript',
            }))
          if (freshM.length) {
            const { error: momErr } = await admin.from('person_key_moments').insert(freshM)
            if (momErr) analysisErrors.push(`moments: ${momErr.message}`)
          }
        }
      } catch (error) {
        analysisErrors.push(`engagements: ${errorMessage(error)}`)
      }
    }

    const matched = resolved.filter((r): r is { speaker: string; contact: ContactRow } => Boolean(r.contact))
    const unmatched = resolved.filter((r) => !r.contact).map((r) => r.speaker)
    const result = {
      meeting_id: meetingId,
      speakers_total: parsed.speakers.length,
      participants_matched: matched.length,
      profiles_updated: profilesUpdated,
      commitments_added: commitmentsAdded,
      matched_participants: matched.map((r) => ({ contact_id: r.contact.id, name: r.contact.full_name ?? r.speaker })),
      speakers_unmatched: unmatched,
      analysis_errors: analysisErrors,
    }
    await admin.from('sync_jobs').update({
      status: 'succeeded',
      current_step: 'Terminé',
      progress: 100,
      completed_at: new Date().toISOString(),
      payload: { ...payload, result },
    }).eq('id', jobId)

    return json({ success: true, ...result })
  } catch (error) {
    const message = errorMessage(error)
    await failJob(admin, jobId, message, 'ingest_failed')
    return json({ error: message }, 500)
  }
})

async function failJob(admin: SupabaseClient, jobId: string, message: string, code: string): Promise<void> {
  await admin.from('sync_jobs').update({
    status: 'failed',
    error_message: message.slice(0, 500),
    error_code: code,
    completed_at: new Date().toISOString(),
  }).eq('id', jobId)
}
