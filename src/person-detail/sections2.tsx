import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { saveSignalFeedback } from '../services/data'
import { isBehavioralSignal } from '../services/signal-labels'
import { initials } from '../lib/auth'
import {
  addPersonContactDetail, addPersonFile, addPersonNote, addPersonVoiceNote,
  archivePersonContactDetail, clearPersonContactDetail, setCareerVerification, setPersonWatch, setPrimaryContactDetail,
  updatePersonContactDetail, validateContactDetail,
} from './service'
import type { PersonContactDetail, PersonDetailData, PersonHistoryEvent, PersonSignal } from './types'
import { Empty, SectionTitle, formatDate, formatMonth, relativeDate, useBusy, useToast } from './ui'
import { ACCEPTED_TRANSCRIPT_EXTENSIONS, fetchTranscriptJob, startTranscriptIngest } from '../services/transcript-ingest'

const isTranscriptFile = (name: string): boolean =>
  ACCEPTED_TRANSCRIPT_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext))

type SectionProps = { data: PersonDetailData; userId: string; refresh: () => Promise<void> }

const PenIcon = <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#6E50C8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
const ClockIcon = <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
const ClipIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.6 1.6 0 0 1-2.3-2.3L14.6 8" /></svg>
const MicIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="2.5" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18.5V21" /></svg>

// ─── Parcours ──────────────────────────────────────────────────────────────

const CAREER_STATUS: Record<string, string> = { confirmed: 'Confirmé', probable: 'Probable', to_confirm: 'À confirmer', rejected: 'Infirmé' }

function monthYearLabel(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric' }).format(date) : null
}

/** Durée écoulée entre deux dates, au grain le plus lisible (jours / mois / ans) —
 *  jamais une estimation arbitraire, juste un arrondi de calendrier. */
function durationBetween(startIso: string | null, endIso: string | null): string | null {
  if (!startIso) return null
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  const days = Math.floor((end - start) / 86_400_000)
  const months = Math.floor(days / 30.44)
  if (months >= 12) {
    const years = Math.floor(months / 12)
    const restMonths = months % 12
    return `${years} an${years > 1 ? 's' : ''}${restMonths ? ` ${restMonths} mois` : ''}`
  }
  if (months >= 1) {
    const restDays = Math.round(days - months * 30.44)
    return `${months} mois${restDays > 0 ? ` ${restDays} j` : ''}`
  }
  return `${Math.max(1, days)} j`
}

export function CareerSection({ data, userId, refresh }: SectionProps) {
  const [busy, run] = useBusy()
  const toast = useToast()
  const entries = data.careerEntries.filter((entry) => entry.verificationStatus !== 'rejected')
  const experience = entries.filter((entry) => entry.entryType !== 'education')
  const education = entries.filter((entry) => entry.entryType === 'education')
  const validate = (entryId: string, status: 'confirmed' | 'rejected') => run(`career-${entryId}`, async () => {
    await setCareerVerification(data, userId, entryId, status)
    toast(status === 'confirmed' ? 'Entrée confirmée.' : 'Entrée infirmée — historisée.')
    await refresh()
  })
  const linkedInLive = data.sources.some((source) => source.provider === 'linkedin' && source.status === 'connected')
  return <section className="v48-section v48-cv">
    <SectionTitle icon="career" title="Parcours" meta={linkedInLive ? <span className="live-badge"><span className="live-dot" />Live CV · LinkedIn</span> : undefined} />
    {!entries.length
      ? <Empty title="Aucun parcours sourcé">Aucune expérience ou formation vérifiable n’est encore rattachée à cette personne. Le parcours se remplira via LinkedIn, les signaux ou une saisie manuelle.</Empty>
      : <div className="v48-cv-panel">
        {experience.length > 0 && <>
          <p className="v48-cv-label">Expérience</p>
          <div className="v48-cv-list">
            {experience.map((entry) => {
              const dateText = entry.current
                ? (entry.startedAt ? `depuis ${monthYearLabel(entry.startedAt)}` : null)
                : (entry.startedAt ? `${monthYearLabel(entry.startedAt)} – ${entry.endedAt ? monthYearLabel(entry.endedAt) : 'présent'}` : null)
              const duration = durationBetween(entry.startedAt, entry.current ? null : entry.endedAt)
              const tag = `${entry.provenance.sourceLabel ?? 'Source à confirmer'} · ${entry.entryType === 'detected_change' ? 'à confirmer' : (CAREER_STATUS[entry.verificationStatus] ?? 'à confirmer')}`.toUpperCase()
              return <div className={`v48-cv-item ${entry.current ? 'now' : ''}`} key={entry.id}>
                <span className="v48-cv-logo">{initials(entry.organizationName)}</span>
                <div className="v48-cv-content">
                  <div className="v48-cv-top">
                    <strong>{entry.title}{entry.organizationName ? ` – ${entry.organizationName}` : ''}</strong>
                    {entry.current && <span className="v48-live"><i />Live</span>}
                    {entry.entryType === 'detected_change' && <span className="v48-cv-new">Nouveau poste détecté</span>}
                  </div>
                  <p className="v48-cv-meta">{[dateText, duration].filter(Boolean).join(' · ') || 'Période à confirmer'}</p>
                  {entry.description && <p className="v48-cv-desc">{entry.description}</p>}
                  <div className="v48-cv-foot">
                    <span className="v48-cv-tag">{tag}</span>
                    {entry.accountId && <Link className="v48-cv-link" to={`/app/accounts/${entry.accountId}`}>Fiche entreprise →</Link>}
                    {(entry.verificationStatus === 'to_confirm' || entry.verificationStatus === 'probable') && <span className="v48-cv-verify">
                      <button type="button" disabled={busy !== null} onClick={() => void validate(entry.id, 'confirmed')}>Confirmer</button>
                      <button type="button" disabled={busy !== null} onClick={() => void validate(entry.id, 'rejected')}>Infirmer</button>
                    </span>}
                  </div>
                </div>
              </div>
            })}
          </div>
        </>}
        {education.length > 0 && <details className="v48-cv-edu">
          <summary><span className="v48-cv-edu-l">Formation</span><span className="v48-cv-edu-preview">{education.map((entry) => entry.title).join(' · ')}</span><span className="v48-section-count"><b>{education.length}</b></span><i className="v48-cv-edu-chev">⌄</i></summary>
          <div className="v48-cv-list">
            {education.map((entry) => <div className="v48-cv-item" key={entry.id}>
              <span className="v48-cv-logo edu">{initials(entry.organizationName)}</span>
              <div className="v48-cv-content">
                <strong>{entry.title}</strong>
                <p className="v48-cv-meta">{[entry.organizationName, monthYearLabel(entry.startedAt)].filter(Boolean).join(' · ')}</p>
              </div>
            </div>)}
          </div>
        </details>}
      </div>}
  </section>
}

