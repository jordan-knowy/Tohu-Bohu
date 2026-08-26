import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useParams } from 'react-router-dom'
import { initials } from '../lib/auth'
import { ContactAvatar } from '../components/ContactAvatar'
import { addPersonContactDetail, fetchWorkspaceMembers, getPersonDetail, handoverPerson, renamePerson, setPersonFavorite, setPersonOwner, setPersonRoles, setPersonVisibility, setPersonWatch, triggerPersonCognitiveSync, triggerPersonEnrichment, validateContactDetail, type WorkspaceMember } from './service'
import { V48PersonLiveView, V48PersonProfileView, V48PersonRelationView, V48PersonSourceNote } from './V48PersonViews'
import { DECISION_ROLES, RELATIONSHIP_TYPES, type PersonContactDetail, type PersonDetailData } from './types'
import { FicheSkeleton } from '../components/FicheSkeleton'
import { ToastProvider, confidenceLevel, formatDate, phaseLabel, provenanceLabel, relativeDate, useBusy, useToast } from './ui'

type PageContext = { workspaceId: string; userId: string }
type PersonDetailTab = 'profile' | 'relation' | 'live'

const RELATION_COLORS: Record<string, string> = {
  Prospect: '#2896A8', Client: '#2EA86A', Partenaire: '#6E50C8', 'Fournisseur / Prestataire': '#C97A20',
  Investisseur: '#D94F63', 'Collègue': '#3D6FCC', Interne: '#8B83A8', 'Réseau': '#3C3489',
}
const RELATION_VERBS: Record<string, string> = {
  Prospect: 'convertir', Client: 'fidéliser', Partenaire: 'capitaliser', 'Fournisseur / Prestataire': 'entretenir',
  Investisseur: 'rassurer', 'Collègue': 'coordonner', Interne: 'aligner', 'Réseau': 'cultiver',
}
const ROLE_POWER: Record<string, string> = {
  Initiateur: 'faible pouvoir', Utilisateur: 'faible pouvoir', Influenceur: 'moyen pouvoir',
  Filtre: 'moyen pouvoir', 'Décideur': 'fort pouvoir', Acheteur: 'fort pouvoir',
}

function ChipMenu({ label, value, color, options, onSelect, icon }: {
  label: string; value: string | null; color?: string; icon?: React.ReactNode
  options: Array<{ value: string; hint: string; color?: string }>
  onSelect: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const rootRef = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('click', close)
    window.addEventListener('scroll', () => setOpen(false), { capture: true, once: true })
    return () => document.removeEventListener('click', close)
  }, [open])
  const toggle = () => {
    if (!open && rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 6, left: rect.left })
    }
    setOpen((current) => !current)
  }
  return <span ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
    <button type="button" className="rel-chip" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
      <span className="rel-k">{label}</span>
      {color && <span className="rel-dot" style={{ background: color }} />}
      {icon}
      <span className="rel-v">{value ?? 'À qualifier'}</span>
      <span className="rel-c" aria-hidden="true">▾</span>
    </button>
    {open && menuPos && createPortal(
      <div ref={menuRef} className="rel-menu" role="menu" style={{ display: 'block', top: menuPos.top, left: menuPos.left }}>
        {options.map((option) => <button type="button" role="menuitem" key={option.value} onClick={() => { setOpen(false); onSelect(option.value) }}>
          {option.color && <span className="rel-dot" style={{ background: option.color }} />}
          {option.value}<span className="rm-def">{option.hint}</span>
        </button>)}
      </div>,
      document.body,
    )}
  </span>
}

/** Affectation de la fiche : owner (assigné depuis les membres du workspace) +
 *  visibilité organisation / restreinte. Persisté dans person_settings. */
