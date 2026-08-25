/**
 * Ingestion d'un transcript déposé manuellement.
 *
 * Flux (aucune clé IA côté client) :
 *  1. upload du fichier dans le bucket privé `tohu-documents` ;
 *  2. pré-création d'une ligne `sync_jobs` (job_type='transcript_analysis',
 *     migration 20260809120000) pour sonder la progression ;
 *  3. invocation de l'edge function `ingest-transcript` (parsing + création
 *     réunion/participants/transcript + analyse comportementale côté serveur).
 * L'UI suit ensuite le job via `fetchTranscriptJob`.
 */
import { getSupabase } from '../lib/supabase'

const TRANSCRIPTS_BUCKET = 'tohu-documents'
export const ACCEPTED_TRANSCRIPT_EXTENSIONS = ['.txt', '.vtt', '.srt'] as const
const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 Mo — un transcript texte reste léger.

export type MatchedParticipant = { contactId: string; name: string }

export type TranscriptResult = {
  meetingId: string
  speakersTotal: number
  participantsMatched: number
  profilesUpdated: number
  matchedParticipants: MatchedParticipant[]
  speakersUnmatched: string[]
}

export type TranscriptJob = {
  id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  currentStep: string | null
  progress: number
  errorMessage: string | null
  result: TranscriptResult | null
}

export type StartTranscriptInput = {
  file: File
  organizationId: string
  userId: string
  title?: string
  meetingDate?: string | null
  consent: boolean
  /** Contact ciblé (fiche d'origine) : les engagements/moments extraits lui sont rattachés. */
  contactId?: string | null
}

function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase()
  return ACCEPTED_TRANSCRIPT_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function safeFileName(name: string): string {
  return name.normalize('NFKD').replace(/[^\w.-]+/g, '-').slice(-80) || 'transcript.txt'
}

/**
 * Upload + pré-création du job + invocation. Retourne le jobId immédiatement ;
 * l'analyse se poursuit côté serveur et se suit via `fetchTranscriptJob`.
 */
export async function startTranscriptIngest(input: StartTranscriptInput): Promise<string> {
  const { file, organizationId, userId, title, meetingDate, consent, contactId } = input
  if (!hasAcceptedExtension(file.name)) {
    throw new Error('Format non supporté — dépose un fichier .txt, .vtt ou .srt.')
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('Fichier trop volumineux (10 Mo max).')
  }
  if (!consent) {
    throw new Error('Confirme le consentement des participants avant d’analyser le transcript.')
  }

  const client = getSupabase()
  const storagePath = `${organizationId}/transcripts/${Date.now()}-${safeFileName(file.name)}`
  const { error: uploadError } = await client.storage.from(TRANSCRIPTS_BUCKET)
    .upload(storagePath, file, { contentType: file.type || 'text/plain', upsert: false })
  if (uploadError) throw new Error(uploadError.message)

  const { data: jobRow, error: jobError } = await client.from('sync_jobs').insert({
    organization_id: organizationId,
    user_id: userId,
    job_type: 'transcript_analysis',
    status: 'queued',
    payload: {
      storage_path: storagePath,
      file_name: file.name,
      title: title?.trim() || null,
      meeting_date: meetingDate || null,
      consent,
      contact_id: contactId || null,
    },
  }).select('id').single()
  if (jobError || !jobRow) throw new Error(jobError?.message ?? 'Job non initialisé.')
  const jobId = String(jobRow.id)

  // On ne bloque pas sur la fin de l'analyse (elle peut durer) : l'UI suit le
  // job. Les erreurs éventuelles sont persistées dans la ligne sync_jobs.
  void client.functions.invoke('ingest-transcript', { body: { jobId } }).catch(() => undefined)
  return jobId
}

export async function fetchTranscriptJob(jobId: string): Promise<TranscriptJob | null> {
  const { data, error } = await getSupabase().from('sync_jobs')
    .select('id,status,current_step,progress,error_message,payload')
    .eq('id', jobId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const payload = (data.payload ?? {}) as Record<string, unknown>
  const rawResult = payload.result as Record<string, unknown> | undefined
  const result: TranscriptResult | null = rawResult ? {
    meetingId: String(rawResult.meeting_id ?? ''),
    speakersTotal: Number(rawResult.speakers_total ?? 0),
    participantsMatched: Number(rawResult.participants_matched ?? 0),
    profilesUpdated: Number(rawResult.profiles_updated ?? 0),
    matchedParticipants: Array.isArray(rawResult.matched_participants)
      ? (rawResult.matched_participants as Array<Record<string, unknown>>).map((p) => ({ contactId: String(p.contact_id ?? ''), name: String(p.name ?? '') })).filter((p) => p.contactId)
      : [],
    speakersUnmatched: Array.isArray(rawResult.speakers_unmatched) ? rawResult.speakers_unmatched.map(String) : [],
  } : null
  return {
    id: String(data.id),
    status: (data.status as TranscriptJob['status']) ?? 'queued',
    currentStep: (data.current_step as string | null) ?? null,
    progress: Number(data.progress ?? 0),
    errorMessage: (data.error_message as string | null) ?? null,
    result,
  }
}
