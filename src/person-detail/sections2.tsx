import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { saveSignalFeedback } from '../services/data'
import { initials } from '../lib/auth'
import {
  addPersonContactDetail, addPersonFile, addPersonNote, addPersonVoiceNote,
  archivePersonContactDetail, setCareerVerification, setPrimaryContactDetail,
  updatePersonContactDetail, validateContactDetail,
} from './service'
import type { PersonContactDetail, PersonDetailData, PersonHistoryEvent } from './types'
import { Csec, Empty, confidenceLevel, formatDate, formatMonth, provenanceLabel, relativeDate, useBusy, useToast } from './ui'

type SectionProps = { data: PersonDetailData; userId: string; refresh: () => Promise<void> }

const TimelineIcon = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6E50C8" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="6" cy="5" r="2.2" /><circle cx="6" cy="13" r="2.2" /><path d="M6 7.2v3.6M9 5h9M9 13h6" /></svg>
const PenIcon = <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#6E50C8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
const ClockIcon = <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
const ClipIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.6 1.6 0 0 1-2.3-2.3L14.6 8" /></svg>
const MicIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="2.5" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18.5V21" /></svg>

// ─── Parcours ──────────────────────────────────────────────────────────────

const CAREER_STATUS: Record<string, string> = { confirmed: 'Confirmé', probable: 'Probable', to_confirm: 'À confirmer', rejected: 'Infirmé' }

