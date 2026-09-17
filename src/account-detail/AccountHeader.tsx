import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { initials } from '../lib/auth'
import { useBusy, useToast } from '../person-detail/ui'
import { RELATION_COLORS } from '../account-list/mapping'
import { fetchWorkspaceMembers, type WorkspaceMember } from '../person-detail/service'
import {
  grantAccountAccess,
  listAccountAccessGrants,
  revokeAccountAccess,
  setAccountOwner,
  setAccountRelationType,
  setAccountVisibility,
} from './service'
import type { AccountDetailData } from './types'
import { AccountConnectorsPill } from './AccountRelationView'
import { ContactAvatar } from '../components/ContactAvatar'

// ── Helpers locaux (mêmes conventions que le reste de la fiche compte) ─────
function formatDate(value: string | null, fallback = 'À confirmer'): string {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date) : fallback
}

/** Synthèse identitaire courte (§10) : n'assemble QUE des informations réellement
 *  persistées (firmographie vérifiée, secteur, localisation, relation, dirigeant).
 *  Jamais de génération libre — un champ absent est simplement omis, pas remplacé
 *  par un texte inventé. */
function identitySummary(data: AccountDetailData): string {
  const fact = (key: string) => data.firmographics.find((item) => item.key === key)?.value ?? null
  const activity = fact('activity')
  const legalForm = fact('legal_form')
  const executives = fact('executives')
  const parts: string[] = []
  if (activity) parts.push(String(activity))
  else if (data.account.sector) parts.push(data.account.sector)
  if (legalForm) parts.push(String(legalForm))
  if (data.account.location) parts.push(data.account.location)
  if (data.account.relationshipStartedAt) {
    const label = (data.account.relationshipStatus ?? data.account.accountType ?? 'relation').toLowerCase()
    parts.push(`${label} depuis ${formatDate(data.account.relationshipStartedAt)}`)
  }
  if (executives) parts.push(`dirigé par ${String(executives)}`)
  return parts.length ? parts.join(' · ') : 'Identité en cours de confirmation'
}

const ACCOUNT_RELATION_TYPES = Object.keys(RELATION_COLORS)

/** Chip « Relation » — éditable, marquée « Suggéré par Tohu » tant qu'aucun
 *  humain n'a confirmé la catégorisation. */