// ─── Mémoire relationnelle ─────────────────────────────────────────────────

const ENTRY_TYPES: Array<[string, string]> = [['note', 'Note'], ['info', 'Information'], ['report', 'Compte rendu'], ['decision', 'Décision'], ['commitment', 'Engagement'], ['preference', 'Préférence'], ['risk', 'Risque']]

export function MemoryCard({ data, userId, refresh, embedded = false }: SectionProps & { embedded?: boolean }) {
  const toast = useToast()
  const [content, setContent] = useState('')
  const [entryType, setEntryType] = useState('note')
  const [saving, setSaving] = useState(false)
  const [recording, setRecording] = useState<{ recorder: MediaRecorder; startedAt: number } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const chunks = useRef<Blob[]>([])
  // Ingestion transcript (retour testing) : un transcript déposé ici doit être
  // réellement analysé (profil + engagements + dates), pas juste stocké.
  const [transcript, setTranscript] = useState<File | null>(null)
  const [transcriptConsent, setTranscriptConsent] = useState(false)
  const [transcriptDate, setTranscriptDate] = useState('')
  const [transcriptStep, setTranscriptStep] = useState<string | null>(null)
  const pollRef = useRef<number | null>(null)
  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current) }, [])

  useEffect(() => {
    if (!recording) return
    const interval = setInterval(() => setElapsed(Math.round((Date.now() - recording.startedAt) / 1000)), 500)
    return () => clearInterval(interval)
  }, [recording])

  const saveNote = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!content.trim()) return
    setSaving(true)
    try {
      await addPersonNote(data, userId, content.trim(), entryType)
      setContent('')
      toast('Ajouté à la mémoire.')
      await refresh()
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Enregistrement impossible', 'error')
    } finally {
      setSaving(false)
    }
  }

  const pickFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    // Un transcript (.txt/.vtt/.srt) n'est pas un simple fichier à archiver : on
    // ouvre le mini-parcours d'analyse (consentement + date) au lieu de le stocker.
    if (isTranscriptFile(file.name)) {
      setTranscript(file)
      setTranscriptConsent(false)
      setTranscriptDate('')
      setTranscriptStep(null)
      return
    }
    setSaving(true)
    try {
      await addPersonFile(data, userId, file)
      toast(`Fichier « ${file.name} » ajouté à la mémoire.`)
      await refresh()
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Téléversement impossible', 'error')
    } finally {
      setSaving(false)
    }
  }

  const runTranscript = async () => {
    if (!transcript || !transcriptConsent) return
    setTranscriptStep('Envoi du fichier…')
    try {
      const jobId = await startTranscriptIngest({
        file: transcript,
        organizationId: data.person.workspaceId,
        userId,
        contactId: data.person.id,
        title: `Transcript — ${data.person.fullName}`,
        meetingDate: transcriptDate || null,
        consent: transcriptConsent,
      })
      if (pollRef.current) window.clearInterval(pollRef.current)
      pollRef.current = window.setInterval(async () => {
        try {
          const job = await fetchTranscriptJob(jobId)
          if (!job) return
          setTranscriptStep(job.currentStep ?? 'Analyse en cours…')
          if (job.status === 'succeeded' || job.status === 'failed') {
            if (pollRef.current) window.clearInterval(pollRef.current)
            pollRef.current = null
            if (job.status === 'succeeded') {
              const updated = job.result?.profilesUpdated ?? 0
              toast(`Transcript analysé — ${updated} profil(s) enrichi(s), engagements et dates mis à jour.`)
              setTranscript(null); setTranscriptConsent(false); setTranscriptDate(''); setTranscriptStep(null)
              await refresh()
            } else {
              toast(job.errorMessage ?? 'Analyse du transcript impossible.', 'error')
              setTranscriptStep(null)
            }
          }
        } catch { /* tick suivant réessaie */ }
      }, 1500)
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Envoi impossible.', 'error')
      setTranscriptStep(null)
    }
  }

  const toggleVoice = async () => {
    if (recording) {
      recording.recorder.stop()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunks.current = []
      const startedAt = Date.now()
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data) }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        setRecording(null)
        const duration = Math.max(1, Math.round((Date.now() - startedAt) / 1000))
        const blob = new Blob(chunks.current, { type: recorder.mimeType || 'audio/webm' })
        setSaving(true)
        addPersonVoiceNote(data, userId, blob, duration)
          .then(async () => { toast(`Note vocale (${duration}s) téléversée — transcription en attente.`); await refresh() })
          .catch((reason) => toast(reason instanceof Error ? reason.message : 'Téléversement impossible', 'error'))
          .finally(() => setSaving(false))
      }
      recorder.start()
      setElapsed(0)
      setRecording({ recorder, startedAt })
    } catch {
      toast('Micro refusé ou indisponible — autorise l’accès pour enregistrer une note vocale.', 'error')
    }
  }

  const form = <form onSubmit={(event) => void saveNote(event)}>
    {!embedded && <>
      <label className="sr-only" htmlFor="memory-entry-type">Type d’entrée</label>
      <select id="memory-entry-type" className="pp-select" value={entryType} onChange={(event) => setEntryType(event.target.value)}>
        {ENTRY_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </>}
    <label className="sr-only" htmlFor="memory-content">Contenu de la note</label>
    <textarea id="memory-content" className="feed-txt" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Ex : préparer le prochain échange, préciser le contexte ou consigner une décision." />
    <div className="feed-actions">
      <label className="feed-btn">
        <input type="file" hidden onChange={(event) => void pickFile(event.currentTarget)} />
        {ClipIcon} Fichier / transcript
      </label>
      <button type="button" className={`feed-btn ${recording ? 'rec' : ''}`} onClick={() => void toggleVoice()} aria-pressed={recording !== null}>
        {recording ? <><span className="rec-dot" /> Arrêter ({elapsed}s)</> : <>{MicIcon} Note vocale</>}
      </button>
      <span style={{ flex: 1 }} />
      <button className="feed-save" disabled={saving || !content.trim()}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
    </div>
    {transcript && <div className="feed-transcript" onClick={(event) => event.stopPropagation()}>
      {transcriptStep
        ? <div className="feed-transcript-run"><span className="spinner" />{transcriptStep}</div>
        : <>
          <div className="feed-transcript-h"><b>Transcript détecté</b> — « {transcript.name} » sera <b>analysé</b> (profil, engagements, dates), pas seulement stocké.</div>
          <label className="feed-transcript-date"><span>Date de la réunion <em>(optionnel)</em></span>
            <input type="date" value={transcriptDate} onChange={(event) => setTranscriptDate(event.target.value)} /></label>
          <label className="feed-transcript-consent"><input type="checkbox" checked={transcriptConsent} onChange={(event) => setTranscriptConsent(event.target.checked)} /><span>Je confirme disposer du consentement des participants pour analyser ce transcript.</span></label>
          <div className="feed-transcript-actions">
            <button type="button" className="feed-save" disabled={!transcriptConsent} onClick={() => void runTranscript()}>Analyser le transcript</button>
            <button type="button" className="feed-btn" onClick={() => setTranscript(null)}>Annuler</button>
          </div>
        </>}
    </div>}
  </form>

  if (embedded) return <div className="relhist-memory">{form}</div>

  return <div className="feed-card">
    <div className="feed-head">
      <span className="feed-ic">{PenIcon}</span>
      <div>
        <div className="feed-ttl">Nourrir la mémoire</div>
        <div className="feed-sub">Ajoute une note, un contexte ou un fichier — texte ou vocal. Chaque ajout est persisté et sourcé « note d’équipe ».</div>
      </div>
    </div>
    {form}
    <div className="feed-list">
      {!data.memoryEntries.length
        ? <Empty title="Mémoire en construction">Aucune note d’équipe n’a encore été ajoutée pour cette personne.</Empty>
        : data.memoryEntries.map((entry) => <div className="feed-it" key={entry.id}>
          <span className="feed-it-ic">{entry.entryType === 'file' ? ClipIcon : entry.entryType === 'voice' ? MicIcon : PenIcon}</span>
          <div>
            <div className="feed-it-t">{entry.content}</div>
            <div className="feed-it-m">{ENTRY_TYPES.find(([value]) => value === entry.entryType)?.[1] ?? entry.entryType} · {entry.sourceType === 'manual' ? entry.authorName : entry.sourceLabel ?? 'Tohu'} · {formatDate(entry.createdAt)}{entry.processingStatus === 'pending_transcription' ? ' · transcription en attente' : ''}{entry.visibility === 'private' ? ' · privée' : ''}</div>
          </div>
        </div>)}
    </div>
  </div>
}

