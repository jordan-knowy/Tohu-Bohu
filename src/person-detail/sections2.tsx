import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { saveSignalFeedback } from '../app/data'
import { initials } from '../lib/auth'
import {
  addPersonContactDetail, addPersonFile, addPersonNote, addPersonVoiceNote,
  archivePersonContactDetail, setCareerVerification, setPrimaryContactDetail,
  updatePersonContactDetail, validateContactDetail,
} from './service'
import type { PersonContactDetail, PersonDetailData, PersonHistoryEvent } from './types'
import { Csec, Empty, formatDate, formatMonth, provenanceLabel, relativeDate, useBusy, useToast } from './ui'

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

export function MemoryCard({ data, userId, refresh }: SectionProps) {
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

  return <div className="feed-card">
    <div className="feed-head">
      <span className="feed-ic">{PenIcon}</span>
      <div>
        <div className="feed-ttl">Nourrir la mémoire</div>
        <div className="feed-sub">Ajoute une note, un contexte ou un fichier — texte ou vocal. Chaque ajout est persisté et sourcé « note d’équipe ».</div>
      </div>
    </div>
    <form onSubmit={(event) => void saveNote(event)}>
      <label className="sr-only" htmlFor="memory-entry-type">Type d’entrée</label>
      <select id="memory-entry-type" className="pp-select" value={entryType} onChange={(event) => setEntryType(event.target.value)}>
        {ENTRY_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <label className="sr-only" htmlFor="memory-content">Contenu de la note</label>
      <textarea id="memory-content" className="feed-txt" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Ex : préfère les points courts le matin — décision à confirmer par écrit." />
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
    <div className="feed-list">
      {!data.memoryEntries.length
        ? <Empty title="Mémoire en construction">Aucune note d’équipe n’a encore été ajoutée pour cette personne.</Empty>
        : data.memoryEntries.map((entry) => <div className="feed-it" key={entry.id}>
          <span className="feed-it-ic">{entry.entryType === 'file' ? ClipIcon : entry.entryType === 'voice' ? MicIcon : PenIcon}</span>
          <div>
            <div className="feed-it-t">{entry.content}</div>
            <div className="feed-it-m">{ENTRY_TYPES.find(([value]) => value === entry.entryType)?.[1] ?? entry.entryType} · {entry.authorName} · {formatDate(entry.createdAt)}{entry.processingStatus === 'pending_transcription' ? ' · transcription en attente' : ''}{entry.visibility === 'private' ? ' · privée' : ''}</div>
          </div>
        </div>)}
    </div>
  </div>
}

// ─── Historique relationnel ────────────────────────────────────────────────

const EVENT_TYPES: Array<['all' | PersonHistoryEvent['type'], string]> = [['all', 'Tout'], ['meeting', 'Réunions'], ['email', 'Emails'], ['signal', 'Signaux'], ['note', 'Notes'], ['career', 'Parcours']]
const EVENT_TAGS: Record<PersonHistoryEvent['type'], { label: string; tone: string }> = {
  meeting: { label: 'Réunion', tone: 'jalon' }, email: { label: 'Email', tone: 'mouvement' },
  signal: { label: 'Signal', tone: 'bascule' }, note: { label: 'Note', tone: 'jalon' },
  career: { label: 'Parcours', tone: 'mouvement' }, score: { label: 'Score', tone: 'bascule' },
}

export function HistoryCard({ data }: { data: PersonDetailData }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<'all' | PersonHistoryEvent['type']>('all')
  const [limit, setLimit] = useState(12)
  const events = filter === 'all' ? data.history : data.history.filter((event) => event.type === filter)

  const monthly = useMemo(() => {
    const counts = new Map<string, number>()
    for (const event of data.history) {
      if (event.type !== 'meeting' && event.type !== 'email') continue
      const key = event.occurredAt.slice(0, 7)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-16)
  }, [data.history])
  const peak = monthly.reduce<[string, number] | null>((best, item) => best && best[1] >= item[1] ? best : item, null)
  const max = peak?.[1] ?? 1

  const groups: Array<{ year: string; events: PersonHistoryEvent[] }> = []
  for (const event of events.slice(0, limit)) {
    const year = event.occurredAt.slice(0, 4)
    const group = groups.at(-1)
    if (group && group.year === year) group.events.push(event)
    else groups.push({ year, events: [event] })
  }

  return <div className={`feed-card relhist ${open ? '' : 'collapsed'}`} style={{ marginTop: 14 }}>
    <div className="feed-head">
      <span className="feed-ic">{ClockIcon}</span>
      <div>
        <div className="feed-ttl">Historique relationnel</div>
        <div className="feed-sub">Chronologie unifiée — interactions, signaux, notes et parcours, tous sourcés.</div>
      </div>
    </div>
    <div className="rh-synth">
      {monthly.length > 0 && <div className="rh-spark" title="échanges par mois" role="img" aria-label={`Échanges par mois : ${monthly.map(([key, count]) => `${formatMonth(key)} ${count}`).join(', ')}`}>
        {monthly.map(([key, count]) => <i key={key} className={count === max ? 'hi' : count <= max / 4 ? 'lo' : ''} style={{ height: Math.max(4, Math.round(count / max * 44)) }} />)}
      </div>}
      <div className="rh-stats">
        <div className="rh-stat"><div className="v">{data.relationship.firstInteractionAt ? formatDate(data.relationship.firstInteractionAt) : '—'}</div><div className="l">Premier échange</div></div>
        <div className="rh-stat"><div className="v">{data.relationship.totalInteractions || '—'}</div><div className="l">Échanges au total</div></div>
        <div className="rh-stat"><div className="v">{relativeDate(data.relationship.lastInteractionAt).toLowerCase()}</div><div className="l">Dernier contact</div></div>
        {peak && <div className="rh-stat"><div className="v">{peak[1]} / mois</div><div className="l">Pic ({formatMonth(peak[0])})</div></div>}
      </div>
    </div>
    {open && (
      !data.history.length
        ? <Empty title="Aucune interaction détectée">Aucune interaction n’a encore été détectée avec cette personne. Connecte une source ou ajoute une note pour démarrer la mémoire.</Empty>
        : <>
          <div className="krs-pills" role="tablist" aria-label="Filtrer l’historique">
            {EVENT_TYPES.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={`krs-pill ${filter === value ? 'on' : ''}`} onClick={() => { setFilter(value); setLimit(12) }}>{label}</button>)}
          </div>
          <div className="rh-tl" data-gran="mois">
            {groups.map((group) => <div key={group.year}>
              <div className="rh-year">{group.year}</div>
              {group.events.map((event) => <div className="rh-ev detail" data-type={EVENT_TAGS[event.type].tone} key={event.id}>
                <span className="rh-dot" />
                <div className="rh-ev-b">
                  <div className="rh-ev-h">
                    <span className="rh-mo">{formatDate(event.occurredAt)}</span>
                    <span className={`rh-tag ${EVENT_TAGS[event.type].tone}`}>{EVENT_TAGS[event.type].label}</span>
                  </div>
                  <div className="rh-ev-t">{event.title}{event.description ? ` — ${event.description}` : ''}</div>
                  <div className="rh-ev-src">↳ {event.sourceLabel}</div>
                </div>
              </div>)}
            </div>)}
          </div>
          {events.length > limit && <button type="button" className="cv-more" onClick={() => setLimit((value) => value + 12)}>Charger plus ({events.length - limit} restants) ↓</button>}
        </>
    )}
    <button type="button" className="rh-expand" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {open ? 'Réduire l’historique' : 'Déplier l’historique'} <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
    </button>
  </div>
}

