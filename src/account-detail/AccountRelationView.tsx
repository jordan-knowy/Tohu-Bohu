import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode, SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { initials } from '../lib/auth'
import { isReadingStale, readingSufficiency } from '../services/strategic-reading'
import { fetchWorkspaceMembers, type WorkspaceMember } from '../person-detail/service'
import { addAccountNote, generateAccountStrategicReading, setRecommendationAssignee, updateRecommendationStatus } from './service'
import type { AccountDetailData, AccountPerson } from './types'

// ── Helpers ────────────────────────────────────────────────────────────────
const MONTH_MS = 2_629_746_000

function dateLabel(value: string | null): string {
  if (!value) return 'À confirmer'
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' }).format(d) : 'À confirmer'
}
function relativeLabel(value: string | null): string {
  if (!value) return 'jamais'
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return 'à confirmer'
  const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000))
  return days === 0 ? 'aujourd’hui' : days === 1 ? 'hier' : `il y a ${days} j`
}
function tenureLabel(value: string | null): string {
  if (!value) return '—'
  const start = new Date(value)
  if (!Number.isFinite(start.getTime())) return '—'
  const months = Math.max(0, Math.floor((Date.now() - start.getTime()) / MONTH_MS))
  if (months < 12) return `${months} mois`
  return `~${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(months / 12)} ans`
}
/** Bande NPS : promoteur ≥70 (vert), passif 50–69 (ambre), détracteur <50 (corail). */
function band(score: number): string {
  return score >= 70 ? 'var(--sage)' : score >= 50 ? 'var(--amber)' : 'var(--coral)'
}

function quartile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const next = sorted[base + 1]
  return Math.round(next === undefined ? sorted[base]! : sorted[base]! + (pos - base) * (next - sorted[base]!))
}
/** Fourchette réellement observée (Q1–Q3) sur l'historique — jamais inventée. */
function observedScoreRange(scores: number[]): { q1: number; q3: number } | null {
  const clean = scores.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (clean.length < 5) return null
  const q1 = quartile(clean, 0.25)
  const q3 = quartile(clean, 0.75)
  return q3 > q1 ? { q1, q3 } : null
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="acr-empty"><span>◇</span><p>{children}</p></div>
}

const MONTH_NAMES = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
function monthLabel(key: number): string { const y = Math.floor(key / 12); const m = ((key % 12) + 12) % 12; return `${MONTH_NAMES[m]} ${String(y).slice(2)}` }
type MonthBar = { label: string; score: number | null }

/** Une barre par MOIS sur la fenêtre choisie (6/12/36) — score = moyenne des
 *  snapshots du mois, `null` = mois sans donnée (barre grise). C'est ce qui rend
 *  le toggle 6/12/36 réellement fonctionnel et différent d'un compte à l'autre. */
function buildMonthlyBars(history: Array<{ score: number; computedAt: string }>, windowMonths: number): MonthBar[] {
  const byMonth = new Map<number, { sum: number; n: number }>()
  for (const h of history) {
    const d = new Date(h.computedAt)
    if (!Number.isFinite(d.getTime())) continue
    const key = d.getUTCFullYear() * 12 + d.getUTCMonth()
    const e = byMonth.get(key) ?? { sum: 0, n: 0 }
    e.sum += h.score; e.n++; byMonth.set(key, e)
  }
  const now = new Date()
  const lastKey = now.getUTCFullYear() * 12 + now.getUTCMonth()
  const bars: MonthBar[] = []
  for (let i = windowMonths - 1; i >= 0; i--) {
    const e = byMonth.get(lastKey - i)
    bars.push({ label: monthLabel(lastKey - i), score: e ? Math.round(e.sum / e.n) : null })
  }
  return bars
}

