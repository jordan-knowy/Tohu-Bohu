import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { initials } from '../lib/auth'
import { isReadingStale, readingSufficiency } from '../services/strategic-reading'
import { fetchWorkspaceMembers, type WorkspaceMember } from '../person-detail/service'
import { addAccountNote, dismissRecommendationForMe, generateAccountStrategicReading, setRecommendationAssignee, updateRecommendationStatus } from './service'
import type { AccountDetailData, AccountPerson } from './types'
import { WeatherHero, WeatherSection, useAccountBrain } from './AccountWeatherV6'
import { dismissAccountEngagementForMe, resolveAccountEngagement } from '../services/account-brain/accountBrain'
import type { AccountBrainDTO, BrainEngagement } from '../services/account-brain/accountBrain'

// ── Helpers ────────────────────────────────────────────────────────────────
const MONTH_MS = 2_629_746_000

function dateLabel(value: string | null): string {
  if (!value) return 'À confirmer'
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' }).format(d) : 'À confirmer'
}
/** "avril 2024" — utilisé pour la tenue d'un owner, jamais une date fabriquée. */
function monthYearLabel(value: string | null): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(d) : null
}
function relativeLabel(value: string | null): string {
  if (!value) return 'jamais'
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return 'à confirmer'
  const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000))
  return days === 0 ? 'aujourd’hui' : days === 1 ? 'hier' : `il y a ${days} j`
}
/** Bande NPS : promoteur ≥70 (vert), passif 50–69 (ambre), détracteur <50 (corail). */
function band(score: number): string {
  return score >= 70 ? 'var(--sage)' : score >= 50 ? 'var(--amber)' : 'var(--coral)'
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="acr-empty"><span>◇</span><p>{children}</p></div>
}

// ── Pilule Connecteurs (dans la barre d'onglets) ────────────────────────────
function providerColor(provider: string): string {
  const p = provider.toLowerCase()
  if (/google|gmail/.test(p)) return '#DB4437'
  if (/outlook|microsoft|azure/.test(p)) return '#0078D4'
  if (/read/.test(p)) return '#6E50C8'
  if (/linkedin/.test(p)) return '#0A66C2'
  if (/teams/.test(p)) return '#4B53BC'
  if (/hubspot/.test(p)) return '#FF7A59'
  return '#6E50C8'
}
function providerInitial(label: string): string {
  return initials(label).slice(0, 2) || '?'
}
// Logo officiel pour les providers qui en ont un — sinon repli sur l'initiale colorée.
const PROVIDER_LOGO_URL: Record<string, string> = {
  google: 'https://bgmtzwfafcgjklgygvtx.supabase.co/storage/v1/object/public/images%20du%20site/Gmail_icon_(2026).webp',
  gmail: 'https://bgmtzwfafcgjklgygvtx.supabase.co/storage/v1/object/public/images%20du%20site/Gmail_icon_(2026).webp',
  linkedin: 'https://bgmtzwfafcgjklgygvtx.supabase.co/storage/v1/object/public/images%20du%20site/LinkedIn_logo_initials.webp',
  read_ai: 'https://bgmtzwfafcgjklgygvtx.supabase.co/storage/v1/object/public/images%20du%20site/Read-ai-logo.webp',
  'read ai': 'https://bgmtzwfafcgjklgygvtx.supabase.co/storage/v1/object/public/images%20du%20site/Read-ai-logo.webp',
}
function providerLogoUrl(provider: string, label: string): string | null {
  return PROVIDER_LOGO_URL[provider.toLowerCase()] ?? PROVIDER_LOGO_URL[label.toLowerCase()] ?? null
}
const isConnected = (s: AccountDetailData['sources'][number]) => s.status === 'connected' || (s.interactionCount ?? 0) > 0

export function AccountConnectorsPill({ sources }: { sources: AccountDetailData['sources'] }) {
  const ref = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [panel, setPanel] = useState<{ top: number; right: number } | null>(null)
  const show = () => {
    clearTimeout(timer.current)
    const r = ref.current?.getBoundingClientRect()
    if (r) setPanel({ top: r.bottom + 10, right: Math.max(8, window.innerWidth - r.right) })
  }
  const hide = () => { timer.current = setTimeout(() => setPanel(null), 130) }
  if (!sources.length) return null
  const connected = sources.filter(isConnected)
  return (
    <div className="acnx" ref={ref} tabIndex={0} aria-label="Connecteurs du compte" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      <span className="acnx-st" aria-hidden="true">
        {sources.slice(0, 4).map((s, i) => {
          const logo = providerLogoUrl(s.provider, s.label)
          return <i key={i} className={isConnected(s) ? '' : 'off'} style={logo ? undefined : { background: providerColor(s.provider) }}>
            {logo ? <img src={logo} alt="" /> : providerInitial(s.label)}
          </i>
        })}
      </span>
      <span className="acnx-v">{connected.length} connecté{connected.length > 1 ? 's' : ''}</span>
      {panel && createPortal(
        <div className="acnx-p" style={{ top: panel.top, right: panel.right }} role="menu" onMouseEnter={show} onMouseLeave={hide}>
          {sources.map((s, i) => {
            const logo = providerLogoUrl(s.provider, s.label)
            return <div className="acnx-r" key={i} role="menuitem">
              <i className={isConnected(s) ? '' : 'off'} style={logo ? undefined : { background: providerColor(s.provider) }}>
                {logo ? <img src={logo} alt="" /> : providerInitial(s.label)}
              </i>
              <div className="acnx-n">
                <b>{s.label}</b>
                {s.interactionCount != null && <span className="acnx-vol">{s.interactionCount} échange{s.interactionCount > 1 ? 's' : ''}</span>}
                <span className="acnx-note">{isConnected(s) ? 'Connecté' : (s.error || 'Non connecté')}{s.lastSyncedAt ? ` · synchro ${relativeLabel(s.lastSyncedAt)}` : ''}</span>
              </div>
            </div>
          })}
        </div>, document.body)}
    </div>
  )
}

const PeopleIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="8.5" cy="8" r="3" /><path d="M3 19a5.5 5.5 0 0 1 11 0" /><path d="M16 5.4a3 3 0 0 1 0 5.2" /><path d="M17.6 19a5.6 5.6 0 0 0-2.3-4.5" /></svg>
const StrategyIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="10.6" cy="13.4" r="7.4" /><circle cx="10.6" cy="13.4" r="3" /><path d="M13.2 10.8 20 4" /><path d="M16.4 4H20v3.6" /></svg>
const HistoryIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.2" /><path d="M12 7.4V12l3.1 1.9" /></svg>

// ── Ce qu'il faut faire ──────────────────────────────────────────────────────
// Inbox unique du compte (§24) : fusionne les engagements réellement pris
// (account_facts fact_type='commitment', via account_brain) et les mouvements
// recommandés par Tohu (account_recommendations). Un seul système visuel, un
// type par ligne (ENGAGEMENT vs MOUVEMENT), plus jamais deux blocs séparés.
type Rec = AccountDetailData['recommendations'][number]
type ActionEntry =
  | { kind: 'mouvement'; id: string; rec: Rec }
  | { kind: 'engagement'; id: string; eng: BrainEngagement }

const SOURCE_TYPE_LABEL: Record<string, string> = {
  email: 'Mail', meeting: 'Réunion', transcript: 'Transcription', document: 'Document',
  crm: 'CRM', external: 'Signal externe', note: 'Note', signal: 'Signal',
}

/** Échéance réelle → libellé court (§6/§20). Jamais de précision fabriquée :
 *  seule une vraie date (due_window_end/due_at) produit un libellé chiffré. */
function dueLabel(value: string | null, overdueHint: boolean | null): { label: string; overdue: boolean } | null {
  if (!value) return null
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return null
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000)
  const overdue = overdueHint ?? days < 0
  if (overdue) return { label: `en retard de ${Math.max(1, Math.abs(days))} j`, overdue: true }
  if (days === 0) return { label: 'échéance aujourd’hui', overdue: false }
  return { label: `échéance dans ${days} j`, overdue: false }
}

/** Couleur stable par interlocuteur côté client (déduite de son id) — permet de
    distinguer d'un coup d'œil qui porte quoi sans dépendre d'une photo. */
const OWNER_TONES = [
  { border: '#1E7A88', bg: '#E2F4F7' },
  { border: '#D94F63', bg: '#FDEAED' },
  { border: '#C97A20', bg: '#FBF0E2' },
  { border: '#2EA86A', bg: '#E4F5ED' },
]
function ownerTone(id: string): { border: string; bg: string } {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return OWNER_TONES[hash % OWNER_TONES.length]!
}

