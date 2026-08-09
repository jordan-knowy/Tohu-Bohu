import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../../person-detail/ui'
import {
  ACCEPTED_TRANSCRIPT_EXTENSIONS,
  fetchTranscriptJob,
  startTranscriptIngest,
  type TranscriptJob,
} from '../../services/transcript-ingest'

const UploadIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V4" /><path d="m7.5 8.5 4.5-4.5 4.5 4.5" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>

const ACCEPT_ATTR = ACCEPTED_TRANSCRIPT_EXTENSIONS.join(',')
const TERMINAL = new Set(['succeeded', 'failed'])

/** Import manuel d'un transcript de réunion : dépose un fichier .txt/.vtt/.srt,
 *  Tohu identifie les intervenants et enrichit le profil comportemental de
 *  chaque personne reconnue. Vit sur la page Connecteurs (hub des sources). */
export default function TranscriptImport({ organizationId, userId }: { organizationId: string; userId: string }) {
  const toast = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [meetingDate, setMeetingDate] = useState('')
  const [consent, setConsent] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [job, setJob] = useState<TranscriptJob | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<number | null>(null)

  const stopPolling = () => { if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null } }
  useEffect(() => stopPolling, [])

  const pickFile = (candidate: File | null | undefined) => {
    if (!candidate) return
    const ok = ACCEPTED_TRANSCRIPT_EXTENSIONS.some((ext) => candidate.name.toLowerCase().endsWith(ext))
    if (!ok) { toast('Format non supporté — dépose un fichier .txt, .vtt ou .srt.', 'error'); return }
    setFile(candidate)
    setJob(null)
  }

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    setDragging(false)
    pickFile(event.dataTransfer.files?.[0])
  }

  const poll = useCallback((jobId: string) => {
    stopPolling()
    pollRef.current = window.setInterval(async () => {
      try {
        const next = await fetchTranscriptJob(jobId)
        if (!next) return
        setJob(next)
        if (TERMINAL.has(next.status)) {
          stopPolling()
          setBusy(false)
          if (next.status === 'succeeded') {
            const n = next.result?.profilesUpdated ?? 0
            toast(`Transcript analysé — ${n} profil(s) enrichi(s).`)
          } else {
            toast(next.errorMessage ?? 'Analyse du transcript impossible.', 'error')
          }
        }
      } catch {
        // Erreur réseau transitoire : le prochain tick réessaie.
      }
    }, 1500)
  }, [toast])

  const submit = async () => {
    if (!file) { toast('Dépose d’abord un fichier transcript.', 'error'); return }
    setBusy(true)
    setJob({ id: '', status: 'queued', currentStep: 'Envoi du fichier…', progress: 2, errorMessage: null, result: null })
    try {
      const jobId = await startTranscriptIngest({ file, organizationId, userId, title, meetingDate: meetingDate || null, consent })
      poll(jobId)
    } catch (reason) {
      setBusy(false)
      setJob(null)
      toast(reason instanceof Error ? reason.message : 'Envoi impossible.', 'error')
    }
  }

  const reset = () => {
    stopPolling()
    setFile(null); setTitle(''); setMeetingDate(''); setConsent(false); setJob(null); setBusy(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  const result = job?.result
  const running = busy || (job != null && !TERMINAL.has(job.status))

  return <section className="transcript-import panel">
    <div className="transcript-import-head">
      <span className="transcript-import-ic">{UploadIcon}</span>
      <div>
        <h3>Importer un transcript de réunion</h3>
        <p>Dépose un compte-rendu (.txt, .vtt, .srt). Tohu identifie les intervenants et enrichit le profil comportemental de chaque personne reconnue — sourcé « Transcription ».</p>
      </div>
    </div>

    {job?.status === 'succeeded' && result
      ? <div className="transcript-result">
          <p className="transcript-result-head">✓ Réunion enregistrée · {result.speakersTotal} intervenant(s) détecté(s) · {result.participantsMatched} reconnu(s) · {result.profilesUpdated} profil(s) enrichi(s).</p>
          {result.matchedParticipants.length > 0 && <div className="transcript-chip-row">
            {result.matchedParticipants.map((p) => <Link key={p.contactId} className="transcript-chip" to={`/app/people/${p.contactId}`}>{p.name}</Link>)}
          </div>}
          {result.speakersUnmatched.length > 0 && <p className="transcript-unmatched">Non rattachés à un contact connu : {result.speakersUnmatched.join(', ')}.</p>}
          <button type="button" className="btn-secondary" onClick={reset}>Importer un autre transcript</button>
        </div>
      : running
        ? <div className="transcript-progress">
            <div className="transcript-progress-bar"><span style={{ width: `${Math.max(2, job?.progress ?? 2)}%` }} /></div>
            <p>{job?.currentStep ?? 'Analyse en cours…'}</p>
          </div>
        : <>
            <div
              className={`transcript-drop${dragging ? ' drag' : ''}${file ? ' has-file' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click() }}
            >
              <input ref={inputRef} type="file" accept={ACCEPT_ATTR} hidden onChange={(event) => pickFile(event.currentTarget.files?.[0])} />
              {UploadIcon}
              <span className="transcript-drop-name">{file ? file.name : 'Glisse un fichier ici, ou clique pour choisir'}</span>
              <span className="transcript-drop-hint">.txt · .vtt · .srt — 10 Mo max</span>
            </div>

            <div className="transcript-fields">
              <label>
                <span>Titre <em>(optionnel)</em></span>
                <input type="text" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex : Point trimestriel — ACME" />
              </label>
              <label>
                <span>Date de la réunion <em>(optionnel)</em></span>
                <input type="date" value={meetingDate} onChange={(event) => setMeetingDate(event.target.value)} />
              </label>
            </div>

            <label className="transcript-consent">
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
              <span>Je confirme disposer du consentement des participants pour analyser ce transcript.</span>
            </label>

            <div className="transcript-actions">
              <button type="button" className="btn-primary" disabled={!file || !consent} onClick={() => void submit()}>Analyser le transcript</button>
              {file && <button type="button" className="btn-secondary" onClick={reset}>Annuler</button>}
            </div>
          </>}
  </section>
}