type Tip = { left: number; top: number; above: boolean; content: ReactNode }
function useTip() {
  const [tip, setTip] = useState<Tip | null>(null)
  const show = (e: SyntheticEvent, content: ReactNode) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const above = r.top > 160
    const left = Math.min(Math.max(8, r.left + r.width / 2 - 100), (typeof window !== 'undefined' ? window.innerWidth : 1200) - 208)
    setTip({ left, top: above ? r.top - 8 : r.bottom + 8, above, content })
  }
  const hide = () => setTip(null)
  const node = tip ? createPortal(<div className="v48-tipx" style={{ left: tip.left, top: tip.top, transform: tip.above ? 'translateY(-100%)' : 'none' }}>{tip.content}</div>, document.body) : null
  return { show, hide, node }
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

// ── Santé du compte ─────────────────────────────────────────────────────────
const PulseIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.4 12h4.2l2-5.2 3.4 10.4 2.2-5.2h5.4" /></svg>
const PeopleIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="8.5" cy="8" r="3" /><path d="M3 19a5.5 5.5 0 0 1 11 0" /><path d="M16 5.4a3 3 0 0 1 0 5.2" /><path d="M17.6 19a5.6 5.6 0 0 0-2.3-4.5" /></svg>
const StrategyIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="10.6" cy="13.4" r="7.4" /><circle cx="10.6" cy="13.4" r="3" /><path d="M13.2 10.8 20 4" /><path d="M16.4 4H20v3.6" /></svg>
const HistoryIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.2" /><path d="M12 7.4V12l3.1 1.9" /></svg>