// ── Avatar « porté par » (Stratégie de compte) ──────────────────────────────
// Par défaut, une action est portée par l'owner de la fiche compte. Cliquer
// sur l'avatar permet de la réaffecter à un membre de l'équipe interne (les
// comptes internes d'organisation déjà en place, voir AccountOwnerAffectation)
// ou à un interlocuteur côté client (data.people) — même mécanique de menu
// que l'affectation d'owner, appliquée ici par action individuelle.
function RecOwnerAvatar({ rec, data, userId, refresh, members, loadMembers }: {
  rec: Rec
  data: AccountDetailData
  userId: string
  refresh: () => Promise<void>
  members: WorkspaceMember[] | null
  loadMembers: () => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      const target = event.target as Node
      if (!btnRef.current?.contains(target) && !popRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])

  const assignedContact = rec.assignedContactId ? data.people.find((p) => p.id === rec.assignedContactId) ?? null : null
  const assignedMember = rec.assignedToUserId ? members?.find((m) => m.id === rec.assignedToUserId) ?? null : null
  const isDefaultOwner = !rec.assignedToUserId && !rec.assignedContactId
  const isYou = rec.assignedToUserId === userId
  // Tant que personne n'a réaffecté la carte, on montre l'interlocuteur dont
  // provient réellement l'information (rec.personId) plutôt que de plaquer
  // systématiquement l'owner de la fiche sur toutes les cartes.
  const sourceContact = isDefaultOwner && rec.personId ? data.people.find((p) => p.id === rec.personId) ?? null : null
  const effectiveContact = assignedContact ?? sourceContact

  const name = effectiveContact?.name ?? assignedMember?.fullName ?? rec.assignedTo ?? data.account.primaryOwnerName ?? 'Owner à confirmer'
  const avatarUrl = effectiveContact?.avatarUrl ?? null
  const tone = effectiveContact ? ownerTone(effectiveContact.id) : null
  const subtitle = effectiveContact
    ? `Côté client${effectiveContact.jobTitle ? ` · ${effectiveContact.jobTitle.toLowerCase()}` : ''}`
    : isDefaultOwner
      ? (isYou ? 'Vous · owner de la fiche' : 'Owner de la fiche')
      : isYou ? 'Vous' : 'Équipe Tohu'

  const toggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 8, left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)) })
    }
    setOpen((value) => !value)
    loadMembers()
  }

  const choose = (assignee: { userId: string | null; contactId: string | null }) => {
    setOpen(false)
    setBusy(true)
    void setRecommendationAssignee(data, rec.id, userId, assignee).then(refresh).finally(() => setBusy(false))
  }

  return (
    <span style={{ position: 'relative', flex: 'none' }}>
      <button ref={btnRef} type="button" className="mv-owner" style={tone ? { borderColor: tone.border, color: tone.border, background: tone.bg } : undefined} title={`Porté par ${name}`} aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={toggle}>
        {avatarUrl ? <img src={avatarUrl} alt="" /> : initials(name)}
      </button>
      {open && pos && createPortal(
        <div ref={popRef} className="mv-owner-pop" role="menu" style={{ top: pos.top, left: pos.left }} onClick={(event) => event.stopPropagation()}>
          <div className="mv-owner-hd">Porté par <b>{name}</b> · {subtitle}</div>
          <div className="mv-owner-grp">Votre équipe</div>
          {members === null
            ? <div className="mv-owner-opt">Chargement…</div>
            : members.map((m) => <button key={m.id} type="button" role="menuitemradio" aria-checked={rec.assignedToUserId === m.id} className={`mv-owner-opt ${rec.assignedToUserId === m.id ? 'on' : ''}`} onClick={() => choose({ userId: m.id, contactId: null })}>
              <span className="mv-owner-ini">{m.avatarUrl ? <img src={m.avatarUrl} alt="" /> : initials(m.fullName)}</span>
              <span className="mv-owner-opt-txt"><span className="mv-owner-opt-name">{m.fullName}</span><span className="mv-owner-opt-sub">{m.id === userId ? 'Vous' : m.id === data.account.primaryOwnerUserId ? 'Owner de la fiche' : 'Équipe Tohu'}</span></span>
              {rec.assignedToUserId === m.id && <span className="mv-owner-opt-check">✓</span>}
            </button>)}
          {data.people.length > 0 && <>
            <div className="mv-owner-grp">Côté client</div>
            {data.people.map((p) => <button key={p.id} type="button" role="menuitemradio" aria-checked={rec.assignedContactId === p.id} className={`mv-owner-opt ${rec.assignedContactId === p.id ? 'on' : ''}`} onClick={() => choose({ userId: null, contactId: p.id })}>
              <span className="mv-owner-ini">{p.avatarUrl ? <img src={p.avatarUrl} alt="" /> : initials(p.name)}</span>
              <span className="mv-owner-opt-txt"><span className="mv-owner-opt-name">{p.name}</span><span className="mv-owner-opt-sub">Côté client{p.jobTitle ? ` · ${p.jobTitle.toLowerCase()}` : ''}</span></span>
              {rec.assignedContactId === p.id && <span className="mv-owner-opt-check">✓</span>}
            </button>)}
          </>}
          {!isDefaultOwner && <button type="button" className="mv-owner-opt mv-owner-reset" onClick={() => choose({ userId: null, contactId: null })}>
            <span className="mv-owner-opt-txt"><span className="mv-owner-opt-name">Réinitialiser</span><span className="mv-owner-opt-sub">Revenir à l’owner de la fiche</span></span>
          </button>}
        </div>, document.body,
      )}
    </span>
  )
}

/** Avatar « porté par » d'un engagement — lecture seule (pas de réaffectation :
 *  le moteur d'engagements n'expose pas cette mécanique, à la différence des
 *  recommandations). Jamais d'owner inventé : contact/membre réels ou état
 *  « non attribué » explicite. */
function EngagementOwner({ eng, data, members }: { eng: BrainEngagement; data: AccountDetailData; members: WorkspaceMember[] | null }) {
  const contact = eng.owner_contact_id ? data.people.find((p) => p.id === eng.owner_contact_id) ?? null : null
  const member = !contact && eng.owner_user_id ? members?.find((m) => m.id === eng.owner_user_id) ?? null : null
  if (contact) {
    const tone = ownerTone(contact.id)
    return <span className="mv-owner" style={{ borderColor: tone.border, color: tone.border, background: tone.bg }} title={`Porté par ${contact.name}`}>
      {contact.avatarUrl ? <img src={contact.avatarUrl} alt="" /> : initials(contact.name)}
    </span>
  }
  if (member) {
    return <span className="mv-owner" title={`Porté par ${member.fullName}`}>
      {member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : initials(member.fullName)}
    </span>
  }
  return <span className="mv-owner unassigned" title="Owner non attribué">?</span>
}