// ─── Historique relationnel ────────────────────────────────────────────────

type EventTag = 'neutre' | 'renforce' | 'friction' | 'silence' | 'jalon'
const EVENT_TAG_LABEL: Record<EventTag, string> = { neutre: 'Neutre', renforce: 'Renforce', friction: 'Friction', silence: 'Silence', jalon: 'Jalon' }
const IMPACT_TO_TAG: Record<'friction' | 'reinforce' | 'milestone' | 'silence', EventTag> = { friction: 'friction', reinforce: 'renforce', milestone: 'jalon', silence: 'silence' }

type RelMomentImpact = 'friction' | 'reinforce' | 'milestone' | 'silence'
type RelMoment = { id: string; occurredAt: string; title: string; summary: string | null; impact: RelMomentImpact }

/** « Les moments qui comptent » : jalons extraits par l'analyse (friction/renforce/jalon)
 *  + silences réellement observés (plus gros trous entre deux échanges). Jamais inventé. */
function buildRelationalMoments(data: PersonDetailData): RelMoment[] {
  const fromKey: RelMoment[] = data.keyMoments.map((moment) => ({ id: moment.id, occurredAt: moment.occurredAt, title: moment.title, summary: moment.summary, impact: moment.impact }))
  const dated = data.history
    .filter((event) => event.type === 'meeting' || event.type === 'email')
    .map((event) => event.occurredAt)
    .sort()
  const silences: Array<RelMoment & { gap: number }> = []
  for (let index = 1; index < dated.length; index++) {
    const gap = Math.round((new Date(dated[index]!).getTime() - new Date(dated[index - 1]!).getTime()) / 86_400_000)
    if (gap >= 30) silences.push({ id: `silence-${dated[index - 1]}`, occurredAt: dated[index - 1]!, title: `${gap} jours sans échange`, summary: 'Aucun échange sur cette période.', impact: 'silence', gap })
  }
  silences.sort((a, b) => b.gap - a.gap)
  const topSilences: RelMoment[] = silences.slice(0, 2).map((item) => ({ id: item.id, occurredAt: item.occurredAt, title: item.title, summary: item.summary, impact: item.impact }))
  return [...fromKey, ...topSilences].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
}

function momentDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

type ClassifiedEvent = { id: string; occurredAt: string; upcoming: boolean; title: string; detail: string; tag: EventTag }

/** Cherche un moment analysé tombant à ±2 jours de la date d'un échange
 *  (les dates extraites ne collent pas toujours au jour exact de l'email). */
function nearbyMoment(momentByDay: Map<string, RelMoment>, iso: string): RelMoment | undefined {
  const base = new Date(iso)
  for (const offset of [0, -1, 1, -2, 2]) {
    const day = new Date(base)
    day.setUTCDate(day.getUTCDate() + offset)
    const moment = momentByDay.get(day.toISOString().slice(0, 10))
    if (moment) return moment
  }
  return undefined
}

/** Chronologie classée : chaque échange reçoit un type relationnel
 *  (renforce/friction/jalon/silence/neutre), enrichi par un moment analysé proche. */
function classifyTimeline(data: PersonDetailData, moments: RelMoment[]): ClassifiedEvent[] {
  const now = Date.now()
  const momentByDay = new Map<string, RelMoment>()
  for (const moment of moments) momentByDay.set(moment.occurredAt.slice(0, 10), moment)
  const used = new Set<string>()
  const rows: ClassifiedEvent[] = data.history.map((event) => {
    const moment = nearbyMoment(momentByDay, event.occurredAt)
    let tag: EventTag = event.type === 'career' ? 'jalon' : 'neutre'
    if (moment) { tag = IMPACT_TO_TAG[moment.impact]; used.add(moment.id) }
    return {
      id: event.id,
      occurredAt: event.occurredAt,
      upcoming: new Date(event.occurredAt).getTime() > now,
      title: event.title,
      detail: [event.description, event.sourceLabel].filter(Boolean).join(' · '),
      tag,
    }
  })
  for (const moment of moments) {
    if (used.has(moment.id)) continue
    rows.push({ id: moment.id, occurredAt: moment.occurredAt, upcoming: false, title: moment.title, detail: moment.summary ?? '', tag: IMPACT_TO_TAG[moment.impact] })
  }
  return rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
}