function HealthSection({ data, currentUserName, onOpenModal }: { data: AccountDetailData; currentUserName: string; onOpenModal: () => void }) {
  const [segMonths, setSegMonths] = useState(12)
  const rel = data.relationship

  const tip = useTip()
  // Barres = santé mensuelle reconstruite, fenêtre PLEINE : 6/12/36 affiche
  // toujours 6/12/36 barres (mois sans donnée = barre grise), les barres
  // s'affinent automatiquement selon leur nombre (voir CSS .chart). Repli sur
  // les snapshots account bruts si la RPC n'a rien renvoyé.
  const bars = useMemo(() => {
    const series = rel.monthlyHealth
    if (series.length) {
      return series.slice(-segMonths).map((m) => {
        const [y, mo] = m.ym.split('-').map(Number)
        return { label: monthLabel((y ?? 0) * 12 + ((mo ?? 1) - 1)), score: m.score }
      })
    }
    return buildMonthlyBars(rel.history, segMonths)
  }, [rel.monthlyHealth, rel.history, segMonths])
  const scoreRange = useMemo(() => observedScoreRange(bars.map((b) => b.score).filter((s): s is number => s !== null)), [bars])
  const real = bars.filter((b) => b.score !== null)
  let lastRealIdx = -1
  for (let i = 0; i < bars.length; i++) if (bars[i]!.score !== null) lastRealIdx = i
  const windowDelta = real.length >= 2 ? (real[real.length - 1]!.score! - real[0]!.score!) : null
  const barTip = (b: MonthBar) => <><p className="v48-tipx-t">Score du compte</p><p className="v48-tipx-d">{b.label} · {b.score === null ? <b>pas encore de données</b> : <><b>{b.score}</b>/100</>}</p></>

  // Répartition par interlocuteur : contacts scorés, triés desc.
  const contributors = useMemo(() => [...data.people].filter((p) => p.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 8), [data.people])

  // Couverture interne : membres internes (owners des contacts) + leur score
  // relationnel agrégé avec CE compte (moyenne de leurs contacts scorés ici).
  const coverage = useMemo(() => {
    const byOwner = new Map<string, number[]>()
    for (const p of data.people) {
      if (!p.ownerName || p.score === null) continue
      byOwner.set(p.ownerName, [...(byOwner.get(p.ownerName) ?? []), p.score])
    }
    const me = (currentUserName || '').trim().toLowerCase()
    return [...byOwner.entries()]
      .map(([name, scores]) => ({ name, score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length), isMe: !!me && name.trim().toLowerCase() === me }))
      .sort((a, b) => (b.isMe ? 1 : 0) - (a.isMe ? 1 : 0) || b.score - a.score)
  }, [data.people, currentUserName])

  return (
    <section className="sec">
      <div className="sec-h">{PulseIcon}<p className="sec-t">Santé du compte</p>
        <button className="det" onClick={onOpenModal} aria-label="Comment le score est calculé">i</button>
      </div>
      <div className="sec-b">
        <div className="cpt-top">
          <p className="big">{rel.score ?? '—'}</p>
          <p className="cpt-per">
            <span>{segMonths} mois</span>
            {windowDelta !== null && <span>{windowDelta >= 0 ? `↗ +${windowDelta}` : `↘ ${windowDelta}`} pts</span>}
          </p>
          <div className="seg">
            {[6, 12, 36].map((m) => <span key={m} className={segMonths === m ? 'on' : ''} onClick={() => setSegMonths(m)}>{m} M</span>)}
          </div>
        </div>

        {real.length >= 1 ? <>
          <div className="chart" style={{ gap: bars.length > 24 ? 2 : bars.length > 10 ? 4 : 6 }}>{bars.map((b, i) => b.score === null
            ? <i key={i} className="empty" style={{ height: '7%', background: '#E3DEF2' }} title={`${b.label} · pas encore de données`} />
            : <i key={i} tabIndex={0}
                style={{ height: `${Math.max(5, b.score)}%`, background: i === lastRealIdx ? 'linear-gradient(180deg,#C97A20,#DFA153)' : 'linear-gradient(180deg,#3FAEBE,#2896A8)' }}
                onMouseEnter={(e) => tip.show(e, barTip(b))} onFocus={(e) => tip.show(e, barTip(b))} onMouseLeave={tip.hide} onBlur={tip.hide} />)}</div>
          <div className="ch-x"><span>{bars[0]!.label}</span><span>{bars[bars.length - 1]!.label}</span></div>
        </> : <Empty>L’évolution du score apparaîtra après plusieurs calculs persistés.</Empty>}
        {tip.node}

        <div className="cpt-mini">
          <span><b>{tenureLabel(data.account.relationshipStartedAt)}</b> d’ancienneté</span>
          <span><b>{rel.totalInteractions || '—'}</b> échanges</span>
          <span><b>{data.people.length}</b> contacts</span>
          {scoreRange && <span title="Fourchette réellement observée sur l’historique du score (Q1–Q3) — pas une prédiction.">fourchette <b>{scoreRange.q1}–{scoreRange.q3}</b></span>}
        </div>
        {windowDelta !== null && <span className={`evo ${windowDelta < 0 ? 'down' : 'up'}`}>{windowDelta < 0 ? '↘' : '↗'} {windowDelta >= 0 ? `+${windowDelta}` : windowDelta} pts <em>sur {segMonths} mois</em></span>}

        <p className="xl">Répartition par interlocuteur</p>
        {contributors.length ? <>
          {contributors.map((p) => <div className="cnb" key={p.id}>
            <span className="cnb-n">{p.name}</span>
            <span className="cnb-t"><i className="cnb-z" style={{ left: '50%' }} /><i className="cnb-z" style={{ left: '70%' }} /><i className="cnb-f" style={{ width: `${p.score}%`, background: band(p.score ?? 0) }} /></span>
            <span className="cnb-v" style={{ color: band(p.score ?? 0) }}>{p.score}</span>
          </div>)}
          <p className="cnl"><span><i style={{ background: 'var(--coral)' }} />Détracteur &le;50</span><span><i style={{ background: 'var(--amber)' }} />Passif 50–69</span><span><i style={{ background: 'var(--sage)' }} />Promoteur &ge;70</span></p>
        </> : <Empty>Aucun score individuel mesurable pour ce compte.</Empty>}

        <div className="lvs">
          <p className="lvs-h"><i className="lvs-i" />Dernière synchronisation : <b>{relativeLabel(rel.computedAt)}</b></p>
          <span className="lvs-bar" />
        </div>

        <div className="cvi">
          <div className="cvi-h">{PeopleIcon}<p className="cvi-t">Couverture interne</p><span className="cvi-n">{coverage.length} membre{coverage.length > 1 ? 's' : ''}</span></div>
          {coverage.length ? coverage.map((m) => <div className={`cvi-row ${m.isMe ? 'me' : ''}`} key={m.name}>
            <span className="cvi-av">{m.isMe ? 'MOI' : initials(m.name)}</span>
            <span className="cvi-nm">{m.isMe ? 'Vous' : m.name}</span>
            <span className="cvi-sc" style={{ color: band(m.score) }}>{m.score}</span>
          </div>) : <div className="cvi-row"><span className="cvi-nm" style={{ color: 'var(--pale)', fontWeight: 400 }}>Aucun membre interne rattaché aux contacts de ce compte.</span></div>}
        </div>
      </div>
    </section>
  )
}