export function RelationChip({ data, userId, refresh }: { data: AccountDetailData; userId: string; refresh: () => Promise<void> }) {
  const account = data.account
  const [open, setOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 })
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    const closeOnViewportChange = () => setOpen(false)
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('click', close)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closeOnViewportChange)
    window.addEventListener('scroll', closeOnViewportChange, true)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closeOnViewportChange)
      window.removeEventListener('scroll', closeOnViewportChange, true)
    }
  }, [open])
  const toggleMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (open) { setOpen(false); return }
    const rect = event.currentTarget.getBoundingClientRect()
    const menuWidth = 246
    const menuHeight = ACCOUNT_RELATION_TYPES.length * 40 + 12
    const gap = 7
    const viewportPadding = 10
    const opensUp = window.innerHeight - rect.bottom < menuHeight + gap
    setMenuPosition({
      left: Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - menuWidth - viewportPadding)),
      top: opensUp ? Math.max(viewportPadding, rect.top - menuHeight - gap) : Math.min(window.innerHeight - menuHeight - viewportPadding, rect.bottom + gap),
    })
    setOpen(true)
  }
  const pick = async (value: string) => {
    setOpen(false)
    setError(null)
    try { await setAccountRelationType(data, userId, value); await refresh() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Enregistrement impossible') }
  }
  const suggested = account.relationshipStatusSource === 'suggested' && account.relationshipStatus !== null
  return <span style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
    <button type="button" ref={rootRef} className={`crel2-chip ${suggested ? 'suggested' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={toggleMenu}>
      <span className="crel2-k">Relation</span>
      <span className="crel2-dot" style={{ background: account.relationshipStatus ? RELATION_COLORS[account.relationshipStatus] ?? '#8C86A8' : '#8C86A8' }} />
      <span className="crel2-v">{account.relationshipStatus ?? account.accountType ?? 'À confirmer'}</span>
      {suggested && <span className="crel2-ai" title="Proposé par Tohu à partir des échanges — clique pour confirmer">IA</span>}
      <span className="crel2-c">⌄</span>
    </button>
    {error && <small className="crel2-err">{error}</small>}
    {open && createPortal(<div ref={menuRef} className="pa-relmenu" role="menu" style={menuPosition} onClick={(event) => event.stopPropagation()}>
      {ACCOUNT_RELATION_TYPES.map((value) => <button key={value} type="button" role="menuitem" className="pa-relmenu-option" onClick={() => void pick(value)}>
        <span className="dxp-rf-o-dot" style={{ background: RELATION_COLORS[value] }} />{value}
      </button>)}
    </div>, document.body)}
  </span>
}

const AcctShareIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="12" r="2.4" /><circle cx="17.5" cy="6" r="2.4" /><circle cx="17.5" cy="18" r="2.4" /><path d="M8.2 10.9l7-3.6M8.2 13.1l7 3.6" /></svg>
const AcctLockIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2.2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>

/** Affectation de la fiche compte : owner + visibilité organisation/restreinte.
 *  Persisté dans account_settings — même composant que la fiche Personne
 *  (OwnerAffectation dans person-detail/PersonDetailPage.tsx), adapté à AccountDetailData. */
export function AccountOwnerAffectation({ data, userId, refresh }: { data: AccountDetailData; userId: string; refresh: () => Promise<void> }) {
  const toast = useToast()
  const [busy, run] = useBusy()
  const account = data.account
  const [ownerOpen, setOwnerOpen] = useState(false)
  const [visOpen, setVisOpen] = useState(false)
  const [ownerPos, setOwnerPos] = useState<{ top: number; left: number } | null>(null)
  const [visPos, setVisPos] = useState<{ top: number; left: number } | null>(null)
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null)
  const [grantedIds, setGrantedIds] = useState<string[] | null>(null)
  const [memberQuery, setMemberQuery] = useState('')
  const ownerBtnRef = useRef<HTMLButtonElement>(null)
  const visBtnRef = useRef<HTMLButtonElement>(null)
  const ownerMenuRef = useRef<HTMLDivElement>(null)
  const visMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (event: MouseEvent) => {
      const target = event.target as Node
      if (!ownerBtnRef.current?.contains(target) && !ownerMenuRef.current?.contains(target)) setOwnerOpen(false)
      if (!visBtnRef.current?.contains(target) && !visMenuRef.current?.contains(target)) setVisOpen(false)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  useEffect(() => {
    if (!ownerOpen && !visOpen) return
    const reposition = () => {
      if (ownerOpen && ownerBtnRef.current) {
        const rect = ownerBtnRef.current.getBoundingClientRect()
        setOwnerPos({ top: rect.bottom + 6, left: rect.left })
      }
      if (visOpen && visBtnRef.current) {
        const rect = visBtnRef.current.getBoundingClientRect()
        setVisPos({ top: rect.bottom + 6, left: Math.max(8, rect.right - 360) })
      }
    }
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [ownerOpen, visOpen])

  const openOwner = () => {
    if (!ownerOpen && ownerBtnRef.current) {
      const rect = ownerBtnRef.current.getBoundingClientRect()
      setOwnerPos({ top: rect.bottom + 6, left: rect.left })
    }
    setOwnerOpen((value) => !value); setVisOpen(false)
    if (members === null) void fetchWorkspaceMembers(account.workspaceId).then(setMembers).catch(() => setMembers([]))
  }
  const openVis = () => {
    if (!visOpen && visBtnRef.current) {
      const rect = visBtnRef.current.getBoundingClientRect()
      setVisPos({ top: rect.bottom + 6, left: Math.max(8, rect.right - 360) })
    }
    setVisOpen((value) => !value); setOwnerOpen(false)
    if (members === null) void fetchWorkspaceMembers(account.workspaceId).then(setMembers).catch(() => setMembers([]))
    if (grantedIds === null) void listAccountAccessGrants(account.workspaceId, account.id).then(setGrantedIds).catch(() => setGrantedIds([]))
  }
  const chooseOwner = (ownerUserId: string | null, name: string) => void run('owner', async () => {
    await setAccountOwner(data, userId, ownerUserId)
    setOwnerOpen(false)
    toast(ownerUserId ? `Fiche affectée à ${name}.` : 'Owner retiré.')
    await refresh()
  })
  const chooseVisibility = (visibility: 'workspace' | 'restricted') => void run('vis', async () => {
    await setAccountVisibility(data, userId, visibility)
    toast(visibility === 'workspace' ? 'Visible par toute l’organisation.' : 'Visibilité restreinte à l’équipe invitée.')
    await refresh()
  })
  const toggleGrant = (member: WorkspaceMember) => void run(`grant-${member.id}`, async () => {
    const isGranted = (grantedIds ?? []).includes(member.id)
    if (isGranted) {
      await revokeAccountAccess(data, member.id)
      setGrantedIds((ids) => (ids ?? []).filter((id) => id !== member.id))
    } else {
      await grantAccountAccess(data, userId, member.id)
      setGrantedIds((ids) => [...(ids ?? []), member.id])
    }
  })
  const filteredMembers = (members ?? []).filter((member) => member.id !== userId && member.fullName.toLowerCase().includes(memberQuery.trim().toLowerCase()))

  return <div className="v48-owner-card v48-affect">
    <div className="v48-owner-row">
      <span className="v48-owner-avatar">{initials(account.primaryOwnerName ?? 'À confirmer')}</span>
      <div className="v48-affect-body">
        <span className="v48-owner-l">Owner du compte</span>
        <strong>{account.primaryOwnerName ?? 'Non affecté'}</strong>
        <div className="v48-affect-actions">
          <span className="v48-affect-menu">
            <button ref={ownerBtnRef} type="button" className="v48-affect-link" aria-haspopup="menu" aria-expanded={ownerOpen} disabled={busy !== null} onClick={openOwner}>Changer l’owner</button>
            {ownerOpen && ownerPos && createPortal(
              <div ref={ownerMenuRef} className="v48-affect-pop" role="menu" style={{ top: ownerPos.top, left: ownerPos.left }}>
                {members === null
                  ? <div className="v48-affect-loading">Chargement…</div>
                  : members.length === 0
                    ? <div className="v48-affect-loading">Aucun membre trouvé.</div>
                    : <>
                      {members.map((member) => <button key={member.id} type="button" role="menuitemradio" aria-checked={member.id === account.primaryOwnerUserId} className={member.id === account.primaryOwnerUserId ? 'on' : ''} onClick={() => chooseOwner(member.id, member.fullName)}>
                        <span className="v48-affect-ini">{initials(member.fullName)}</span>{member.fullName}
                      </button>)}
                      {account.primaryOwnerUserId && <button type="button" className="v48-affect-clear" onClick={() => chooseOwner(null, '')}>Retirer l’owner</button>}
                    </>}
              </div>, document.body)}
          </span>
        </div>
      </div>
    </div>
    <span className="v48-affect-menu v48-affect-vis-menu">
      <button ref={visBtnRef} type="button" className={`v48-affect-vis vis-${account.visibility}`} aria-haspopup="menu" aria-expanded={visOpen} disabled={busy !== null} onClick={openVis}>
        <span className="v48-affect-vis-ic" aria-hidden="true">{account.visibility === 'restricted' ? AcctLockIcon : AcctShareIcon}</span>
        {account.visibility === 'restricted' ? `Restreint · ${grantedIds?.length ?? 0} pers.` : 'Organisation'} <span aria-hidden="true">▾</span>
      </button>
      {visOpen && visPos && createPortal(
        <div ref={visMenuRef} className="v48-affect-pop wide" role="menu" style={{ top: visPos.top, left: visPos.left }}>
          <button type="button" role="menuitemradio" aria-checked={account.visibility === 'workspace'} className={`vo ${account.visibility === 'workspace' ? 'on' : ''}`} onClick={() => chooseVisibility('workspace')}>
            <span className="vo-ic vo-ic-org">{AcctShareIcon}</span>
            <span><div className="vo-t">Organisation</div><div className="vo-d">Visible par tous — nourrit le cerveau collectif.</div></span>
          </button>
          <button type="button" role="menuitemradio" aria-checked={account.visibility === 'restricted'} className={`vo ${account.visibility === 'restricted' ? 'on' : ''}`} onClick={() => chooseVisibility('restricted')}>
            <span className="vo-ic vo-ic-lock">{AcctLockIcon}</span>
            <span><div className="vo-t">Restreint</div><div className="vo-d">Détail relationnel visible par l’équipe invitée uniquement.</div></span>
          </button>
          {account.visibility === 'restricted' && <div className="vo-grants">
            <p className="vo-grants-l">Personnes invitées</p>
            <input type="text" className="vo-grants-search" placeholder="Rechercher une personne…" value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} />
            <div className="vo-grants-list">
              {members === null || grantedIds === null
                ? <div className="v48-affect-loading">Chargement…</div>
                : filteredMembers.map((member) => <label key={member.id} className="vo-grant-row">
                  <span className="v48-affect-ini">{initials(member.fullName)}</span>
                  <span>{member.fullName}</span>
                  <input type="checkbox" checked={grantedIds.includes(member.id)} disabled={busy !== null} onChange={() => toggleGrant(member)} />
                </label>)}
            </div>
            <p className="vo-grants-note">Seul le détail des échanges est masqué aux non-invités.</p>
          </div>}
          <p className="vo-foot">{account.visibility === 'restricted'
            ? (account.lockedByName ? `Restreint par ${account.lockedByName} · ${formatDate(account.lockedAt)}` : 'Restreint')
            : 'Visible par toute l’organisation'}</p>
        </div>, document.body)}
    </span>
  </div>
}

/** En-tête compte — vraie synthèse identitaire (§10) partagée par Relation et
 *  Signaux : qui est ce compte, quelle relation, qui le porte, comment le
 *  joindre. Pas un simple bandeau technique. */
export function AccountHeader({ data, userId, readOnly, toggleFavorite, refresh }: { data: AccountDetailData; userId: string; readOnly: boolean; toggleFavorite: () => Promise<void>; openPeople: () => void; refresh: () => Promise<void> }) {
  const account = data.account
  return <section className={`hero-header account-detail-hero v48-identity-card ${account.archivedAt ? 'archived' : ''}`}>
    <div className="hero-body v48-identity-body">
      <div className="hero-left v48-identity-left">
        <div className="v48-account-avatar"><ContactAvatar src={account.logoUrl} name={account.name} domain={account.domain} /><i /></div>
        <div className="account-hero-copy v48-identity-copy">
          <div className="v48-eyebrow">Portefeuille →</div>
          <div className="v48-name-row"><h1 className="hero-name">{account.name}<button className={`hero-fav ${account.favorite ? 'on' : ''}`} onClick={() => void toggleFavorite()} aria-label={account.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'} aria-pressed={account.favorite}>
            <svg viewBox="0 0 24 24" fill={account.favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7"><path d="m12 2.5 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9L12 2.5Z" /></svg>
          </button></h1></div>
          <div className="hero-sub"><span>{identitySummary(data)}</span></div>
          <div className="hero-meta v48-account-chips">
            <RelationChip data={data} userId={userId} refresh={refresh} />
          </div>
        </div>
      </div>
      <div className="hero-right v48-identity-right">
        {!readOnly && <AccountOwnerAffectation data={data} userId={userId} refresh={refresh} />}
      </div>
    </div>
  </section>
}

const AcctBuildingIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h2m4 0h2M8 11h2m4 0h2M8 15h2m4 0h2M9 21v-3h6v3" /></svg>

/** Tabs Relation / Signaux, partagés par les deux vues — même barre porte les
 *  connecteurs et l'accès aux coordonnées, pour rester une seule zone de
 *  navigation/identité au-dessus du contenu narratif. */
export function AccountTabs({ activeTab, onChange, readOnly, sources, onOpenCoordinates }: {
  activeTab: 'relation' | 'live'
  onChange: (tab: 'relation' | 'live') => void
  readOnly: boolean
  sources: AccountDetailData['sources']
  onOpenCoordinates: () => void
}) {
  return <nav className="v48-tabs" role="tablist" aria-label="Sections de la fiche compte">
    <button type="button" role="tab" aria-selected={activeTab === 'relation'} className={activeTab === 'relation' ? 'on' : ''} onClick={() => onChange('relation')}>Relation</button>
    <button type="button" role="tab" aria-selected={activeTab === 'live'} className={activeTab === 'live' ? 'on' : ''} onClick={() => onChange('live')}>Signaux</button>
    {!readOnly && <button type="button" className="v48-tabs-action" aria-haspopup="dialog" onClick={onOpenCoordinates}>
      {AcctBuildingIcon} Coordonnées
    </button>}
    <AccountConnectorsPill sources={sources} />
  </nav>
}