// ─── Rail : coordonnées ────────────────────────────────────────────────────

const DETAIL_ICONS: Record<PersonContactDetail['type'], string> = { email: '✉', phone: '📞', linkedin: 'in', website: '🌐', other: '◇' }
const DETAIL_LABELS: Record<PersonContactDetail['type'], string> = { email: 'Email', phone: 'Téléphone', linkedin: 'LinkedIn', website: 'Site', other: 'Autre' }

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
    <div className="rc-h">Coordonnées{data.contactDetails.some((detail) => detail.verificationStatus === 'verified') && <span className="live-badge"><span className="live-dot" />Vérifié</span>}</div>
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
  const shown = showAll ? data.signals : data.signals.slice(0, 5)
  const validate = (signalId: string, verdict: 'confirmed' | 'dismissed') => run(`signal-${signalId}`, async () => {
    await saveSignalFeedback(signalId, userId, verdict)
    toast(verdict === 'confirmed' ? 'Signal confirmé.' : 'Signal infirmé.')
    await refresh()
  })
  return <div className="sig-card">
    <div className="sig-head">
      <div className="sig-ic">{SignalGlyph}</div>
      <div>
        <div className="sig-ttl">Signaux récents</div>
        <div className="sig-sub">{data.person.fullName.split(' ')[0]} · individu · sources connectées</div>
      </div>
    </div>
    <div className="sig-body">
      {!data.signals.length && <Empty title="Aucun signal prioritaire actuellement">Les signaux sourcés apparaîtront après les prochaines synchronisations.</Empty>}
      {shown.map((signal) => <div className="sig-item" key={signal.id}>
        <div className="sig-emoji" style={{ ['--ico' as string]: '#6E50C8', ['--ico-bg' as string]: '#F0EBFB' }}>{SignalGlyph}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sig-it-t">{signal.title}</div>
          {signal.summary && <div className="sig-it-d">{signal.summary}</div>}
          <div className="sig-meta">
            <span className="sig-conf" style={{ background: confidenceColor(signal.provenance.confidence) }} aria-label={signal.provenance.confidence === null ? 'Confiance à confirmer' : `Confiance ${Math.round(signal.provenance.confidence)}%`} />
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
      {data.signals.length > 5 && <button type="button" className="cv-more" onClick={() => setShowAll((value) => !value)}>{showAll ? 'Réduire' : `Voir + (${data.signals.length - 5} de plus)`}</button>}
      <button type="button" className="cv-more" onClick={() => navigate(`/app/signals?personId=${data.person.id}`)}>Voir tous les signaux →</button>
    </div>
  </div>
}