// ── Stratégie de compte (carrousel) ─────────────────────────────────────────
const PAGE = 5
type Rec = AccountDetailData['recommendations'][number]

/** Habillage visuel par catégorie — la donnée reste un texte libre côté back
    (account_recommendations.category), on ne mappe ici que le rendu. */
const CATEGORY_META: Record<string, { label: string; tone: string }> = {
  mouvement: { label: 'Mouvement', tone: 'violet' },
  engagement: { label: 'Engagement', tone: 'sage' },
  relance: { label: 'Relance', tone: 'amber' },
  opportunite: { label: 'Opportunité', tone: 'sage' },
  couverture: { label: 'Couverture', tone: 'teal' },
  validation: { label: 'Validation', tone: 'teal' },
  ownership: { label: 'Ownership', tone: 'violet' },
  risque: { label: 'Risque', tone: 'coral' },
  risque_churn: { label: 'Risque de churn', tone: 'coral' },
  risque_concentration: { label: 'Concentration', tone: 'coral' },
  lecture_strategique: { label: 'Lecture stratégique', tone: 'violet' },
}
function categoryMeta(category: string): { label: string; tone: string } {
  return CATEGORY_META[category] ?? { label: category.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), tone: 'violet' }
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

// Une carte action = mouvement/engagement. Le « i » déplie la preuve (canal ·
// date · pourquoi), comme sur la fiche personne (readme : preuves sur les deux fiches).
function StrategyCard({ rec, data, userId, refresh, busy, act, members, loadMembers }: {
  rec: Rec
  data: AccountDetailData
  userId: string
  refresh: () => Promise<void>
  busy: boolean
  act: (status: 'completed' | 'dismissed') => void
  members: WorkspaceMember[] | null
  loadMembers: () => void
}) {
  const [proof, setProof] = useState(false)
  const meta = categoryMeta(rec.category)
  return (
    <article className="mv">
      <span className={`mv-s ${meta.tone}`}>{meta.label}</span>
      <div className="mv-c">
        <div className="mv-h"><p className="mv-t">{rec.title}</p><span className="mv-p">prio {rec.priority}</span></div>
        <p className="mv-d">{rec.justification}</p>
        {rec.recommendedAction && <p className="mv-d"><b style={{ color: 'var(--ink)' }}>{rec.recommendedAction}</b></p>}
        <p className="mv-src">↳ {rec.provenance.sourceLabel}{rec.personName ? ` · ${rec.personName}` : ''}</p>
        {proof && <div className="mv-proof">
          <div className="mv-proof-meta"><span>{rec.provenance.sourceLabel}</span>{rec.provenance.observedAt && <span>· {dateLabel(rec.provenance.observedAt)}</span>}{rec.provenance.confidence !== null && <span>· confiance {rec.provenance.confidence}%</span>}</div>
          <p className="mv-proof-q"><span className="mv-proof-l">Pourquoi</span>{rec.justification || rec.recommendedAction || 'Déduit de la dynamique observée sur le compte.'}</p>
        </div>}
      </div>
      <div className="mv-b">
        <RecOwnerAvatar rec={rec} data={data} userId={userId} refresh={refresh} members={members} loadMembers={loadMembers} />
        <button className="mv-i" aria-expanded={proof} title="D’où vient cette action ?" onClick={() => setProof((v) => !v)}>i</button>
        <button className="mv-ok" disabled={busy} title="Fait" onClick={() => act('completed')}>✓</button>
        <button className="mv-no" disabled={busy} title="Écarter" onClick={() => act('dismissed')}>×</button>
      </div>
    </article>
  )
}