// Une ligne = un mouvement (recommandation Tohu) ou un engagement réellement pris.
// Le « i » déplie la ligne en place (fond lavande léger), comme sur la fiche
// personne (readme : preuves sur les deux fiches) — plus de panneau séparé.
function ActionRow({ item, data, userId, refresh, busy, open, onToggleOpen, onDone, onDismiss, members, loadMembers }: {
  item: ActionEntry
  data: AccountDetailData
  userId: string
  refresh: () => Promise<void>
  busy: boolean
  open: boolean
  onToggleOpen: () => void
  onDone: () => void
  onDismiss: () => void
  members: WorkspaceMember[] | null
  loadMembers: () => void
}) {
  if (item.kind === 'mouvement') {
    const rec = item.rec
    const due = dueLabel(rec.dueAt, null)
    return (
      <article className={`acf-row ${open ? 'open' : ''}`}>
        <span className="acf-type">Mouvement</span>
        <div className="acf-c">
          <div className="acf-h">
            <p className="acf-t">{rec.title}</p>
            <span className="acf-p">prio {rec.priority}</span>
            {due && <span className={`acf-due ${due.overdue ? 'overdue' : ''}`}>{due.label}</span>}
          </div>
          <p className="acf-d">{rec.justification}</p>
          {open && <div className="acf-detail">
            {rec.provenance.observedAt ? <div className="acf-proof-item">
              <p className="acf-proof-meta">{rec.provenance.sourceLabel}{rec.personName ? ` · ${rec.personName}` : ''} · {dateLabel(rec.provenance.observedAt)}</p>
              <p className="acf-proof-q">{rec.justification || rec.recommendedAction || 'Déduit de la dynamique observée sur le compte.'}</p>
            </div> : <p className="acf-empty-proof">Aucune preuve datée disponible pour cet élément.</p>}
          </div>}
        </div>
        <div className="acf-b">
          <RecOwnerAvatar rec={rec} data={data} userId={userId} refresh={refresh} members={members} loadMembers={loadMembers} />
          <button type="button" className="acf-i" aria-expanded={open} title="D’où vient cette action ?" onClick={onToggleOpen}>i</button>
          <button type="button" className="acf-ok" disabled={busy} title="Fait" onClick={onDone}>✓</button>
          <button type="button" className="acf-no" disabled={busy} title="Pas pour moi (reste visible pour l’équipe)" onClick={onDismiss}>×</button>
        </div>
      </article>
    )
  }

  const eng = item.eng
  const due = dueLabel(eng.due_window_end, eng.is_overdue)
  return (
    <article className={`acf-row ${open ? 'open' : ''}`}>
      <span className="acf-type engagement">Engagement</span>
      <div className="acf-c">
        <div className="acf-h">
          <p className="acf-t">{eng.title}</p>
          <span className={`acf-due ${due?.overdue ? 'overdue' : ''}`}>{due?.label ?? 'échéance à confirmer'}</span>
        </div>
        {eng.detail && <p className="acf-d">{eng.detail}</p>}
        {open && <div className="acf-detail">
          {eng.evidence.length ? <div className="acf-proof">{eng.evidence.map((ev, i) => <div className="acf-proof-item" key={i}>
              <p className="acf-proof-meta">{SOURCE_TYPE_LABEL[ev.source_type] ?? ev.source_type}{ev.occurred_at ? ` · ${dateLabel(ev.occurred_at)}` : ''}</p>
              <p className="acf-proof-q">{ev.excerpt || 'Preuve sans extrait disponible.'}</p>
            </div>)}</div>
            : <p className="acf-empty-proof">Aucune preuve datée disponible pour cet élément.</p>}
        </div>}
      </div>
      <div className="acf-b">
        <EngagementOwner eng={eng} data={data} members={members} />
        <button type="button" className="acf-i" aria-expanded={open} title="D’où vient cet engagement ?" onClick={onToggleOpen}>i</button>
        <button type="button" className="acf-ok" disabled={busy} title="Tenu" onClick={onDone}>✓</button>
        <button type="button" className="acf-no" disabled={busy} title="Écarter (reste visible pour l’équipe)" onClick={onDismiss}>×</button>
      </div>
    </article>
  )
}

const ACTIONS_PAGE_SIZE = 4