function OwnerAffectation({ data, userId, refresh }: { data: PersonDetailData; userId: string; refresh: () => Promise<void> }) {
  const toast = useToast()
  const [busy, run] = useBusy()
  const person = data.person
  const [ownerOpen, setOwnerOpen] = useState(false)
  const [visOpen, setVisOpen] = useState(false)
  const [passationOpen, setPassationOpen] = useState(false)
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) { setOwnerOpen(false); setVisOpen(false) } }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  const openOwner = () => {
    setOwnerOpen((value) => !value); setVisOpen(false)
    if (members === null) void fetchWorkspaceMembers(person.workspaceId).then(setMembers).catch(() => setMembers([]))
  }
  const chooseOwner = (ownerUserId: string | null, name: string) => void run('owner', async () => {
    await setPersonOwner(data, userId, ownerUserId)
    setOwnerOpen(false)
    toast(ownerUserId ? `Fiche affectée à ${name}.` : 'Owner retiré.')
    await refresh()
  })
  const chooseVisibility = (visibility: 'workspace' | 'restricted') => void run('vis', async () => {
    await setPersonVisibility(data, userId, visibility)
    setVisOpen(false)
    toast(visibility === 'workspace' ? 'Visible par toute l’organisation.' : 'Visibilité restreinte à l’équipe.')
    await refresh()
  })

  return <div className="v48-owner-card v48-affect" ref={rootRef}>
    <span className="v48-owner-avatar">{initials(person.primaryOwnerName ?? 'À confirmer')}</span>
    <div className="v48-affect-body">
      <span className="v48-owner-l">Owner de la fiche</span>
      <strong>{person.primaryOwnerName ?? 'Non affecté'}</strong>
      <div className="v48-affect-actions">
        <span className="v48-affect-menu">
          <button type="button" className="v48-affect-link" aria-haspopup="menu" aria-expanded={ownerOpen} disabled={busy !== null} onClick={openOwner}>Changer l’owner</button>
          {ownerOpen && <div className="v48-affect-pop" role="menu">
            {members === null
              ? <div className="v48-affect-loading">Chargement…</div>
              : members.length === 0
                ? <div className="v48-affect-loading">Aucun membre trouvé.</div>
                : <>
                  {members.map((member) => <button key={member.id} type="button" role="menuitemradio" aria-checked={member.id === person.primaryOwnerUserId} className={member.id === person.primaryOwnerUserId ? 'on' : ''} onClick={() => chooseOwner(member.id, member.fullName)}>
                    <span className="v48-affect-ini">{initials(member.fullName)}</span>{member.fullName}
                  </button>)}
                  {person.primaryOwnerUserId && <button type="button" className="v48-affect-clear" onClick={() => chooseOwner(null, '')}>Retirer l’owner</button>}
                </>}
          </div>}
        </span>
        <span className="v48-affect-menu">
          <button type="button" className={`v48-affect-vis vis-${person.visibility}`} aria-haspopup="menu" aria-expanded={visOpen} disabled={busy !== null} onClick={() => { setVisOpen((value) => !value); setOwnerOpen(false) }}>
            {person.visibility === 'restricted' ? 'Restreint' : 'Organisation'} <span aria-hidden="true">▾</span>
          </button>
          {visOpen && <div className="v48-affect-pop wide" role="menu">
            <button type="button" role="menuitemradio" aria-checked={person.visibility === 'workspace'} className={`vo ${person.visibility === 'workspace' ? 'on' : ''}`} onClick={() => chooseVisibility('workspace')}>
              <div className="vo-t">Organisation</div><div className="vo-d">Visible par tous — nourrit le cerveau collectif.</div>
            </button>
            <button type="button" role="menuitemradio" aria-checked={person.visibility === 'restricted'} className={`vo ${person.visibility === 'restricted' ? 'on' : ''}`} onClick={() => chooseVisibility('restricted')}>
              <div className="vo-t">Restreint</div><div className="vo-d">Détail relationnel visible par l’équipe restreinte.</div>
            </button>
          </div>}
        </span>
        <button type="button" className="v48-affect-link v48-affect-handover" disabled={busy !== null} onClick={() => setPassationOpen(true)}>Passer la relation</button>
      </div>
    </div>
    {passationOpen && <PassationModal data={data} userId={userId} refresh={refresh} onClose={() => setPassationOpen(false)} />}
  </div>
}

/** Passation par fiche : nouveau responsable + note de contexte, puis refresh. */
function PassationModal({ data, userId, refresh, onClose }: { data: PersonDetailData; userId: string; refresh: () => Promise<void>; onClose: () => void }) {
  const toast = useToast()
  const person = data.person
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null)
  const [toUserId, setToUserId] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { void fetchWorkspaceMembers(person.workspaceId).then(setMembers).catch(() => setMembers([])) }, [person.workspaceId])
  const candidates = (members ?? []).filter((member) => member.id !== person.primaryOwnerUserId)
  const submit = async () => {
    const target = candidates.find((member) => member.id === toUserId)
    if (!target) return
    setSaving(true)
    try {
      await handoverPerson(data, userId, target.id, target.fullName, note)
      toast(`Relation passée à ${target.fullName}.`)
      onClose()
      await refresh()
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Passation impossible.', 'error')
    } finally { setSaving(false) }
  }
  return createPortal(
    <div className="v48-shm" onClick={onClose}>
      <div className="v48-shp" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <div className="v48-shp-h"><p className="v48-shp-t">Passer la relation</p><button type="button" className="v48-shp-x" onClick={onClose}>×</button></div>
        <p className="v48-shp-i">Transfère la responsabilité de <b>{person.fullName}</b> à un membre de l’équipe. La passation est datée et consignée dans la mémoire relationnelle.</p>
        <p className="v48-shp-l">Nouveau responsable</p>
        {members === null
          ? <div className="v48-affect-loading">Chargement…</div>
          : <select className="pp-select" value={toUserId} onChange={(event) => setToUserId(event.target.value)} style={{ width: '100%' }}>
              <option value="" disabled>Choisir un membre…</option>
              {candidates.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}
            </select>}
        <p className="v48-shp-l" style={{ marginTop: 12 }}>Note de passation <em style={{ textTransform: 'none', letterSpacing: 0 }}>(optionnel)</em></p>
        <textarea className="feed-txt" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ex : dossier en cours sur le devis, Christèle est le bon relai." style={{ width: '100%', minHeight: 70 }} />
        <div className="v48-shp-actions">
          <button type="button" className="feed-btn" onClick={onClose}>Annuler</button>
          <button type="button" className="feed-save" disabled={saving || !toUserId} onClick={() => void submit()}>{saving ? 'Passation…' : 'Confirmer la passation'}</button>
        </div>
      </div>
    </div>, document.body)
}