function StrategySection({ data, userId, refresh }: { data: AccountDetailData; userId: string; refresh: () => Promise<void> }) {
  const open = useMemo(() => data.recommendations.filter((r) => r.status === 'open' || r.status === 'postponed').sort((a, b) => b.priority - a.priority), [data.recommendations])
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null)
  const pages = Math.max(1, Math.ceil(open.length / PAGE))
  const current = open.slice(page * PAGE, page * PAGE + PAGE)
  const act = (id: string) => async (status: 'completed' | 'dismissed') => {
    setBusy(id)
    try { await updateRecommendationStatus(data, id, userId, status); await refresh() } finally { setBusy(null) }
  }
  const loadMembers = () => { if (members === null) void fetchWorkspaceMembers(data.account.workspaceId).then(setMembers).catch(() => setMembers([])) }
  return (
    <section className="sec">
      <div className="sec-h">{StrategyIcon}<p className="sec-t">Stratégie de compte</p><span className="cnt"><b>{open.length}</b> action{open.length > 1 ? 's' : ''}</span></div>
      <div className="sec-b">
        {open.length ? <>
          <div className="mvs">
            {current.map((r) => <StrategyCard key={r.id} rec={r} data={data} userId={userId} refresh={refresh} busy={busy === r.id} act={(status) => void act(r.id)(status)} members={members} loadMembers={loadMembers} />)}
          </div>
          {pages > 1 && <div className="mvp">
            <button className="mvp-b" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>← Précédent</button>
            <span className="mvp-i">{page * PAGE + 1}–{Math.min(open.length, page * PAGE + PAGE)} sur {open.length}</span>
            <button className="mvp-b" disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}>Suivant →</button>
          </div>}
        </> : <Empty>Aucune recommandation stratégique ouverte n’est étayée actuellement.</Empty>}
      </div>
    </section>
  )
}

// ── Lecture stratégique (synthèse IA bornée aux données persistées) ─────────
const ReadingIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 4h9l4 4v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" /><path d="M9 12h7M9 15.5h7M9 8.5h4" /></svg>

/** Générée à l'ouverture de l'onglet si absente/périmée (>7j), jamais en boucle :
 *  même doctrine que la narrative de score relationnel (cache serveur 7 jours). */