export function HistoryCard({ data, memory }: { data: PersonDetailData; memory?: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<'all' | EventTag>('all')
  const [limit, setLimit] = useState(12)
  // Écarter un moment qui compte : pas de colonne d'archivage côté person_key_moments
  // aujourd'hui, donc affichage seulement (revient au reload). À faire persister le
  // jour où le besoin de le garder masqué durablement se confirme.
  const [dismissedMomentIds, setDismissedMomentIds] = useState<Set<string>>(new Set())

  const monthly = useMemo(() => {
    const counts = new Map<string, number>()
    for (const event of data.history) {
      if (event.type !== 'meeting' && event.type !== 'email') continue
      const key = event.occurredAt.slice(0, 7)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-16)
  }, [data.history])
  const max = monthly.reduce((best, [, count]) => Math.max(best, count), 1)
  const commitmentCount = data.memoryEntries.filter((entry) => entry.entryType === 'commitment').length
  const moments = useMemo(() => buildRelationalMoments(data), [data])
  const visibleMoments = moments.filter((moment) => !dismissedMomentIds.has(moment.id))
  const classified = useMemo(() => classifyTimeline(data, moments), [data, moments])
  const filtered = filter === 'all' ? classified : classified.filter((event) => event.tag === filter)
  const firstMonth = data.relationship.firstInteractionAt ? formatMonth(data.relationship.firstInteractionAt.slice(0, 7)) : '—'

  return <div className={`feed-card relhist ${open ? '' : 'collapsed'}`} style={{ marginTop: 14 }}>
    <div className="feed-head">
      <span className="feed-ic">{ClockIcon}</span>
      <div>
        <div className="feed-ttl">{memory ? 'Historique & mémoire relationnelle' : 'Historique relationnel'}</div>
        {!memory && <div className="feed-sub">Chronologie unifiée — interactions, signaux, notes et parcours, tous sourcés.</div>}
      </div>
      {memory && <span className={`memc ${commitmentCount ? 'on' : ''}`}>{commitmentCount} engagement{commitmentCount > 1 ? 's' : ''} en mémoire</span>}
    </div>
    {memory && data.person.primaryOwnerName && <div className="rl">
      <p className="rl-l">Qui a porté la relation</p>
      <div className="rl-t"><div className="rl-s cur">
        <span className="rl-a">{initials(data.person.primaryOwnerName)}</span>
        <div className="rl-c"><p className="rl-n">{data.person.primaryOwnerName}<i className="rl-d" /></p><p className="rl-p">{data.relationship.firstInteractionAt ? `depuis le ${formatDate(data.relationship.firstInteractionAt)}` : 'porteur actuel'}</p></div>
      </div></div>
      <span className="rl-k">1 porteur</span>
    </div>}
    <div className="hm-s">
      {monthly.length > 0 && <span className="hm-sp" role="img" aria-label={`Échanges par mois : ${monthly.map(([key, count]) => `${formatMonth(key)} ${count}`).join(', ')}`}>
        {monthly.map(([key, count]) => <i key={key} style={{ height: Math.max(5, Math.round(count / max * 44)), background: count === max ? 'var(--violet)' : count <= max / 4 ? '#EBE7F6' : '#C9BEEC' }} />)}
      </span>}
      <div className="hm-k"><p className="hm-kv">{firstMonth}</p><p className="hm-kl">Premier échange</p></div>
      <div className="hm-k"><p className="hm-kv">{data.relationship.totalInteractions || '—'}</p><p className="hm-kl">Échanges au total</p></div>
      <div className="hm-k"><p className="hm-kv">{firstMonth}</p><p className="hm-kl">Début collaboration</p></div>
    </div>

    {memory && (visibleMoments.length > 0
      ? <div className="km-block">
        <p className="km-l">Les moments qui comptent<span className="km-n">{visibleMoments.length}</span></p>
        <div className="km">
          {visibleMoments.map((moment) => { const tag = IMPACT_TO_TAG[moment.impact]; return <div key={moment.id} className={`kmi ${tag}`}>
            <button type="button" className="kmi-x" title="Écarter ce moment" aria-label="Écarter ce moment de l’historique" onClick={() => setDismissedMomentIds((ids) => new Set(ids).add(moment.id))}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <span className="kmi-d">{momentDate(moment.occurredAt)}</span>
            <span className="kmi-p" aria-hidden="true" />
            <div className="kmi-c"><p className="kmi-t">{moment.title}</p>{moment.summary && <p className="kmi-s">{moment.summary}</p>}</div>
            <span className="kmi-e">{EVENT_TAG_LABEL[tag]}</span>
          </div> })}
        </div>
      </div>
      : <p className="km-empty">Les moments clés (jalons, frictions, silences) apparaîtront après l’analyse du contenu des échanges.</p>)}

    <button type="button" className="rh-expand" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {open ? 'Réduire' : 'En savoir +'} <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
    </button>

    {open && (classified.length === 0
      ? <Empty title="Aucune interaction détectée">Aucune interaction n’a encore été détectée avec cette personne. Connecte une source ou ajoute une note pour démarrer la mémoire.</Empty>
      : <>
        <div className="hm-flt" role="tablist" aria-label="Filtrer les échanges par type">
          <button type="button" role="tab" aria-selected={filter === 'all'} className={`krs-pill ${filter === 'all' ? 'on' : ''}`} onClick={() => { setFilter('all'); setLimit(12) }}>Tout</button>
          {(['renforce', 'friction'] as EventTag[]).map((tag) => <button key={tag} type="button" role="tab" aria-selected={filter === tag} className={`krs-pill ${filter === tag ? 'on' : ''}`} onClick={() => { setFilter(tag); setLimit(12) }}>{EVENT_TAG_LABEL[tag]}</button>)}
        </div>
        <div className="km hm-tl">
          {filtered.slice(0, limit).map((event) => <div key={event.id} className={`kmi ${event.tag}`}>
            <span className="kmi-d">{event.upcoming ? 'à venir' : momentDate(event.occurredAt)}</span>
            <span className="kmi-p" aria-hidden="true" />
            <div className="kmi-c"><p className="kmi-t">{event.title}</p>{event.detail && <p className="kmi-s">{event.detail}</p>}</div>
            <span className="kmi-e">{EVENT_TAG_LABEL[event.tag]}</span>
          </div>)}
        </div>
        {filtered.length > limit && <button type="button" className="cv-more" onClick={() => setLimit((value) => value + 12)}>Charger plus ({filtered.length - limit} restants) ↓</button>}
      </>)}

    {memory && <div className="hm-note">{memory}</div>}
  </div>
}

// ─── Rail : coordonnées ────────────────────────────────────────────────────

const DETAIL_ICONS: Record<PersonContactDetail['type'], React.ReactNode> = {
  email: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M4 7l8 6 8-6" /></svg>,
  phone: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M5 4h3.5l1.5 4-2 1.4a10 10 0 0 0 4.6 4.6L18 16l4 1.5V21a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2z" /></svg>,
  linkedin: 'in',
  website: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" /></svg>,
  location: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s6.4-5.8 6.4-10.2a6.4 6.4 0 1 0-12.8 0C5.6 15.2 12 21 12 21z" /><circle cx="12" cy="10.6" r="2.3" /></svg>,
  other: '◇',
}
const DETAIL_LABELS: Record<PersonContactDetail['type'], string> = { email: 'Email', phone: 'Téléphone', linkedin: 'LinkedIn', website: 'Site', location: 'Localisation', other: 'Autre' }
const ContactBookIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.2" /><circle cx="9" cy="11" r="2" /><path d="M6 16a3 3 0 0 1 6 0" /><path d="M15 10.5h3M15 14h3" /></svg>

export function ContactsCard({ data, userId, refresh }: SectionProps) {
  const toast = useToast()
  const [busy, run] = useBusy()
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [adding, setAdding] = useState(false)
  const [newType, setNewType] = useState<PersonContactDetail['type']>('email')
  const [newValue, setNewValue] = useState('')
  const [newLabel, setNewLabel] = useState('')

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast('Copié dans le presse-papiers.')
    } catch {
      toast('Copie impossible dans ce navigateur.', 'error')
    }
  }

  const startEdit = (detail: PersonContactDetail) => { setEditing(detail.id); setEditValue(detail.value) }

  const saveEdit = (detail: PersonContactDetail) => run(`edit-${detail.id}`, async () => {
    if (!editValue.trim()) {
      // Champ vidé volontairement : on efface la coordonnée (ex. fausse donnée
      // d'un homonyme) au lieu d'exiger une valeur de remplacement.
      await clearPersonContactDetail(data, userId, detail)
      setEditing(null)
      toast('Coordonnée effacée.')
      await refresh()
      return
    }
    const invalid = validateContactDetail(detail.type, editValue)
    if (invalid) { toast(invalid, 'error'); return }
    if (detail.id.startsWith('legacy-')) {
      // Coordonnée héritée de la base contacts : la correction crée une vraie ligne persistée.
      await addPersonContactDetail(data, userId, { type: detail.type, value: editValue })
    } else {
      await updatePersonContactDetail(data, userId, detail, editValue)
    }
    setEditing(null)
    toast('Coordonnée enregistrée — ancienne valeur historisée.')
    await refresh()
  })

  const add = (event: React.FormEvent) => {
    event.preventDefault()
    void run('add-detail', async () => {
      await addPersonContactDetail(data, userId, { type: newType, value: newValue, label: newLabel.trim() || null })
      setNewValue(''); setNewLabel(''); setAdding(false)
      toast('Coordonnée ajoutée.')
      await refresh()
    })
  }

  // Une coordonnée effacée (valeur vide, ex. fausse donnée d'un homonyme) reste
  // en base pour supprimer la valeur héritée fausse, mais ne s'affiche jamais.
  const visibleDetails = data.contactDetails.filter((detail) => detail.value.trim() !== '')
  return <div className="rail-contact">
    <div className="rc-h"><span className="rc-h-l"><span className="rc-ic">{ContactBookIcon}</span>Coordonnées</span>{data.contactDetails.some((detail) => detail.verificationStatus === 'verified') && <span className="live-badge"><span className="live-dot" />Vérifié</span>}</div>
    {!visibleDetails.length && <Empty title="Aucune coordonnée vérifiée">Ajoute un email, un téléphone ou un profil pour cette personne.</Empty>}
    {visibleDetails.map((detail) => <div className="rc-card" key={detail.id}>
      <div className="contact-ic" aria-hidden="true">{DETAIL_ICONS[detail.type]}</div>
      <div className="contact-main">
        <div className="contact-lbl">{detail.label ?? DETAIL_LABELS[detail.type]}{detail.primary ? ' · principale' : ''}{detail.visibility === 'private' ? ' · privée' : ''}</div>
        {editing === detail.id
          ? <form onSubmit={(event) => { event.preventDefault(); void saveEdit(detail) }} style={{ display: 'flex', gap: 5 }}>
            <label className="sr-only" htmlFor={`edit-${detail.id}`}>Nouvelle valeur</label>
            <input id={`edit-${detail.id}`} className="pp-input" value={editValue} onChange={(event) => setEditValue(event.target.value)} autoFocus />
            <button className="contact-copy" disabled={busy !== null}>OK</button>
            <button type="button" className="contact-copy" onClick={() => setEditing(null)}>✕</button>
          </form>
          : <div className="contact-val" style={{ fontSize: 11.5 }}>{detail.value}</div>}
        <div className="pp-detail-meta">{detail.verificationStatus === 'verified' ? '✓ vérifiée' : detail.verificationStatus === 'invalid' ? '⚠ invalide' : 'non vérifiée'}{detail.provenance ? ` · ${detail.provenance.sourceLabel}` : ''}</div>
      </div>
      {editing !== detail.id && <div className="pp-detail-actions">
        <button type="button" className="contact-copy" onClick={() => void copy(detail.value)}>Copier</button>
        <button type="button" className="contact-copy" onClick={() => startEdit(detail)}>Modifier</button>
        {!detail.id.startsWith('legacy-') && !detail.primary && <button type="button" className="contact-copy" disabled={busy !== null} onClick={() => void run(`primary-${detail.id}`, async () => { await setPrimaryContactDetail(data, userId, detail); toast('Définie comme principale.'); await refresh() })}>★</button>}
        {!detail.id.startsWith('legacy-') && <button type="button" className="contact-copy" disabled={busy !== null} onClick={() => void run(`archive-${detail.id}`, async () => { await archivePersonContactDetail(data, userId, detail.id); toast('Coordonnée archivée.'); await refresh() })}>Archiver</button>}
      </div>}
    </div>)}
    {adding
      ? <form className="pp-add-form" onSubmit={add}>
        <label className="sr-only" htmlFor="new-detail-type">Type</label>
        <select id="new-detail-type" className="pp-select" value={newType} onChange={(event) => setNewType(event.target.value as PersonContactDetail['type'])}>
          {Object.entries(DETAIL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label className="sr-only" htmlFor="new-detail-value">Valeur</label>
        <input id="new-detail-value" className="pp-input" placeholder={newType === 'email' ? 'prenom@domaine.fr' : newType === 'phone' ? '+33 …' : newType === 'location' ? 'Ville, Pays' : 'https://…'} value={newValue} onChange={(event) => setNewValue(event.target.value)} required />
        <label className="sr-only" htmlFor="new-detail-label">Libellé (optionnel)</label>
        <input id="new-detail-label" className="pp-input" placeholder="Libellé (optionnel)" value={newLabel} onChange={(event) => setNewLabel(event.target.value)} />
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="feed-save" disabled={busy !== null}>Ajouter</button>
          <button type="button" className="feed-btn" onClick={() => setAdding(false)}>Annuler</button>
        </div>
      </form>
      : <button type="button" className="feed-btn" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={() => setAdding(true)}>+ Ajouter une coordonnée</button>}
  </div>
}

// ─── Rail : signaux récents ────────────────────────────────────────────────

// Catégorie d'un signal → tag + tonalité (couleur du liseré), dérivée du type réel —
// même logique que côté Compte (V48AccountViews.signalCategory), adaptée : PersonSignal
// n'a pas de champ impact, on lit seulement type/sourceType.
function signalCategory(signal: PersonSignal): { tag: string; tone: 'friction' | 'positive' | 'external' | 'internal' | 'context' } {
  const hay = `${signal.type} ${signal.provenance.sourceType ?? ''}`.toLowerCase()
  if (/friction|risk|risque|churn|silence|retard|perdu|tension|deadline|échéance|impayé|litige/.test(hay)) return { tag: 'Friction', tone: 'friction' }
  if (/opportun|reprise|growth|win|renforce|levée|funding|expansion|signature/.test(hay)) return { tag: 'Opportunité', tone: 'positive' }
  if (/pappers|rcs|registre|news|press|monitoring|veille|mobility|job|externe|linkedin|nomination|gouvernance/.test(hay)) return { tag: 'Externe', tone: 'external' }
  if (isBehavioralSignal(signal.type)) return { tag: 'Interne', tone: 'internal' }
  return { tag: 'Contexte', tone: 'context' }
}

// Action contextuelle : n'apparaît que si une vraie URL source existe.
function signalAction(signal: PersonSignal): { label: string; url: string } | null {
  const url = signal.provenance.sourceUrl
  if (!url) return null
  const label = signal.provenance.sourceLabel ?? ''
  if (/pappers|rcs/i.test(label)) return { label: 'Ouvrir la fiche Pappers →', url }
  if (/outlook|gmail|mail|email/i.test(label)) return { label: 'Ouvrir le mail →', url }
  return { label: 'Ouvrir la source →', url }
}

export function SignalsCard({ data, userId, refresh }: SectionProps) {
  const [busy, run] = useBusy()
  const toast = useToast()
  const [expanded, setExpanded] = useState(false)
  const toggleWatch = () => void run('watch', async () => {
    await setPersonWatch(data, userId, !data.person.watchEnabled)
    toast(data.person.watchEnabled ? 'Veille désactivée.' : 'Veille activée — signaux internes & externes.')
    await refresh()
  })
  const validate = (signalId: string, verdict: 'confirmed' | 'dismissed') => run(`signal-${signalId}`, async () => {
    await saveSignalFeedback(signalId, userId, verdict)
    await refresh()
  })
  const lastSync = data.sources.map((source) => source.lastSyncedAt).filter((value): value is string => value !== null).sort().pop() ?? null
  const sourcesLabel = data.sources.filter((source) => source.status === 'connected').map((source) => source.label).join(' + ') || 'sources à confirmer'
  const shown = expanded ? data.signals : data.signals.slice(0, 4)
  const rest = data.signals.length - shown.length
  return <section className="v48-section v48-signals">
    <SectionTitle icon="signal" title="Signaux récents" meta={<>
      <span className="v48-section-count"><b>{data.signals.length}</b></span>
      <button type="button" className={`ktog ${data.person.watchEnabled ? 'on' : ''}`} disabled={busy !== null} aria-pressed={data.person.watchEnabled} onClick={toggleWatch}>
        <span className="ktog-lbl">Veille</span>
        <span className="ktog-sw" aria-hidden="true" />
      </button>
    </>} />
    <p className="v48-signals-scope">{data.person.fullName.split(' ')[0]} · individu · {sourcesLabel}</p>
    {data.person.watchEnabled
      ? <div className="v48-signals-sync"><i />Dernière synchronisation : <b>{lastSync ? relativeDate(lastSync).toLowerCase() : 'à confirmer'}</b></div>
      : <div className="v48-signals-sync off"><i />Veille coupée — aucun nouveau signal ne sera collecté.</div>}
    <div className="v48-sig-list">
      {shown.map((signal) => {
        const cat = signalCategory(signal)
        const action = signalAction(signal)
        return <article className={`v48-sig tone-${cat.tone}`} key={signal.id}>
          <div className="v48-sig-rail"><span className="v48-sig-when">{relativeDate(signal.provenance.observedAt).toLowerCase()}</span><i className="v48-sig-dot" /></div>
          <div className="v48-sig-body">
            <div className="v48-sig-head"><h3>{signal.title}</h3><span className="v48-sig-cat">{cat.tag}</span></div>
            <p>{signal.summary || 'Détail en cours de consolidation.'}</p>
            <div className="v48-sig-foot">
              {signal.provenance.sourceLabel && <span className="v48-sig-chan"><i />{signal.provenance.sourceLabel}</span>}
              {action && <a className="v48-sig-open" href={action.url} target="_blank" rel="noreferrer">{action.label}</a>}
              <span className="v48-sig-acts">
                <button className={signal.validationStatus === 'confirmed' ? 'on' : ''} disabled={busy !== null} onClick={() => void validate(signal.id, 'confirmed')} title="Confirmer">✓</button>
                <button className={signal.validationStatus === 'dismissed' ? 'on no' : 'no'} disabled={busy !== null} onClick={() => void validate(signal.id, 'dismissed')} title="Infirmer">×</button>
              </span>
            </div>
          </div>
        </article>
      })}
      {!data.signals.length && <Empty title="Aucun signal détecté">Les signaux internes et externes apparaîtront après les prochaines synchronisations.</Empty>}
    </div>
    {rest > 0 && <button type="button" className="v48-more" onClick={() => setExpanded(true)}>Voir {rest} signal{rest > 1 ? 'aux' : ''} de plus ▾</button>}
    {expanded && data.signals.length > 4 && <button type="button" className="v48-more" onClick={() => setExpanded(false)}>Réduire ▴</button>}
  </section>
}