function ActionsSection({ data, userId, refresh, brain, organizationId }: {
  data: AccountDetailData
  userId: string
  refresh: () => Promise<void>
  brain: AccountBrainDTO | null
  organizationId: string
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [page, setPage] = useState(0)

  const openRecs = useMemo(() => [...data.recommendations].filter((r) => r.status === 'open' || r.status === 'postponed').sort((a, b) => b.priority - a.priority), [data.recommendations])
  const engagements = useMemo(() => brain?.engagements ?? [], [brain])
  // Ordre (§20) : réutilise les données réelles existantes (priorité Tohu, échéance
  // des engagements) — pas de nouvel algorithme de scoring combiné. Les engagements
  // en retard remontent en premier (donnée d'urgence déjà réelle), puis les
  // mouvements par priorité décroissante, puis les engagements à échéance la plus proche.
  const items: ActionEntry[] = useMemo(() => {
    const overdue = engagements.filter((e) => e.is_overdue).sort((a, b) => new Date(a.due_window_end ?? 0).getTime() - new Date(b.due_window_end ?? 0).getTime())
    const upcoming = engagements.filter((e) => !e.is_overdue).sort((a, b) => {
      const ta = a.due_window_end ? new Date(a.due_window_end).getTime() : Infinity
      const tb = b.due_window_end ? new Date(b.due_window_end).getTime() : Infinity
      return ta - tb
    })
    return [
      ...overdue.map((e): ActionEntry => ({ kind: 'engagement', id: e.id, eng: e })),
      ...openRecs.map((r): ActionEntry => ({ kind: 'mouvement', id: r.id, rec: r })),
      ...upcoming.map((e): ActionEntry => ({ kind: 'engagement', id: e.id, eng: e })),
    ]
  }, [engagements, openRecs])

  const loadMembers = () => { if (members === null) void fetchWorkspaceMembers(data.account.workspaceId).then(setMembers).catch(() => setMembers([])) }
  // L'avatar « porté par » d'un engagement n'est jamais interactif (pas de popover
  // à déclencher) : les membres doivent donc être chargés dès qu'un engagement
  // référence un owner interne, pas seulement au clic comme pour les recommandations.
  useEffect(() => { if (engagements.some((e) => e.owner_user_id)) loadMembers() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [engagements])
  useEffect(() => { setPage(0) }, [items.length])

  const pageCount = Math.max(1, Math.ceil(items.length / ACTIONS_PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const shown = items.slice(safePage * ACTIONS_PAGE_SIZE, safePage * ACTIONS_PAGE_SIZE + ACTIONS_PAGE_SIZE)
  const from = items.length === 0 ? 0 : safePage * ACTIONS_PAGE_SIZE + 1
  const to = Math.min(items.length, safePage * ACTIONS_PAGE_SIZE + ACTIONS_PAGE_SIZE)

  const run = (id: string, fn: () => Promise<void>) => { setBusy(id); void fn().then(refresh).finally(() => setBusy(null)) }
  const keyOf = (item: ActionEntry) => `${item.kind}-${item.id}`

  return (
    <section className="sec">
      <div className="sec-h">{StrategyIcon}<p className="sec-t">Ce qu’il faut faire</p><span className="cnt"><b>{items.length}</b> action{items.length > 1 ? 's' : ''}</span></div>
      <div className="sec-b">
        {items.length ? <>
          <div className="acf-list">
            {shown.map((item) => {
              const key = keyOf(item)
              return <ActionRow key={key} item={item} data={data} userId={userId} refresh={refresh}
                busy={busy === item.id} open={openKey === key} onToggleOpen={() => setOpenKey((v) => (v === key ? null : key))}
                onDone={() => item.kind === 'mouvement'
                  ? run(item.id, () => updateRecommendationStatus(data, item.id, userId, 'completed'))
                  : run(item.id, () => resolveAccountEngagement(organizationId, data.account.id, item.id, userId))}
                onDismiss={() => item.kind === 'mouvement'
                  ? run(item.id, () => dismissRecommendationForMe(data, item.id, userId))
                  : run(item.id, () => dismissAccountEngagementForMe(organizationId, data.account.id, item.id, userId))}
                members={members} loadMembers={loadMembers} />
            })}
          </div>
          {pageCount > 1 && <div className="acf-pager">
            <button type="button" disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>← Précédent</button>
            <span>{from}–{to} sur {items.length}</span>
            <button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>Suivant →</button>
          </div>}
        </> : <Empty>Aucune action ouverte n’est identifiée pour ce compte actuellement.</Empty>}
      </div>
    </section>
  )
}

/** Générée à l'ouverture de l'onglet si absente/périmée (>7j), jamais en boucle :
 *  même doctrine que la narrative de score relationnel (cache serveur 7 jours).
 *  Pas de bouton de régénération manuelle dans ce design — l'effet ci-dessous
 *  couvre déjà génération initiale et rafraîchissement automatique. */
function StrategicReadingSection({ data, refresh, brain }: { data: AccountDetailData; refresh: () => Promise<void>; brain: AccountBrainDTO | null }) {
  const reading = data.strategicReading
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const attempted = useRef(false)

  const counts = useMemo(() => readingSufficiency({
    contacts: data.people.length, signals: data.signals.length, interactions: data.relationship.totalInteractions, messages: 0,
  }), [data.people.length, data.signals.length, data.relationship.totalInteractions])

  useEffect(() => {
    if (attempted.current || generating) return
    if (reading && !isReadingStale(reading.generatedAt, new Date())) return
    attempted.current = true
    setGenerating(true); setError(null)
    void generateAccountStrategicReading(data, false).then(refresh)
      .catch((err) => setError(err instanceof Error ? err.message : 'Génération impossible.'))
      .finally(() => setGenerating(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading?.generatedAt])

  // Faits clés / alertes (§ maquette) : seul le risque le plus prioritaire (le
  // premier renvoyé par la synthèse) porte le ton « alerte » rouge/corail — les
  // autres risques, forces et prochaines actions restent en ton neutre
  // violet/lavande sombre. Jamais toutes les observations négatives en rouge.
  // Capé à 4 pills pour rester aéré, jamais la liste complète.
  const pills = reading ? [
    ...reading.risques.slice(0, 1).map((text) => ({ text, alert: true })),
    ...reading.risques.slice(1).map((text) => ({ text, alert: false })),
    ...reading.forces.map((text) => ({ text, alert: false })),
    ...reading.prochainesActions.map((text) => ({ text, alert: false })),
  ].slice(0, 4) : []

  return (
    <section className="r2card">
      <div className={`r2card-b ${brain?.weather?.status === 'available' ? 'has-hero' : ''}`}>
        <div className="r2card-l">
          <p className="r2card-lbl">Où on en est · {dateLabel(reading?.generatedAt ?? data.generatedAt)}</p>
          {reading ? <>
            <p className="r2card-synth">{reading.synthese}</p>
            {pills.length > 0 && <div className="r2card-pills">{pills.map((p, i) => <span key={i} className={`r2card-pill ${p.alert ? 'alert' : ''}`} title={p.text}>{p.text}</span>)}</div>}
          </> : generating ? <p className="r2card-empty">Génération de la lecture stratégique…</p>
          : !counts.sufficient ? <p className="r2card-empty">Données insuffisantes pour établir une synthèse fiable.</p>
          : <p className="r2card-empty">{error ?? 'Lecture en construction.'}</p>}
        </div>
        <WeatherHero brain={brain} />
      </div>
    </section>
  )
}

// ── Historique & mémoire ─────────────────────────────────────────────────────
type Moment = { id: string; date: string | null; impact: 'renf' | 'frict' | 'jalon' | 'neut'; label: string; title: string; meta: string | null; avatarLabel: string | null }
const IMPACT_LABEL: Record<Moment['impact'], string> = { renf: 'Renforce', frict: 'Friction', jalon: 'Jalon', neut: 'Contexte' }
const BRAIN_IMPACT_TO_MOMENT: Record<string, Moment['impact']> = { friction: 'frict', reinforce: 'renf', milestone: 'jalon', neutral: 'neut' }

function momentsFrom(data: AccountDetailData, brain: AccountBrainDTO | null): Moment[] {
  const fromSignals: Moment[] = data.signals.map((s) => {
    const text = `${s.type} ${s.title} ${s.summary ?? ''}`.toLowerCase()
    const impact: Moment['impact'] = /risqu|churn|friction|retard|silence|perte|départ|insatisf/.test(text) ? 'frict'
      : /gagn|sign|renouv|expansion|avancé|accord|livr/.test(text) ? 'renf' : 'jalon'
    const person = s.personId ? data.people.find((p) => p.id === s.personId) ?? null : null
    return { id: `sig-${s.id}`, date: s.provenance.observedAt, impact, label: s.title, title: s.title, meta: s.summary ?? s.impact ?? s.provenance.sourceLabel, avatarLabel: person ? initials(person.name) : null }
  })
  const fromMemory: Moment[] = data.memoryEntries.map((m) => ({ id: `mem-${m.id}`, date: m.createdAt, impact: 'neut', label: m.content, title: m.content, meta: `${m.entryType} · ${m.authorName}`, avatarLabel: initials(m.authorName) }))
  // Engagements tenus/écartés (account_brain.history) : un engagement RESOLVED
  // retiré de « Ce qu'il faut faire » réapparaît ici comme moment réel — jamais
  // un événement fabriqué pour combler la timeline.
  const fromBrain: Moment[] = (brain?.history ?? []).map((h) => ({
    id: `fact-${h.id}`, date: h.occurred_at, impact: BRAIN_IMPACT_TO_MOMENT[h.impact ?? ''] ?? 'neut',
    label: h.title, title: h.title, meta: h.status === 'resolved' ? 'Engagement tenu' : h.status, avatarLabel: null,
  }))
  return [...fromSignals, ...fromMemory, ...fromBrain].filter((m) => m.date).sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime())
}

const FILTERABLE_IMPACTS: Moment['impact'][] = ['renf', 'frict']
const CloseIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>

function MomentCard({ moment, onDismiss }: { moment: Moment; onDismiss?: () => void }) {
  return <div className={`kmi ${moment.impact}`}>
    {onDismiss && <button type="button" className="kmi-x" title="Écarter ce moment" aria-label="Écarter ce moment de l’historique" onClick={onDismiss}>{CloseIcon}</button>}
    <span className="kmi-d">{dateLabel(moment.date)}</span>
    <span className="kmi-p" aria-hidden="true" />
    <div className="kmi-c"><p className="kmi-t">{moment.title}</p>{moment.meta && <p className="kmi-s">{moment.meta}</p>}</div>
    {moment.avatarLabel && <span className="kmi-av" title={moment.avatarLabel}>{moment.avatarLabel}</span>}
    <span className="kmi-e">{IMPACT_LABEL[moment.impact]}</span>
  </div>
}

function HistorySection({ data, userId, refresh, brain }: { data: AccountDetailData; userId: string; refresh: () => Promise<void>; brain: AccountBrainDTO | null }) {
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [filter, setFilter] = useState<'all' | Moment['impact']>('all')
  // Écarter un moment : pas de colonne d'archivage côté company_signals/mémoire
  // aujourd'hui, donc masquage pour la session seulement (même doctrine que
  // HistoryCard côté fiche Personne, voir person-detail/sections2.tsx).
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())

  // « Qui a porté la relation » : liste des owners réellement rattachés aux
  // contacts du compte, le dernier de la liste = owner actuel. Pas de table
  // de passation datée en base — la période affichée reste donc « à confirmer »
  // dès qu'il y a eu plus d'un owner, jamais une date inventée (§9).
  const owners = useMemo(() => {
    const list = [...new Set(data.people.map((p) => p.ownerName).filter((x): x is string => !!x))]
    if (data.account.primaryOwnerName && !list.includes(data.account.primaryOwnerName)) list.push(data.account.primaryOwnerName)
    return list
  }, [data.people, data.account.primaryOwnerName])
  const currentOwner = owners.length ? owners[owners.length - 1]! : null
  const passationCount = Math.max(0, owners.length - 1)
  const tenureSubtitle = currentOwner
    ? owners.length <= 1
      ? monthYearLabel(data.account.relationshipStartedAt) ? `depuis ${monthYearLabel(data.account.relationshipStartedAt)} · seul porteur` : 'seul porteur'
      : `${owners.length} porteurs successifs`
    : null

  const moments = useMemo(() => momentsFrom(data, brain), [data, brain])
  const visible = useMemo(() => moments.filter((m) => !dismissedIds.has(m.id)), [moments, dismissedIds])
  const filtered = filter === 'all' ? visible : visible.filter((m) => m.impact === filter)
  const shown = expanded ? filtered : filtered.slice(0, 5)
  const rest = filtered.length - shown.length

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!content.trim()) return
    setSaving(true)
    try { await addAccountNote(data, userId, content.trim()); setContent(''); await refresh() } finally { setSaving(false) }
  }

  return (
    <section className="sec">
      <div className="sec-h">
        <span className="hm-i">{HistoryIcon}</span><p className="sec-t">Historique &amp; mémoire du compte</p>
        <span className="memc">{data.memoryEntries.length} engagement{data.memoryEntries.length > 1 ? 's' : ''} en mémoire</span>
        <button type="button" className="hm-collapse" aria-expanded={!collapsed} onClick={() => setCollapsed((v) => !v)}>{collapsed ? 'Déplier ↓' : 'Replier ↑'}</button>
      </div>
      {!collapsed && <div className="sec-b">
        {currentOwner && <div className="rl">
          <span className="rl-a">{initials(currentOwner)}</span>
          <div className="rl-c">
            <p className="rl-n">{currentOwner}<span className="rl-dot" aria-hidden="true" /></p>
            {tenureSubtitle && <p className="rl-p">{tenureSubtitle}</p>}
          </div>
          <span className="rl-k">{passationCount} passation{passationCount > 1 ? 's' : ''}</span>
        </div>}

        <p className="km-l">Ce qui s’est passé — événements étiquetés {visible.length > 0 && <span className="km-n">{visible.length}</span>}</p>
        {moments.length > 0 && <div className="hm-flt" role="tablist" aria-label="Filtrer les moments par type">
          <button type="button" role="tab" aria-selected={filter === 'all'} className={`mvp-b ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>Tout</button>
          {FILTERABLE_IMPACTS.map((impact) => <button key={impact} type="button" role="tab" aria-selected={filter === impact} className={`mvp-b ${filter === impact ? 'on' : ''}`} onClick={() => setFilter(impact)}>{IMPACT_LABEL[impact]}</button>)}
        </div>}
        {filtered.length ? <>
          <div className="km">
            {shown.map((m) => <MomentCard key={m.id} moment={m} onDismiss={m.id.startsWith('sig-') ? () => setDismissedIds((ids) => new Set(ids).add(m.id)) : undefined} />)}
          </div>
          {rest > 0 && <button className="mvp-b" style={{ margin: '14px auto 0', display: 'block' }} onClick={() => setExpanded((v) => !v)}>{expanded ? 'Réduire' : `En savoir + (${rest})`}</button>}
        </> : <Empty>{moments.length ? 'Aucun moment de ce type.' : 'L’histoire du compte se construira à partir des signaux, notes et interactions persistés.'}</Empty>}

        <form onSubmit={(e) => void submit(e)}>
          <textarea className="hm-x" value={content} onChange={(e) => setContent(e.target.value)} placeholder="Ex : Christèle part en congés début mai, passer par Tanguy sur les OS." />
          <div className="hm-r"><button className="hm-p" disabled={saving || !content.trim()}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button></div>
        </form>
      </div>}
    </section>
  )
}

// ── Organigramme (Personnes) ─────────────────────────────────────────────────
// Rôle d'interlocuteur → libellé maquette (Décideur, Filtre, Prescripteur, Utilisateur…).
const ROLE_LABELS: Record<string, string> = {
  decision_maker: 'Décideur', decideur: 'Décideur', economic_buyer: 'Décideur',
  gatekeeper: 'Filtre · Gatekeeper', filtre: 'Filtre · Gatekeeper',
  influencer: 'Prescripteur · Influenceur', prescripteur: 'Prescripteur · Influenceur', prescriber: 'Prescripteur · Influenceur',
  user: 'Utilisateur', utilisateur: 'Utilisateur', end_user: 'Utilisateur',
  champion: 'Champion', sponsor: 'Sponsor', buyer: 'Acheteur', technical: 'Référent technique',
}
function roleLabel(person: AccountPerson): string {
  const raw = person.decisionRole || person.relationshipRole || person.organizationalRole
  if (!raw) return 'À confirmer'
  return ROLE_LABELS[raw.toLowerCase()] ?? raw.replaceAll('_', ' ')
}
// Couleur vive du badge de rôle — un ton par famille, indépendant du score
// relationnel (qui colore déjà la bordure de la carte via --person-tone). Le
// scoring V6 utilise Décideur/Influenceur/Utilisateur/Filtre : on ne force pas
// Sponsor/Champion dans ce mapping sans décision produit explicite (§19).
const ROLE_TONES: Record<string, string> = {
  decision_maker: 'var(--teal)', decideur: 'var(--teal)', economic_buyer: 'var(--teal)',
  gatekeeper: 'var(--coral)', filtre: 'var(--coral)',
  influencer: 'var(--violet)', prescripteur: 'var(--violet)', prescriber: 'var(--violet)',
  user: 'var(--sage)', utilisateur: 'var(--sage)', end_user: 'var(--sage)',
  champion: 'var(--violet)', sponsor: 'var(--teal)', buyer: 'var(--amber)', technical: 'var(--t3)',
}
function roleTone(person: AccountPerson): string {
  const raw = person.decisionRole || person.relationshipRole || person.organizationalRole
  return raw ? ROLE_TONES[raw.toLowerCase()] ?? 'var(--t3)' : 'var(--t3)'
}

function StakeholderSection({ people, navigate }: { people: AccountPerson[]; navigate: (path: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const sorted = useMemo(() => [...people].sort((a, b) => (b.exchangeShare ?? -1) - (a.exchangeShare ?? -1)), [people])
  const shown = expanded ? sorted : sorted.slice(0, 4)
  const rest = sorted.length - shown.length
  return (
    <section className="sec">
      <div className="sec-h">{PeopleIcon}<p className="sec-t">Organigramme</p><span className="cnt"><b>{sorted.length}</b> interlocuteur{sorted.length > 1 ? 's' : ''}</span></div>
      <div className="sec-b">
        {!sorted.length ? <Empty>Aucun interlocuteur suffisamment identifié pour ce compte.</Empty> : <>
          <div className="og-grid">{shown.map((person) => {
            const tone = roleTone(person)
            return <button type="button" className="og-t" key={person.id} onClick={() => navigate(`/app/people/${person.id}`)} style={{ '--rc': tone } as CSSProperties}>
              <span className="og-r">{roleLabel(person)}</span>
              <div className="og-row"><p className="nm">{person.name}</p><span className="v" style={{ color: person.score === null ? 'var(--pale)' : band(person.score) }}>{person.score ?? '—'}</span></div>
              <p className="og-sh">{person.exchangeShare === null ? 'part à confirmer' : <>~<b>{person.exchangeShare}%</b> des échanges</>}</p>
              {person.jobTitle && <p className="og-dl">{person.jobTitle}</p>}
            </button>
          })}</div>
          {rest > 0 && <button type="button" className="mvp-b" style={{ margin: '14px auto 0', display: 'block' }} onClick={() => setExpanded(true)}>Voir {rest} interlocuteur{rest > 1 ? 's' : ''} de plus ▾</button>}
          {expanded && sorted.length > 4 && <button type="button" className="mvp-b" style={{ margin: '14px auto 0', display: 'block' }} onClick={() => setExpanded(false)}>Réduire ▴</button>}
        </>}
      </div>
    </section>
  )
}

// ── Vue Relation ─────────────────────────────────────────────────────────────
export function AccountRelationView({ data, userId, currentUserName, refresh, navigate, organizationId, v6Enabled }: {
  data: AccountDetailData
  userId: string
  currentUserName: string
  refresh: () => Promise<void>
  navigate: (path: string) => void
  organizationId: string
  v6Enabled: boolean
}) {
  const brain = useAccountBrain(organizationId, data.account.id, v6Enabled)
  // Ordre narratif (brief refonte fiche Compte) : où on en est → météo → ce qui
  // a changé récemment → organigramme → ce qu'il faut faire (engagements +
  // mouvements fusionnés, §24) → mémoire relationnelle. Une seule colonne — la
  // hiérarchie vient de l'ordre de lecture, pas d'une grille de dashboard. Les
  // sections V6 (météo/changement récent/engagements) ne s'affichent que
  // derrière le flag scoring_v6_ui et seulement une fois account_brain chargé —
  // jamais un état intermédiaire fabriqué pendant le chargement ; sans le
  // flag, « Ce qu'il faut faire » ne montre que les mouvements Tohu (les
  // engagements ne viennent que de account_brain).
  return (
    <div className="acr">
      <StrategicReadingSection data={data} refresh={refresh} brain={v6Enabled ? brain : null} />
      {v6Enabled && brain && <WeatherSection brain={brain} />}
      <StakeholderSection people={data.people} navigate={navigate} />
      <ActionsSection data={data} userId={userId} refresh={refresh} brain={v6Enabled ? brain : null} organizationId={organizationId} />
      <HistorySection data={data} userId={userId} refresh={refresh} brain={v6Enabled ? brain : null} />
    </div>
  )
}

export type { AccountPerson as _AccountPerson }