function StrategicReadingSection({ data, refresh }: { data: AccountDetailData; refresh: () => Promise<void> }) {
  const reading = data.strategicReading
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const attempted = useRef(false)

  const counts = useMemo(() => readingSufficiency({
    contacts: data.people.length, signals: data.signals.length, interactions: data.relationship.totalInteractions, messages: 0,
  }), [data.people.length, data.signals.length, data.relationship.totalInteractions])

  const run = async (force: boolean) => {
    setGenerating(true); setError(null)
    try { await generateAccountStrategicReading(data, force); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : 'Génération impossible.') }
    finally { setGenerating(false) }
  }

  useEffect(() => {
    if (attempted.current || generating) return
    if (reading && !isReadingStale(reading.generatedAt, new Date())) return
    attempted.current = true
    void run(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading?.generatedAt])

  return (
    <section className="sec">
      <div className="sec-h">{ReadingIcon}<p className="sec-t">Lecture stratégique</p>
        {reading?.confidence !== null && reading?.confidence !== undefined && <span className="cnt">confiance <b>{reading.confidence}%</b></span>}
      </div>
      <div className="sec-b">
        {reading ? <>
          <p className="sread-synthese">{reading.synthese}</p>
          {reading.forces.length > 0 && <><p className="sread-h ok">Forces</p><ul className="sread-list ok">{reading.forces.map((item, i) => <li key={i}>{item}</li>)}</ul></>}
          {reading.risques.length > 0 && <><p className="sread-h no">Risques</p><ul className="sread-list no">{reading.risques.map((item, i) => <li key={i}>{item}</li>)}</ul></>}
          {reading.prochainesActions.length > 0 && <><p className="sread-h next">Prochaines actions</p><ul className="sread-list next">{reading.prochainesActions.map((item, i) => <li key={i}>{item}</li>)}</ul></>}
          <p className="sread-meta">Généré {relativeLabel(reading.generatedAt)}{reading.model ? ` · ${reading.model}` : ''} · fondé sur {reading.sourceCounts.contacts} contact{reading.sourceCounts.contacts > 1 ? 's' : ''}, {reading.sourceCounts.signals} signal{reading.sourceCounts.signals > 1 ? 'aux' : ''}, {reading.sourceCounts.interactions + reading.sourceCounts.messages} échange{reading.sourceCounts.interactions + reading.sourceCounts.messages > 1 ? 's' : ''}</p>
          <p className="sread-note">Généré <b>uniquement</b> à partir des moments, engagements et signaux déjà persistés pour ce compte — jamais du contenu des emails eux-mêmes (non conservé).</p>
          <div className="sread-actions"><button className="mvp-b sread-btn" disabled={generating} onClick={() => void run(true)}>{generating ? 'Régénération…' : 'Régénérer'}</button></div>
        </> : generating ? <Empty>Génération de la lecture stratégique…</Empty>
        : !counts.sufficient ? <>
          <div className="sread-missing">{counts.missing.map((item, i) => <span key={i}>Il manque {item}.</span>)}</div>
          <Empty>Lecture en construction — pas encore assez de matière persistée pour ce compte.</Empty>
        </> : <>
          <Empty>{error ?? 'Lecture en construction.'}</Empty>
          <div className="sread-actions"><button className="mvp-b sread-btn" disabled={generating} onClick={() => void run(true)}>Générer</button></div>
        </>}
      </div>
    </section>
  )
}

// ── Historique & mémoire ─────────────────────────────────────────────────────
type Moment = { id: string; date: string | null; impact: 'renf' | 'frict' | 'jalon' | 'neut'; label: string; title: string; meta: string | null }
const IMPACT_LABEL: Record<Moment['impact'], string> = { renf: 'Renforce', frict: 'Friction', jalon: 'Jalon', neut: 'Neutre' }

function momentsFrom(data: AccountDetailData): Moment[] {
  const fromSignals: Moment[] = data.signals.map((s) => {
    const text = `${s.type} ${s.title} ${s.summary ?? ''}`.toLowerCase()
    const impact: Moment['impact'] = /risqu|churn|friction|retard|silence|perte|départ|insatisf/.test(text) ? 'frict'
      : /gagn|sign|renouv|expansion|avancé|accord|livr/.test(text) ? 'renf' : 'jalon'
    return { id: `sig-${s.id}`, date: s.provenance.observedAt, impact, label: s.title, title: s.title, meta: s.summary ?? s.impact ?? s.provenance.sourceLabel }
  })
  const fromMemory: Moment[] = data.memoryEntries.map((m) => ({ id: `mem-${m.id}`, date: m.createdAt, impact: 'neut', label: m.content, title: m.content, meta: `${m.entryType} · ${m.authorName}` }))
  return [...fromSignals, ...fromMemory].filter((m) => m.date).sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime())
}