function Hero({ data, userId, refresh }: { data: PersonDetailData; userId: string; refresh: () => Promise<void> }) {
  const toast = useToast()
  const [busy, run] = useBusy()
  const person = data.person
  const relation = data.relationship
  const confLevel = confidenceLevel(relation.confidence)
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const startEditName = () => { setNameValue(person.fullName); setEditingName(true) }
  const saveName = (event: React.FormEvent) => {
    event.preventDefault()
    void run('rename', async () => {
      await renamePerson(data, nameValue)
      setEditingName(false)
      toast('Nom mis à jour — les prochaines recherches d’enrichissement repartiront de ce nom.')
      await refresh()
    })
  }
  const setRelation = (value: string) => void run('relation', async () => {
    await setPersonRoles(data, userId, { relationshipType: value })
    toast(`Type de relation enregistré : ${value}.`)
    await refresh()
  })
  const setRole = (value: string) => void run('role', async () => {
    await setPersonRoles(data, userId, { decisionRole: value })
    toast(`Rôle décisionnel enregistré : ${value}.`)
    await refresh()
  })
  const subtitle = [person.jobTitle, data.employment?.accountName].filter(Boolean).join(' · ')
  return <div className="hero-header v48-identity-card">
    <div className="hero-body v48-identity-body">
      <div className="hero-left v48-identity-left">
        <div className="v48-avatar-wrap">
          <ContactAvatar src={person.avatarUrl} name={person.fullName} />
          <i aria-hidden="true" />
        </div>
        <div className="v48-identity-copy">
          <div className="v48-eyebrow"><Link to="/app/people" className="v48-eyebrow-back">← Personnes</Link> / {person.fullName}</div>
          <div className="v48-name-row">
            <div className="hero-name">
            {editingName
              ? <form className="hero-name-edit" onSubmit={saveName}>
                <label className="sr-only" htmlFor="hero-name-input">Nom complet</label>
                <input id="hero-name-input" className="pp-input" value={nameValue} onChange={(event) => setNameValue(event.target.value)} autoFocus />
                <button className="contact-copy" disabled={busy !== null}>OK</button>
                <button type="button" className="contact-copy" onClick={() => setEditingName(false)}>✕</button>
              </form>
              : <>{person.fullName}<button type="button" className="hero-name-edit-btn" onClick={startEditName} aria-label="Modifier le nom" title="Modifier le nom">✎</button></>}
            <FavoriteRow data={data} userId={userId} refresh={refresh} />
            </div>
          </div>
          <div className="hero-sub">
            <span>{subtitle || 'Fonction à confirmer'}</span>
            {person.location && <><span className="hero-dot" /><span>{person.location}</span></>}
            {person.primaryOwnerName && <><span className="hero-dot" /><span>Owner : {person.primaryOwnerName}</span></>}
          </div>
          <div className="mh-meta">
            <ChipMenu
              label="Relation"
              value={person.relationshipType}
              color={RELATION_COLORS[person.relationshipType ?? ''] ?? '#6B6480'}
              options={RELATIONSHIP_TYPES.map((value) => ({ value, hint: RELATION_VERBS[value] ?? '', color: RELATION_COLORS[value] }))}
              onSelect={setRelation}
            />
            <ChipMenu
              label="Rôle"
              value={person.decisionRole}
              icon={<span className="rel-ic" aria-hidden="true"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#C9B8FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="2.4" /><circle cx="5" cy="19" r="2.4" /><circle cx="19" cy="19" r="2.4" /><path d="M12 7.4v3.2M12 10.6L5.8 16.6M12 10.6l6.2 6" /></svg></span>}
              options={DECISION_ROLES.map((value) => ({ value, hint: ROLE_POWER[value] ?? '' }))}
              onSelect={setRole}
            />
            {data.employment && <Link className="v48-account-chip" to={`/app/accounts/${data.employment.accountId}`}>
              <span className="v48-account-chip-label">Entreprise</span>
              <span className="v48-account-chip-logo">{initials(data.employment.accountName)}</span>
              <strong>{data.employment.accountName}</strong>
              <span>→</span>
            </Link>}
          </div>
        </div>
      </div>
      <div className="hero-right v48-identity-right">
        <div className="v48-reliability">
          <span>Indice de fiabilité</span>
          <strong className={`v48-reliability-${confLevel ?? 'none'}`}>{confLevel ? confLevel.charAt(0).toUpperCase() + confLevel.slice(1) : 'À confirmer'}</strong>
          <div>
            <span><b>{relation.meetingInteractions}</b> réunion{relation.meetingInteractions > 1 ? 's' : ''}</span>
            <span><b>{relation.totalInteractions}</b> échange{relation.totalInteractions > 1 ? 's' : ''} retrouvé{relation.totalInteractions > 1 ? 's' : ''}</span>
          </div>
        </div>
        <OwnerAffectation data={data} userId={userId} refresh={refresh} />
      </div>
    </div>
  </div>
}

function WatchCard({ data, userId, refresh }: { data: PersonDetailData; userId: string; refresh: () => Promise<void> }) {
  const toast = useToast()
  const [busy, run] = useBusy()
  const toggleWatch = () => void run('watch', async () => {
    await setPersonWatch(data, userId, !data.person.watchEnabled)
    toast(data.person.watchEnabled ? 'Veille désactivée.' : 'Veille activée — signaux internes & externes.')
    await refresh()
  })
  return <div className="kveille rail-veille">
    <span className="kveille-ic" aria-hidden="true">🛰️</span>
    <div className="kveille-tx">
      <div className="kveille-t">Veille Tohu</div>
      <div className="kveille-s">signaux internes &amp; externes</div>
    </div>
    <button type="button" className={`ktog ${data.person.watchEnabled ? 'on' : ''}`} disabled={busy !== null} aria-pressed={data.person.watchEnabled} onClick={toggleWatch}>
      <span className="ktog-lbl">{data.person.watchEnabled ? 'Activée' : 'Désactivée'}</span>
      <span className="ktog-sw" aria-hidden="true" />
    </button>
  </div>
}

function ControlCards({ data }: { data: PersonDetailData }) {
  return <div className="kctrl">
    {data.employment
      ? <div className="acct-block">
        <span className="acct-mono" aria-hidden="true">{data.employment.accountLogoUrl ? <img src={data.employment.accountLogoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} /> : initials(data.employment.accountName)}</span>
        <div className="acct-info">
          <div className="acct-name">{data.employment.accountName}</div>
          <div className="acct-sub2">{data.employment.jobTitle ?? data.person.jobTitle ?? 'Poste à confirmer'} <span className="kposte-live"><span className="dot" />Live</span></div>
        </div>
        <Link className="acct-btn" to={`/app/accounts/${data.employment.accountId}`}>Voir la fiche →</Link>
      </div>
      : <div className="acct-block">
        <span className="acct-mono" aria-hidden="true">◇</span>
        <div className="acct-info">
          <div className="acct-eyebrow">Compte</div>
          <div className="acct-name">Aucun compte associé</div>
        </div>
      </div>}
    <div className="kowner">
      <span className="kowner-av" aria-hidden="true">{initials(data.person.primaryOwnerName ?? 'À confirmer')}</span>
      <div className="kowner-b">
        <div className="kowner-l">Owner de la fiche</div>
        <div className="kowner-n">{data.person.primaryOwnerName ?? 'À confirmer'}</div>
      </div>
      <span className="kvis">
        <span className="kvis-badge org">
          <span className="kvi" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="7" cy="8" r="2.5" /><circle cx="17" cy="8" r="2.5" /><circle cx="12" cy="16" r="2.5" /><path d="M9 9.5l2 4M15 9.5l-2 4" /></svg></span>
          Organisation <span className="chev">▾</span>
        </span>
      </span>
    </div>
  </div>
}

function SourceIcon({ provider, label }: { provider: string; label: string }) {
  const key = `${provider} ${label}`.toLowerCase()
  if (/outlook|microsoft/.test(key)) return <span className="src-provider outlook" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M4 7l8 6 8-6" /></svg></span>
  if (/read.?ai/.test(key)) return <span className="src-provider readai" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" /></svg></span>
  if (/linkedin/.test(key)) return <span className="src-provider linkedin" aria-hidden="true">in</span>
  if (/web|internet|enrich/.test(key)) return <span className="src-provider internet" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" /></svg></span>
  return <span className="src-provider generic" aria-hidden="true">{initials(label).slice(0, 2)}</span>
}

function SourceBar({ data }: { data: PersonDetailData }) {
  return <div className="ctx-grid hdr-conn">
    <div className="hdr-conn-tiles">
      {!data.sources.length && <span className="src-tile"><span className="src-name">Aucune source connectée pour cette personne</span></span>}
      {data.sources.map((source) => <div className="src-tile" key={source.provider} title={source.error ?? (source.lastSyncedAt ? `Dernière synchro : ${formatDate(source.lastSyncedAt)}` : 'Jamais synchronisé')}>
        <SourceIcon provider={source.provider} label={source.label} />
        <span className="src-name">{source.label}</span>
        <span className={`src-led ${source.status === 'connected' ? 'on' : 'off'}`} aria-label={source.status === 'connected' ? 'connecté' : source.status} />
      </div>)}
    </div>
    <Link className="ctx-manage" to="/app/connectors">Gérer les connecteurs <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg></Link>
  </div>
}

function FavoriteRow({ data, userId, refresh }: { data: PersonDetailData; userId: string; refresh: () => Promise<void> }) {
  const toast = useToast()
  const [busy, run] = useBusy()
  const toggle = () => void run('favorite', async () => {
    await setPersonFavorite(data, userId, !data.person.favorite)
    toast(data.person.favorite ? 'Retirée des favoris.' : 'Ajoutée aux favoris.')
    await refresh()
  })
  return <button type="button" className={`hero-fav ${data.person.favorite ? 'on' : ''}`} disabled={busy !== null} aria-pressed={data.person.favorite} aria-label={data.person.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'} onClick={toggle}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.6-5 4.4 1.5 6.5L12 17.9 5.5 20l1.5-6.5-5-4.4 6.6-.6z" /></svg>
  </button>
}

function RelationshipBand({ data }: { data: PersonDetailData }) {
  const [recommendationIndex, setRecommendationIndex] = useState(0)
  const recommendations = data.recommendations
    .filter((item) => item.status === 'open' || item.status === 'in_progress' || item.status === 'postponed')
    .map((item) => ({
      nature: item.kind === 'coaching' ? 'Posture' : item.actionType === 'mouv' ? 'Mouvement' : 'Action',
      className: item.kind === 'coaching' ? 'rel' : 'com',
      text: item.recommendedAction ?? item.title,
    }))
  const pool = recommendations.length ? recommendations : [{ nature: 'Posture', className: 'rel', text: 'Entretenir la relation au prochain échange' }]
  const current = pool[recommendationIndex % pool.length]!
  const tone = data.relationship.phase === 'growing' ? 'sage' : data.relationship.phase === 'declining' ? 'amber' : data.relationship.phase === 'stable' ? 'teal' : 'violet'
  const relationship = data.person.relationshipType ?? 'Relation à qualifier'
  const role = data.person.relationshipRole ?? data.person.decisionRole ?? data.employment?.jobTitle ?? data.person.jobTitle ?? 'Position à confirmer'
  const next = () => setRecommendationIndex((index) => (index + 1) % pool.length)

  return <div className={`relband relband-${tone}`} data-ri={recommendationIndex}>
    <div className="rb-scan" />
    <div className="rb-left">
      <span className="rb-state"><span className="rb-dot" />{relationship} · {phaseLabel(data.relationship.phase).replace(/^[↗→↘]\s*/, '')}</span>
      <span className="rb-trend">{[data.employment?.accountName, data.employment?.jobTitle ?? data.person.jobTitle].filter(Boolean).join(' · ') || 'Contexte professionnel à confirmer'}</span>
      <span className="rb-fresh"><span className="rb-live" />{relativeDate(data.relationship.lastInteractionAt).toLowerCase()}</span>
    </div>
    <div className="rb-synth">
      <div className="rb-synth-1">{data.summary?.text ?? `${role} — synthèse relationnelle en cours de consolidation.`}</div>
      <div className="rb-synth-2">{data.relationship.totalInteractions ? `${data.relationship.totalInteractions} échanges observés` : 'Données relationnelles en construction'} · <span className="rb-src">{data.summary ? provenanceLabel(data.summary.provenance) : 'à confirmer'}</span></div>
    </div>
    <div className="rb-action">
      <div className="rb-act-inner">
        <span className={`rb-nat rb-nat-${current.className}`}>{current.nature}</span>
        <span className="rb-act-t">{current.text}</span>
      </div>
      <div className="rb-act-btns">
        <button type="button" className="rb-treat" onClick={next}>Fait</button>
        <button type="button" className="rb-other" onClick={next}>Suivante</button>
      </div>
    </div>
  </div>
}

function CognitiveSyncButton({ data, userId, refresh }: { data: PersonDetailData; userId: string; refresh: () => Promise<void> }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = () => void (async () => {
    setBusy(true)
    toast(`Synchronisation cognitive de ${data.person.fullName} lancée…`)
    try {
      const result = await triggerPersonCognitiveSync(data, userId)
      await refresh()
      if (result.peopleAnalyzed > 0) {
        toast('Profil cognitif recalculé à partir des emails et prises de parole attribuables retrouvés.')
      } else if (result.errors.length) {
        toast(`Échanges synchronisés, mais analyse incomplète : ${result.errors.join(' · ')}`, 'error')
      } else if (result.messagesScanned === 0 && result.meetingExcerpts === 0) {
        toast('Aucun email ni passage de réunion retrouvé pour les adresses enregistrées sur cette fiche.', 'error')
      } else if (result.inboundMessages === 0 && result.meetingExcerpts === 0) {
        toast('Des échanges ont été retrouvés, mais uniquement des messages que tu as envoyés. Il faut des propos rédigés ou prononcés par cette personne pour inférer son profil.', 'error')
      } else if (result.attributedInteractions > 0 && result.attributedInteractions < data.behavior.profileMinimumInteractions) {
        toast(`${result.attributedInteractions} interaction(s) attribuable(s) retrouvée(s) ; ${data.behavior.profileMinimumInteractions} sont nécessaires pour commencer le profil.`, 'error')
      } else if (result.emailExcerpts === 0 && result.meetingExcerpts === 0) {
        toast('Des messages ont été retrouvés, mais leur contenu textuel n’a pas pu être extrait ou attribué de manière fiable.', 'error')
      } else {
        toast('Les extraits ont été retrouvés, mais ils ne suffisent pas encore à produire un profil comportemental fiable.', 'error')
      }
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Synchronisation cognitive impossible.', 'error')
    } finally {
      setBusy(false)
    }
  })()
  return <button type="button" className="cognitive-sync-action" disabled={busy} title="Relire les échanges et produire la carte comportementale à six dimensions" onClick={run}>
    <span aria-hidden="true">{busy ? '…' : '◉'}</span>
    {busy ? 'Analyse en cours…' : 'Synchroniser le profil cognitif'}
  </button>
}

const CONTACT_ROW_ICON: Record<'phone' | 'email' | 'linkedin' | 'website', React.ReactNode> = {
  phone: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M7.6 4.4l2.4 3.4-1.9 1.9a11 11 0 0 0 4.8 4.8l1.9-1.9 3.4 2.4-.6 2.6a1.7 1.7 0 0 1-1.9 1.3C10.4 18 6 13.6 4.7 7.1a1.7 1.7 0 0 1 1.3-1.9z" /></svg>,
  email: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3.4" y="5.6" width="17.2" height="12.8" rx="2" /><path d="M3.9 7l8.1 6 8.1-6" /></svg>,
  linkedin: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3.6" y="3.6" width="16.8" height="16.8" rx="3" /><path d="M8 10.6v6" /><circle cx="8" cy="7.6" r="1.1" fill="currentColor" /><path d="M12 16.6v-3.4a2.2 2.2 0 0 1 4.4 0v3.4" /><path d="M12 16.6v-6" /></svg>,
  website: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" /></svg>,
}
const ContactPinIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s6.4-5.8 6.4-10.2a6.4 6.4 0 1 0-12.8 0C5.6 15.2 12 21 12 21z" /><circle cx="12" cy="10.6" r="2.3" /></svg>
const ContactSearchIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.2-3.2" /></svg>
const CONTACT_ROW_LABEL: Record<'phone' | 'email' | 'linkedin' | 'website', string> = { phone: 'Téléphone', email: 'Email principal', linkedin: 'LinkedIn', website: 'Site' }
const CONTACT_ADD_PLACEHOLDER: Record<'phone' | 'email' | 'linkedin' | 'website', string> = { phone: '+33 …', email: 'prenom@domaine.fr', linkedin: '/in/… ou URL', website: 'https://…' }

/** Action ouvrable (jamais un « Ajouter » qui ne fait rien) — mailto / tel / lien. */
function contactAction(detail: PersonContactDetail): { href: string; label: string; external: boolean } | null {
  const value = detail.value.trim()
  if (!value) return null
  switch (detail.type) {
    case 'email': return { href: `mailto:${value}`, label: 'Écrire', external: false }
    case 'phone': return { href: `tel:${value.replace(/[^\d+]/g, '')}`, label: 'Appeler', external: false }
    case 'linkedin': return { href: /^https?:/i.test(value) ? value : `https://www.linkedin.com/${value.replace(/^\/+/, '')}`, label: 'Ouvrir', external: true }
    case 'website': return { href: /^https?:/i.test(value) ? value : `https://${value}`, label: 'Ouvrir', external: true }
    default: return null
  }
}

function PersonContactDialog({ data, userId, refresh, onClose }: { data: PersonDetailData; userId: string; refresh: () => Promise<void>; onClose: () => void }) {
  const toast = useToast()
  const [busy, run] = useBusy()
  const [adding, setAdding] = useState<'phone' | 'email' | 'linkedin' | 'website' | null>(null)
  const [addValue, setAddValue] = useState('')
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Recherche web (agent d'enrichissement) : profil LinkedIn PUBLIC, poste, localisation,
  // actualité — via recherche web, jamais un scraping du réseau privé LinkedIn.
  const searchWeb = () => void (async () => {
    setSearching(true)
    toast('Recherche web en cours…')
    try {
      const result = await triggerPersonEnrichment(data.person.id)
      await refresh()
      toast(result.enriched > 0 ? 'Profil enrichi via la recherche web (LinkedIn public, poste, localisation).' : 'Recherche terminée — aucune nouvelle donnée fiable trouvée.')
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Recherche impossible.', 'error')
    } finally {
      setSearching(false)
    }
  })()

  // Une coordonnée effacée (valeur vide) ne doit jamais apparaître comme « trouvée ».
  const knownDetails = data.contactDetails.filter((detail) => detail.value.trim() !== '')
  const pick = (type: PersonContactDetail['type']) =>
    knownDetails.find((detail) => detail.type === type && detail.primary)
    ?? knownDetails.find((detail) => detail.type === type)
  const reachTypes: Array<'phone' | 'email' | 'linkedin' | 'website'> = ['phone', 'email', 'linkedin']
  if (pick('website')) reachTypes.push('website')
  const identifiers = knownDetails.filter((detail) => detail.type === 'email' || detail.type === 'other')
  const connected = data.sources.filter((source) => source.status === 'connected')
  const verifiedAt = data.contactDetails.map((detail) => detail.provenance?.lastVerifiedAt).filter(Boolean).sort().at(-1) ?? null

  const saveAdd = (type: 'phone' | 'email' | 'linkedin' | 'website') => run('add', async () => {
    const value = addValue.trim()
    const invalid = validateContactDetail(type, value)
    if (invalid) { toast(invalid, 'error'); return }
    await addPersonContactDetail(data, userId, { type, value })
    setAdding(null); setAddValue('')
    toast('Coordonnée ajoutée.')
    await refresh()
  })

  return createPortal(
    <div className="pp">
    <div className="pc-mask" role="presentation" onClick={onClose}>
      <aside className="pc-panel" role="dialog" aria-label="Contact" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="pc-h">
          <div><p className="pc-title">Contact</p><p className="pc-who">{data.person.fullName}</p></div>
          <button type="button" className="pc-x" onClick={onClose} aria-label="Fermer">×</button>
        </div>
        <div className="pc-b">
          <p className="pc-l">Joindre</p>
          <div className="pc-g">
            {reachTypes.map((type) => {
              const detail = pick(type)
              const action = detail ? contactAction(detail) : null
              if (detail && action) return <a key={type} className="pc-row" href={action.href} {...(action.external ? { target: '_blank', rel: 'noreferrer' } : {})}>
                <span className="pc-i">{CONTACT_ROW_ICON[type]}</span>
                <div className="pc-c"><p className="pc-rl">{CONTACT_ROW_LABEL[type]}</p><p className="pc-v">{detail.value}</p></div>
                <span className="pc-a">{action.label}</span>
              </a>
              return <div key={type} className="pc-row">
                <span className="pc-i">{CONTACT_ROW_ICON[type]}</span>
                <div className="pc-c">
                  <p className="pc-rl">{CONTACT_ROW_LABEL[type]}</p>
                  {adding === type
                    ? <form className="pc-add" onSubmit={(event) => { event.preventDefault(); void saveAdd(type) }}>
                      <input className="pc-add-input" autoFocus value={addValue} onChange={(event) => setAddValue(event.target.value)} placeholder={CONTACT_ADD_PLACEHOLDER[type]} aria-label={`Ajouter ${CONTACT_ROW_LABEL[type]}`} />
                      <button className="pc-add-ok" disabled={busy !== null} aria-label="Enregistrer">✓</button>
                      <button type="button" className="pc-add-no" onClick={() => setAdding(null)} aria-label="Annuler">✕</button>
                    </form>
                    : <p className="pc-v na">à confirmer</p>}
                </div>
                {adding !== type && <button type="button" className="pc-a pc-a-btn" onClick={() => { setAdding(type); setAddValue('') }}>Ajouter</button>}
              </div>
            })}
          </div>

          <p className="pc-l">Réseau</p>
          <div className="pc-g">
            {data.employment && <Link className="pc-row" to={`/app/accounts/${data.employment.accountId}`} onClick={onClose}>
              <span className="pc-i">{initials(data.employment.accountName)}</span>
              <div className="pc-c"><p className="pc-rl">Entreprise</p><p className="pc-v">{data.employment.accountName}</p>{data.employment.jobTitle && <p className="pc-s">{data.employment.jobTitle}</p>}</div>
              <span className="pc-a">Ouvrir</span>
            </Link>}
            {data.person.location && <div className="pc-row">
              <span className="pc-i">{ContactPinIcon}</span>
              <div className="pc-c"><p className="pc-rl">Localisation</p><p className="pc-v">{data.person.location}</p></div>
            </div>}
            <button type="button" className="pc-row pc-search" disabled={searching} onClick={searchWeb}>
              <span className="pc-i">{searching ? <span className="pc-spin" aria-hidden="true" /> : ContactSearchIcon}</span>
              <div className="pc-c"><p className="pc-rl">Recherche web</p><p className="pc-v">{searching ? 'Recherche en cours…' : 'Trouver / rafraîchir le profil LinkedIn public'}</p><p className="pc-s">Poste, localisation, actualité — via recherche web publique, jamais scrapé.</p></div>
            </button>
          </div>

          {identifiers.length > 0 && <>
            <p className="pc-l">Identifiants rattachés<span className="pc-n">{identifiers.length}</span></p>
            <div className="pc-ids">
              {identifiers.map((detail) => <div key={detail.id} className={`pc-id ${detail.primary ? 'ok' : ''}`}>
                <span>{detail.value}</span>
                <em>{detail.primary ? 'principal' : detail.provenance?.sourceLabel ?? detail.label ?? 'alias'}</em>
              </div>)}
            </div>
          </>}

          {connected.length > 0 && <p className="pc-src"><i />{connected.map((source) => source.label).join(' · ')}{verifiedAt ? ` · vérifié ${relativeDate(verifiedAt).toLowerCase()}` : ''}</p>}
        </div>
      </aside>
    </div>
    </div>,
    document.body,
  )
}

function PageBody({ data, userId, refresh }: { data: PersonDetailData; userId: string; refresh: () => Promise<void> }) {
  const [activeTab, setActiveTab] = useState<PersonDetailTab>('profile')
  const [contactOpen, setContactOpen] = useState(false)
  // La ré-analyse est proposée dès qu'il y a assez de données : profil absent/ancien
  // (état vide) MAIS AUSSI profil v3 sans conseils d'approche déduits — pour permettre
  // de régénérer et obtenir le « comment aborder » ancré sur les échanges.
  const profileNeedsRebuild = data.behavior.availableInteractions >= data.behavior.profileMinimumInteractions
  return <>
    <div className="v48-page-live"><span className="v48-live"><i />Live</span></div>
    <nav className="v48-tabs" role="tablist" aria-label="Sections de la fiche personne">
      <button type="button" role="tab" aria-selected={activeTab === 'profile'} className={activeTab === 'profile' ? 'on' : ''} onClick={() => setActiveTab('profile')}>Profil</button>
      <button type="button" role="tab" aria-selected={activeTab === 'relation'} className={activeTab === 'relation' ? 'on' : ''} onClick={() => setActiveTab('relation')}>Relation</button>
      <button type="button" role="tab" aria-selected={activeTab === 'live'} className={activeTab === 'live' ? 'on' : ''} onClick={() => setActiveTab('live')}>CV Live &amp; Signaux</button>
      <button type="button" className="v48-tabs-action" aria-haspopup="dialog" onClick={() => setContactOpen(true)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="4.4" y="3.6" width="15.2" height="16.8" rx="2.2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
        Contact
      </button>
    </nav>
    {data.person.archivedAt && <div className="pp-degraded">Personne archivée le {formatDate(data.person.archivedAt)} — fiche en lecture seule recommandée.</div>}
    {data.degradedReasons.length > 0 && <div className="pp-degraded"><strong>Données partielles</strong> {data.degradedReasons.join(' · ')}</div>}
    <Hero data={data} userId={userId} refresh={refresh} />
    {activeTab === 'profile' && <div className="v48-tab-panel" role="tabpanel"><V48PersonProfileView
      data={data}
      userId={userId}
      refresh={refresh}
      manualSyncAction={profileNeedsRebuild ? <CognitiveSyncButton data={data} userId={userId} refresh={refresh} /> : undefined}
    /></div>}
    {activeTab === 'relation' && <div className="v48-tab-panel" role="tabpanel"><V48PersonRelationView data={data} userId={userId} refresh={refresh} /></div>}
    {activeTab === 'live' && <div className="v48-tab-panel" role="tabpanel"><V48PersonLiveView data={data} userId={userId} refresh={refresh} /></div>}
    <V48PersonSourceNote data={data} />
    {contactOpen && <PersonContactDialog data={data} userId={userId} refresh={refresh} onClose={() => setContactOpen(false)} />}
  </>
}

export default function PersonDetailPage({ context }: { context: PageContext }) {
  const { personId = '' } = useParams()
  const [data, setData] = useState<PersonDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try {
      setError(null)
      setData(await getPersonDetail(context.workspaceId, personId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Erreur inattendue')
    }
  }, [context.workspaceId, personId])
  useEffect(() => { setData(null); void refresh() }, [refresh])

  if (error === 'PERSON_NOT_FOUND') return <div className="ra-state"><h1>Personne introuvable</h1><p>Cette personne n’existe pas ou n’est pas accessible dans ton workspace.</p><Link to="/app/people">Retour aux personnes</Link></div>
  if (error === 'PERSON_FORBIDDEN') return <div className="ra-state error"><h1>Accès interdit</h1><p>Tu n’as pas les droits nécessaires pour consulter cette personne.</p><Link to="/app/people">Retour aux personnes</Link></div>
  if (error) return <div className="ra-state error"><h1>Impossible de charger la personne</h1><p>{error}</p><button onClick={() => void refresh()}>Réessayer</button></div>
  if (!data) return <FicheSkeleton label="Chargement de la fiche personne…" />

  return <ToastProvider>
    <div className="pp">
      <PageBody data={data} userId={context.userId} refresh={refresh} />
    </div>
  </ToastProvider>
}