export function CareerSection({ data, userId, refresh }: SectionProps) {
  const [busy, run] = useBusy()
  const toast = useToast()
  const [expanded, setExpanded] = useState(false)
  const entries = data.careerEntries.filter((entry) => entry.verificationStatus !== 'rejected')
  const current = entries.filter((entry) => entry.current || entry.entryType === 'detected_change')
  const rest = entries.filter((entry) => !current.includes(entry))
  const validate = (entryId: string, status: 'confirmed' | 'rejected') => run(`career-${entryId}`, async () => {
    await setCareerVerification(data, userId, entryId, status)
    toast(status === 'confirmed' ? 'Entrée confirmée.' : 'Entrée infirmée — historisée.')
    await refresh()
  })
  const linkedInLive = data.sources.some((source) => source.provider === 'linkedin' && source.status === 'connected')
  return <Csec id="sec-cv" icon={TimelineIcon} title="Parcours · CV vivant & veille">
    {!entries.length
      ? <Empty title="Aucun parcours sourcé">Aucune expérience ou formation vérifiable n’est encore rattachée à cette personne. Le parcours se remplira via LinkedIn, les signaux ou une saisie manuelle.</Empty>
      : <>
        {linkedInLive && <div className="cv-head-row"><span className="live-badge"><span className="live-dot" />Live CV · synchronisé LinkedIn</span></div>}
        <div className="cv-tl">
          {(expanded ? entries : current.length ? current : entries.slice(0, 1)).map((entry) => <div className={`cv-item ${entry.current ? 'now' : ''}`} key={entry.id}>
            <div className="cv-mono" style={{ background: entry.current ? '#5B3FA8' : '#E8E3F5', color: entry.current ? '#fff' : '#8A82A8' }}>{initials(entry.organizationName)}</div>
            <div className="cv-body">
              <div className="cv-top">
                <div className="cv-role">{entry.title}</div>
                {entry.current && <span className="cv-live"><span className="live-dot" />actuel</span>}
                <span className={`pp-chip pp-chip-${entry.verificationStatus}`}>{entry.entryType === 'detected_change' ? 'Nouveau poste détecté — à confirmer' : CAREER_STATUS[entry.verificationStatus]}</span>
              </div>
              <div className="cv-org">{entry.organizationName}{entry.entryType === 'education' ? ' · formation' : ''}</div>
              <div className="cv-meta">{[entry.location, [entry.startedAt ? formatDate(entry.startedAt) : null, entry.current ? 'présent' : entry.endedAt ? formatDate(entry.endedAt) : null].filter(Boolean).join(' → ')].filter(Boolean).join(' · ') || 'Période à confirmer'}</div>
              {entry.description && <div className="tl-desc">{entry.description}</div>}
              <div className="rh-ev-src">↳ {provenanceLabel(entry.provenance)}</div>
              {(entry.verificationStatus === 'to_confirm' || entry.verificationStatus === 'probable') && <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button type="button" className="krs-b sm yes" disabled={busy !== null} onClick={() => void validate(entry.id, 'confirmed')}>Confirmer</button>
                <button type="button" className="krs-b sm no" disabled={busy !== null} onClick={() => void validate(entry.id, 'rejected')}>Infirmer</button>
                {entry.accountId && <Link className="krs-b sm" to={`/app/accounts/${entry.accountId}`}>Ouvrir le compte</Link>}
              </div>}
            </div>
          </div>)}
        </div>
        {rest.length > 0 && <button type="button" className="cv-more" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
          {expanded ? 'Réduire le parcours ↑' : `Voir le parcours complet (${entries.length} entrées) ↓`}
        </button>}
      </>}
  </Csec>
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
        {ClipIcon} Fichier
      </label>
      <button type="button" className={`feed-btn ${recording ? 'rec' : ''}`} onClick={() => void toggleVoice()} aria-pressed={recording !== null}>
        {recording ? <><span className="rec-dot" /> Arrêter ({elapsed}s)</> : <>{MicIcon} Note vocale</>}
      </button>
      <span style={{ flex: 1 }} />
      <button className="feed-save" disabled={saving || !content.trim()}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
    </div>
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

    {memory && (moments.length > 0
      ? <div className="km-block">
        <p className="km-l">Les moments qui comptent<span className="km-n">{moments.length}</span></p>
        <div className="km">
          {moments.map((moment) => { const tag = IMPACT_TO_TAG[moment.impact]; return <div key={moment.id} className={`kmi ${tag}`}>
            <span className="kmi-d">{momentDate(moment.occurredAt)}</span>
            <span className="kmi-p" aria-hidden="true" />
            <div className="kmi-c"><p className="kmi-t">{moment.title}</p>{moment.summary && <p className="kmi-s">{moment.summary}</p>}</div>
            <span className="kmi-e">{EVENT_TAG_LABEL[tag]}</span>
          </div> })}
        </div>
      </div>
      : <p className="km-empty">Les moments clés (jalons, frictions, silences) apparaîtront après l’analyse du contenu des échanges.</p>)}

    <button type="button" className="rh-expand" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {open ? 'Réduire les échanges' : 'En savoir + · voir tous les échanges'} <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
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

const DETAIL_ICONS: Record<PersonContactDetail['type'], string> = { email: '✉', phone: '📞', linkedin: 'in', website: '🌐', other: '◇' }
const DETAIL_LABELS: Record<PersonContactDetail['type'], string> = { email: 'Email', phone: 'Téléphone', linkedin: 'LinkedIn', website: 'Site', other: 'Autre' }
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

  return <div className="rail-contact">
    <div className="rc-h"><span className="rc-h-l"><span className="rc-ic">{ContactBookIcon}</span>Coordonnées</span>{data.contactDetails.some((detail) => detail.verificationStatus === 'verified') && <span className="live-badge"><span className="live-dot" />Vérifié</span>}</div>
    {!data.contactDetails.length && <Empty title="Aucune coordonnée vérifiée">Ajoute un email, un téléphone ou un profil pour cette personne.</Empty>}
    {data.contactDetails.map((detail) => <div className="rc-card" key={detail.id}>
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
        <input id="new-detail-value" className="pp-input" placeholder={newType === 'email' ? 'prenom@domaine.fr' : newType === 'phone' ? '+33 …' : 'https://…'} value={newValue} onChange={(event) => setNewValue(event.target.value)} required />
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

const SignalGlyph = <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="18.4" r="1.4" fill="currentColor" stroke="none" /><path d="M8 15a5.5 5.5 0 0 1 8 0" /><path d="M5.2 12a9.5 9.5 0 0 1 13.6 0" /></svg>

function confidenceColor(confidence: number | null): string {
  if (confidence === null) return 'var(--t4)'
  return confidence >= 70 ? 'var(--sage)' : confidence >= 40 ? 'var(--amber)' : 'var(--coral)'
}

export function SignalsCard({ data, userId, refresh }: SectionProps) {
  const [busy, run] = useBusy()
  const toast = useToast()
  const [showAll, setShowAll] = useState(false)
  const navigate = useNavigate()
  // « Mouvements détectés » = signaux externes/veille (changement de poste, actualité,
  // activité récente), PAS les traits comportementaux (posture) qui vivent sur le profil
  // et le CV Live. Retour testing P2.3.
  const movements = data.signals.filter((signal) => /monitoring|veille|^ai[_-]/i.test(signal.provenance.sourceType ?? ''))
  const shown = showAll ? movements : movements.slice(0, 5)
  const validate = (signalId: string, verdict: 'confirmed' | 'dismissed') => run(`signal-${signalId}`, async () => {
    await saveSignalFeedback(signalId, userId, verdict)
    toast(verdict === 'confirmed' ? 'Signal confirmé.' : 'Signal infirmé.')
    await refresh()
  })
  return <div className="sig-card">
    <div className="sig-head">
      <div className="sig-ic">{SignalGlyph}</div>
      <div>
        <div className="sig-ttl">Mouvements détectés</div>
        <div className="sig-sub">{data.person.fullName.split(' ')[0]} · actualité &amp; activité externe</div>
      </div>
    </div>
    <div className="sig-body">
      {!movements.length && <Empty title="Aucun mouvement détecté">Les mouvements externes (changement de poste, actualité, activité récente) apparaîtront après les prochaines synchronisations.</Empty>}
      {shown.map((signal) => <div className="sig-item" key={signal.id}>
        <div className="sig-emoji" style={{ ['--ico' as string]: '#6E50C8', ['--ico-bg' as string]: '#F0EBFB' }}>{SignalGlyph}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sig-it-t">{signal.title}</div>
          {signal.summary && <div className="sig-it-d">{signal.summary}</div>}
          <div className="sig-meta">
            <span className="sig-conf" style={{ background: confidenceColor(signal.provenance.confidence) }} aria-label={confidenceLevel(signal.provenance.confidence) ? `Confiance ${confidenceLevel(signal.provenance.confidence)}` : 'Confiance à confirmer'} />
            <span className="sig-src">{signal.provenance.sourceLabel}</span>
            <span className="sig-date">{formatDate(signal.provenance.observedAt)}</span>
            <span className="sig-tag">{signal.provenance.inferenceLevel ?? 'observé'}</span>
          </div>
          <div className="sigfb" style={{ display: 'flex', gap: 5, marginTop: 7 }}>
            {signal.validationStatus
              ? <span className="sigfb-done">{signal.validationStatus === 'confirmed' ? '✓ Confirmé' : '✕ Infirmé'} par toi</span>
              : <>
                <button type="button" className="krs-b sm yes" disabled={busy !== null} onClick={() => void validate(signal.id, 'confirmed')}>Confirmer</button>
                <button type="button" className="krs-b sm no" disabled={busy !== null} onClick={() => void validate(signal.id, 'dismissed')}>Infirmer</button>
              </>}
          </div>
        </div>
      </div>)}
      {movements.length > 5 && <button type="button" className="cv-more" onClick={() => setShowAll((value) => !value)}>{showAll ? 'Réduire' : `Voir + (${movements.length - 5} de plus)`}</button>}
      <button type="button" className="cv-more" onClick={() => navigate(`/app/signals?personId=${data.person.id}`)}>Voir tous les signaux →</button>
    </div>
  </div>
}