function HistorySection({ data, userId, refresh }: { data: AccountDetailData; userId: string; refresh: () => Promise<void> }) {
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const owners = useMemo(() => {
    const list = [...new Set(data.people.map((p) => p.ownerName).filter((x): x is string => !!x))]
    if (data.account.primaryOwnerName && !list.includes(data.account.primaryOwnerName)) list.push(data.account.primaryOwnerName)
    return list
  }, [data.people, data.account.primaryOwnerName])

  const moments = useMemo(() => momentsFrom(data), [data])
  const shown = expanded ? moments : moments.slice(0, 5)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!content.trim()) return
    setSaving(true)
    try { await addAccountNote(data, userId, content.trim()); setContent(''); await refresh() } finally { setSaving(false) }
  }

  return (
    <section className="sec">
      <div className="sec-h"><span className="hm-i">{HistoryIcon}</span><p className="sec-t">Historique &amp; mémoire du compte</p><span className="memc">{data.memoryEntries.length} entrée{data.memoryEntries.length > 1 ? 's' : ''} en mémoire</span></div>
      <div className="sec-b">
        {owners.length > 0 && <div className="rl">
          <p className="rl-l">Qui a porté la relation</p>
          <div className="rl-t">
            {owners.map((o, i) => <div className="rl-s" key={o} style={{ display: 'contents' }}>
              <div className={`rl-s ${i === owners.length - 1 ? 'cur' : ''}`}><span className="rl-a">{initials(o)}</span><div className="rl-c"><p className="rl-n">{o}</p></div></div>
              {i < owners.length - 1 && <span className="rl-r" />}
            </div>)}
          </div>
          <span className="rl-k">{owners.length > 1 ? `${owners.length - 1} passation${owners.length - 1 > 1 ? 's' : ''}` : 'Owner unique'}</span>
        </div>}

        <div className="hm-s">
          <div className="hm-k"><p className="hm-kv">{dateLabel(data.account.relationshipStartedAt)}</p><p className="hm-kl">Premier échange</p></div>
          <div className="hm-k"><p className="hm-kv">{data.relationship.totalInteractions || '—'}</p><p className="hm-kl">Échanges au total</p></div>
          <div className="hm-k"><p className="hm-kv">{data.people.length}</p><p className="hm-kl">Interlocuteurs actifs</p></div>
        </div>

        <p className="km-l">L’histoire du compte {moments.length > 0 && <span className="km-n">{moments.length}</span>}</p>
        {shown.length ? <div className="tl2">
          {shown.map((m) => <div className={`tlr ${m.impact === 'frict' ? 'frict' : ''}`} key={m.id}>
            <span className="tlr-d">{dateLabel(m.date)}</span>
            <span className="tlr-n"><i className={m.impact} /></span>
            <div><p className="tlr-t">{m.title}</p>{m.meta && <p className="tlr-m">{m.meta}</p>}</div>
            <span className={`eff ${m.impact}`}>{IMPACT_LABEL[m.impact]}</span>
          </div>)}
          {moments.length > 5 && <button className="mvp-b" style={{ margin: '14px auto 0', display: 'block' }} onClick={() => setExpanded((v) => !v)}>{expanded ? 'Réduire' : `En savoir + (${moments.length - 5})`}</button>}
        </div> : <Empty>L’histoire du compte se construira à partir des signaux, notes et interactions persistés.</Empty>}

        <form onSubmit={(e) => void submit(e)}>
          <textarea className="hm-x" value={content} onChange={(e) => setContent(e.target.value)} placeholder="Ex : Christèle part en congés début mai, passer par Tanguy sur les OS." />
          <div className="hm-r"><button className="hm-p" disabled={saving || !content.trim()}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button></div>
        </form>
      </div>
    </section>
  )
}

// ── Modale explicative du score ─────────────────────────────────────────────
function ScoreModal({ data, onClose }: { data: AccountDetailData; onClose: () => void }) {
  const rel = data.relationship
  // Les 3 vraies composantes pondérées du score (0,55 + 0,25 + 0,20, voir score-batch) —
  // null si le snapshot est antérieur à leur ajout ou si aucun contact n'était engagé
  // ce mois-là (absence de mesure, jamais un 0 fabriqué).
  const rows: Array<{ label: string; weight: string; value: number | null; desc: string }> = [
    { label: 'Engagement', weight: '55%', value: rel.engagementComponent, desc: 'Moyenne pondérée des scores des contacts réellement engagés ce mois-ci (poids selon leur volume d’échanges).' },
    { label: 'Couverture contacts', weight: '25%', value: rel.contactCoverage, desc: 'Part des interlocuteurs du compte réellement couverts par un échange suivi.' },
    { label: 'Récence', weight: '20%', value: rel.recencyComponent, desc: 'Fraîcheur de la dernière interaction sur le compte (demi-vie 90 jours).' },
  ]
  const riskFactors: Array<{ label: string; value: number | null; desc: string }> = [
    { label: 'Couverture décideur', value: rel.decisionMakerCoverage, desc: 'Présence d’un lien avec le(s) décideur(s) identifié(s) du compte.' },
    { label: 'Répartition (anti-concentration)', value: rel.concentrationRisk === null ? null : Math.max(0, 100 - rel.concentrationRisk), desc: 'Un compte porté par un seul contact est plus fragile (risque de départ).' },
  ]
  return createPortal(
    <div className="acr-mask" onClick={onClose}>
      <div className="acr-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="mo-h"><p className="mo-t">Comment le score du compte est calculé</p><button className="mo-x" onClick={onClose} aria-label="Fermer">×</button></div>
        <div className="mo-b">
          <p className="mo-i">Le compte n’est <b>pas une simple somme de dyades</b> : le score agrège les personnes réellement engagées avec ce compte, pas une moyenne brute. Score global : <b>{rel.score ?? '—'}</b>{rel.confidence !== null ? ` · fiabilité ${rel.confidence}%` : ''}.</p>
          {rows.map((r) => <div className="mo-s" key={r.label}>
            <div className="mo-hd"><p className="mo-l">{r.label} <small>· {r.weight}</small></p><p className="mo-v">{r.value ?? '—'}<small>/100</small></p></div>
            <span className="mo-g"><i style={{ width: `${r.value ?? 0}%` }} /></span>
            <p className="mo-d">{r.desc}{r.value === null ? ' Pas encore mesuré ce mois-ci.' : ''}</p>
          </div>)}
          <p className="mo-sl">Facteurs de risque affichés à part — pas dans le calcul du score</p>
          {riskFactors.map((r) => <div className="mo-s" key={r.label}>
            <div className="mo-hd"><p className="mo-l">{r.label}</p><p className="mo-v">{r.value ?? '—'}<small>/100</small></p></div>
            <span className="mo-g"><i style={{ width: `${r.value ?? 0}%` }} /></span>
            <p className="mo-d">{r.desc}</p>
          </div>)}
          <p className="mo-f">Le revenu n’entre jamais dans le calcul — c’est la variable à prédire. Dérivé de {rel.totalInteractions} échange{rel.totalInteractions > 1 ? 's' : ''} · {data.sources.map((s) => s.label).join(' + ') || 'sources à confirmer'} · calculé {dateLabel(data.generatedAt)}.</p>
        </div>
      </div>
    </div>, document.body)
}

// ── Vue Relation ─────────────────────────────────────────────────────────────
export function AccountRelationView({ data, userId, currentUserName, refresh, navigate: _navigate }: {
  data: AccountDetailData
  userId: string
  currentUserName: string
  refresh: () => Promise<void>
  navigate: (path: string) => void
}) {
  const [modal, setModal] = useState(false)
  return (
    <div className="acr">
      <div className="cols">
        <HealthSection data={data} currentUserName={currentUserName} onOpenModal={() => setModal(true)} />
        <StrategySection data={data} userId={userId} refresh={refresh} />
      </div>
      <StrategicReadingSection data={data} refresh={refresh} />
      <HistorySection data={data} userId={userId} refresh={refresh} />
      {modal && <ScoreModal data={data} onClose={() => setModal(false)} />}
    </div>
  )
}

export type { AccountPerson as _AccountPerson }
