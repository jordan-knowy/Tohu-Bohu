import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { createAccount } from '../services/data'
import { initials } from '../lib/auth'
import { ToastProvider, useBusy, useToast, formatMonth } from '../person-detail/ui'
import { RELATION_COLORS, TIER_COLORS, durationLabel, scoreColor, logoColor, tickerDurationSeconds, type AccountListRow, type AccountTier, type PortfolioPoint, type TeamMember } from './mapping'
import {
  detectAccountCandidates, getAccountsOverview, reassignAccounts, setListFavorite,
  setListOwner, setListRelationType, setListWatch, trackCandidates,
  type AccountCandidate, type AccountsOverview,
} from './service'

type PageContext = { workspaceId: string; userId: string }

const TIERS: AccountTier[] = ['Critique', 'Sous tension', 'À traiter', 'Stables', 'À qualifier']
const RELATION_TYPES = Object.keys(RELATION_COLORS)

export const DocIcon = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h9l3 3v17H6z" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>
export const LinkIcon = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11a4 4 0 0 1 4-4h2v2H8a2 2 0 0 0 0 4h2v2H8a4 4 0 0 1-4-4z" /><path d="M14 7h2a4 4 0 0 1 0 8h-2v-2h2a2 2 0 0 0 0-4h-2z" /><path d="M8 11h8v2H8z" /></svg>
export const MailIcon = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H5.2L4 17.2z" /></svg>
export const StarIcon = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.85 5.9 6.5.6-4.9 4.3 1.45 6.35L12 17.7 6.1 19.75 7.55 13.4 2.65 9.1l6.5-.6z" /></svg>
export const CheckIcon = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7" /></svg>

export const CHANNEL_ICONS = {
  email: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M4 7l8 6 8-6" /></svg>,
  visio: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="6" width="12" height="12" rx="2.5" /><path d="M15 10l6-3v10l-6-3z" /></svg>,
  linkedin: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M7 10v7M7 7v.01M11 17v-4a2 2 0 0 1 4 0v4" /></svg>,
  phone: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M5 4h3.5l1.5 4-2 1.4a10 10 0 0 0 4.6 4.6L18 16l4 1.5V21a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2z" /></svg>,
} as const

function Ticker({ overview }: { overview: AccountsOverview }) {
  if (!overview.ticker.length) return null
  const sequence = overview.ticker.map((item, index) => <span className={`crm-mv-item ${item.src}`} key={index}>
    <span className="crm-mv-ic">{item.src === 'ext' ? LinkIcon : MailIcon}</span>
    <span className="crm-mv-src">{item.src === 'ext' ? 'Externe' : 'Interne'}</span>
    <span className="crm-mv-t">{item.tag}</span>
    <span className="crm-mv-txt"><b>{item.account}</b> · {item.summary}</span>
  </span>)
  const duration = tickerDurationSeconds(overview.ticker.length)
  return <div className="crm-mvt" role="marquee" aria-label="Insights comptes en direct">
    <div className="crm-mvt-head">
      <div className="crm-mvt-head-t"><span className="crm-mvt-hic">{DocIcon}</span>Insights comptes</div>
      <div className="crm-mvt-head-s">Live</div>
    </div>
    <div className="crm-mvt-view"><div className="crm-mvt-track" style={{ '--mvt-duration': `${duration}s` } as React.CSSProperties}>{sequence}{sequence}</div></div>
  </div>
}

function ScoreBoard({ overview, range, setRange }: { overview: AccountsOverview; range: number; setRange: (value: number) => void }) {
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null)
  const series = useMemo(() => overview.series36.slice(-range), [overview.series36, range])
  const risky = useMemo(() => overview.accounts
    .filter((account) => account.score !== null && account.score < 60)
    .slice(0, 3)
    .map((account) => ({ name: account.name, reason: account.score! < 50 ? `détracteur · score ${account.score}` : `sous tension · score ${account.score}` })), [overview.accounts])
  const evolution = (value: number | null) => value === null
    ? <span className="dxa-evo-v na">à venir</span>
    : <span className={`dxa-evo-v ${value >= 0 ? 'up' : 'dn'}`}>{value >= 0 ? '+' : '−'}{Math.abs(value)}%</span>

  const W = 1180, H = 168, PADL = 42, PADR = 16, PADT = 14, PADB = 26
  const gw = W - PADL - PADR
  const barWidth = Math.min(40, gw / series.length * 0.56)
  const x = (index: number) => PADL + gw * (index + 0.5) / series.length
  const y = (value: number) => PADT + (100 - value) / 100 * (H - PADT - PADB)
  const scored = series.filter((point) => point.score !== null)

  return <div className="dxa-graphwrap">
    <div className="dxa-scorecard">
      <div className="dxa-sc-lbl">Score relationnel global</div>
      <div className="dxa-sc-big" style={{ color: overview.globalScore === null ? '#9C8FD4' : overview.globalScore >= 60 ? '#5FD79E' : overview.globalScore >= 50 ? '#F0B04A' : '#F2879A' }}>{overview.globalScore ?? '—'}</div>
      <div className="dxa-sc-sub">portefeuille · {overview.scoredCount} compte{overview.scoredCount > 1 ? 's' : ''} scoré{overview.scoredCount > 1 ? 's' : ''} / {overview.accounts.length}</div>
      <div className="dxa-sc-evos">
        <div className="dxa-evo"><span className="dxa-evo-k">1 mois</span>{evolution(overview.evolutions.m1)}</div>
        <div className="dxa-evo"><span className="dxa-evo-k">Trimestre</span>{evolution(overview.evolutions.m3)}</div>
        <div className="dxa-evo sm"><span className="dxa-evo-k">Année</span>{evolution(overview.evolutions.m12)}</div>
      </div>
    </div>
    <div className="dxp-graph">
      <div className="dxp-graph-h">
        <span className="dxp-g-t">Évolution du scoring relationnel</span>
        <span className="dxp-info" tabIndex={0}>i<span className="dxp-info-t">
          <b>Scoring relationnel (0–100)</b><br />
          Santé agrégée du portefeuille dans le temps : moyenne par compte des scores contacts persistés par le moteur backend, mois par mois. Aucune donnée de CA n’entre dans le calcul, et aucun mois n’est interpolé.
        </span></span>
        <span className="dxp-g-s">santé agrégée des comptes · {range} mois</span>
        <div className="dxa-range" role="tablist" aria-label="Période du graphique">
          {[3, 12, 36].map((value) => <button key={value} type="button" role="tab" aria-selected={range === value} className={range === value ? 'on' : ''} onClick={() => setRange(value)}>{value} M</button>)}
        </div>
      </div>
      {!scored.length
        ? <div className="dxa-empty">L’évolution apparaîtra après plusieurs snapshots mensuels du moteur relationnel.</div>
        : <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} role="img"
          aria-label={`Score du portefeuille par mois : ${scored.map((point) => `${formatMonth(point.monthKey)} ${point.score}`).join(', ')}`}>
          {[0, 50, 100].map((value) => <g key={value}>
            <line x1={PADL} y1={y(value)} x2={W - PADR} y2={y(value)} stroke="#F0ECF8" />
            <text x={PADL - 6} y={y(value) + 3} textAnchor="end" fontSize="8" fill="#A8A2C0" fontFamily="monospace">{value}</text>
          </g>)}
          <line x1={PADL} y1={y(0)} x2={W - PADR} y2={y(0)} stroke="#DCD6EE" />
          {series.map((point, index) => point.score !== null && <rect
            key={point.monthKey}
            x={x(index) - barWidth / 2} y={y(point.score)} width={barWidth} height={(H - PADB) - y(point.score)} rx="3"
            fill={point.score >= 60 ? '#2EA86A' : point.score >= 50 ? '#C97A20' : '#D94F63'} opacity="0.9" style={{ cursor: 'pointer' }}
            onMouseEnter={(event) => setHover({ index, x: event.clientX, y: event.clientY })}
            onMouseMove={(event) => setHover({ index, x: event.clientX, y: event.clientY })}
            onMouseLeave={() => setHover(null)}
          />)}
          {series.map((point, index) => (series.length <= 12 || index % Math.ceil(series.length / 12) === 0) && <text key={`label-${point.monthKey}`} x={x(index)} y={H - 8} textAnchor="middle" fontSize="7" fill="#A8A2C0" fontFamily="monospace">{formatMonth(point.monthKey).split(' ')[0]}</text>)}
        </svg>}
      {hover && series[hover.index] && series[hover.index]!.score !== null && (() => {
        const point = series[hover.index]!
        const previous = series.slice(0, hover.index).reverse().find((item) => item.score !== null)
        const variation = previous?.score ? Math.round((point.score! - previous.score) / previous.score * 100) : null
        return <div className="pa-bartip" style={{ display: 'block', left: Math.min(hover.x + 14, window.innerWidth - 254), top: hover.y + 14 }}>
          <div className="dxa-bt-h"><span className="dxa-bt-m">{formatMonth(point.monthKey)}</span><span className="dxa-bt-sc" style={{ color: point.score! >= 60 ? '#5FD79E' : point.score! >= 50 ? '#F0B04A' : '#F2879A' }}>{point.score}</span></div>
          {variation === null ? <div className="dxa-bt-var">—</div> : <div className={`dxa-bt-var ${variation >= 0 ? 'up' : 'dn'}`}>{variation >= 0 ? '+' : '−'}{Math.abs(variation)}% vs mois précédent</div>}
          {risky.length > 0 && <><div className="dxa-bt-rk">{risky.length} compte{risky.length > 1 ? 's' : ''} à risque actuellement</div>
            {risky.map((item) => <div className="dxa-bt-r" key={item.name}><i /><span className="dxa-bt-rn">{item.name}</span><span className="dxa-bt-rr">{item.reason}</span></div>)}</>}
        </div>
      })()}
    </div>
  </div>
}

export function FilterChip({ label, options, selected, onToggle }: { label: string; options: Array<{ value: string; color?: string }>; selected: string[]; onToggle: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])
  return <div ref={rootRef} className={`dxp-relfilter ${selected.length ? 'active' : ''}`} onClick={() => setOpen((value) => !value)} role="button" tabIndex={0} aria-haspopup="menu" aria-expanded={open}
    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpen((value) => !value) } }}>
    <span className="dxp-rf-k">{label}</span>
    <span className="dxp-rf-v">{!selected.length ? 'Tous' : selected.length === 1 ? selected[0] : `${selected.length} sélectionnés`}</span>
    <span className="dxp-rf-c">▾</span>
    <div className={`dxp-rf-menu ${open ? 'on' : ''}`} role="menu" onClick={(event) => event.stopPropagation()}>
      {options.map((option) => <button key={option.value} type="button" role="menuitemcheckbox" aria-checked={selected.includes(option.value)} className={`dxp-ms ${selected.includes(option.value) ? 'on' : ''}`} onClick={() => onToggle(option.value)}>
        <span className="dxp-cbox" />
        {option.color && <span className="dxp-rf-o-dot" style={{ background: option.color }} />}
        {option.value}
      </button>)}
    </div>
  </div>
}

function RelationCell({ row, workspaceId, userId, refresh }: { row: AccountListRow; workspaceId: string; userId: string; refresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 })
  const toast = useToast()
  const rootRef = useRef<HTMLSpanElement>(null)
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
    if (open) {
      setOpen(false)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const menuWidth = 246
    const menuHeight = RELATION_TYPES.length * 40 + 12
    const gap = 7
    const viewportPadding = 10
    const opensUp = window.innerHeight - rect.bottom < menuHeight + gap
    setMenuPosition({
      left: Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - menuWidth - viewportPadding)),
      top: opensUp
        ? Math.max(viewportPadding, rect.top - menuHeight - gap)
        : Math.min(window.innerHeight - menuHeight - viewportPadding, rect.bottom + gap),
    })
    setOpen(true)
  }
  const pick = async (value: string) => {
    setOpen(false)
    try {
      await setListRelationType(workspaceId, row.id, userId, value)
      toast(`Relation « ${value} » enregistrée pour ${row.name}.`)
      await refresh()
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Enregistrement impossible', 'error')
    }
  }
  return <span ref={rootRef} style={{ position: 'relative' }}>
    <button type="button" className="dxa-rel" aria-haspopup="menu" aria-expanded={open} onClick={toggleMenu}>
      <span className="dxa-rel-dot" style={{ background: row.relationType ? RELATION_COLORS[row.relationType] ?? '#8C86A8' : '#C4BCD8' }} />
      {row.relationType ?? 'À qualifier'}
    </button>
    {open && createPortal(<div ref={menuRef} className="pa-relmenu" role="menu" style={menuPosition} onClick={(event) => event.stopPropagation()}>
      {RELATION_TYPES.map((value) => <button key={value} type="button" role="menuitem" className="pa-relmenu-option" onClick={() => void pick(value)}>
        <span className="dxp-rf-o-dot" style={{ background: RELATION_COLORS[value] }} />{value}
      </button>)}
    </div>, document.body)}
  </span>
}

function IntegrateModal({ workspaceId, onClose, refresh }: { workspaceId: string; onClose: () => void; refresh: () => Promise<void> }) {
  const toast = useToast()
  const [candidates, setCandidates] = useState<AccountCandidate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  const [manualDomain, setManualDomain] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    detectAccountCandidates(workspaceId).then(setCandidates).catch((reason) => setError(reason instanceof Error ? reason.message : 'Détection impossible'))
  }, [workspaceId])
  const add = async (candidate: AccountCandidate) => {
    setBusy(candidate.name)
    try {
      await trackCandidates(workspaceId, [{ companyId: candidate.companyId, name: candidate.name, domain: candidate.domain }])
      toast(`${candidate.name} intégré au portefeuille.`)
      await refresh()
      onClose()
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Intégration impossible', 'error')
    } finally {
      setBusy(null)
    }
  }
  const createManual = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!manual.trim()) return
    setBusy('manual')
    try {
      await createAccount({ name: manual.trim(), domain: manualDomain.trim() || null })
      toast(`Compte « ${manual.trim()} » créé.`)
      await refresh()
      onClose()
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Création impossible', 'error')
    } finally {
      setBusy(null)
    }
  }
  return <div className="pa-iov" role="dialog" aria-modal="true" aria-label="Intégrer des comptes">
    <div className="dxp-iov-bg" onClick={onClose} />
    <div className="dxp-iov-card">
      <div className="dxp-iov-head">Intégrer des comptes<button type="button" className="dxp-iov-x" aria-label="Fermer" onClick={onClose}>✕</button></div>
      <div className="dxp-iov-sub">Les newsletters et expéditeurs automatiques sont ignorés par défaut. Tu peux toujours intégrer volontairement leur compte ci-dessous.</div>
      {error && <div className="dxa-empty">{error}</div>}
      {!error && candidates === null && <div className="dxa-empty">Détection en cours dans tes échanges…</div>}
      {candidates !== null && !candidates.length && <div className="dxa-empty">Aucun candidat détecté — connecte ou synchronise une boîte mail, ou crée un compte manuellement.</div>}
      <div className="dxp-iov-res">
        {(candidates ?? []).map((candidate) => <div className="dxp-iov-cand" key={candidate.name}>
          <span className="dxp-iov-iav">{initials(candidate.name)}</span>
          <div>
            <div className="dxp-iov-cnm">{candidate.name}</div>
            <div className="dxp-iov-csub">{[candidate.domain, `${candidate.interactions} échange${candidate.interactions > 1 ? 's' : ''}`, candidate.source].filter(Boolean).join(' · ')}</div>
          </div>
          {candidate.alreadyTracked
            ? <button type="button" className="dxp-iov-add" disabled>Déjà suivi</button>
            : <button type="button" className="dxp-iov-add" disabled={busy !== null} onClick={() => void add(candidate)}>{busy === candidate.name ? '…' : '+ Ajouter'}</button>}
        </div>)}
      </div>
      <div className="dxp-iov-sep"><span>ou créer manuellement</span></div>
      <form className="dxp-iov-manual" onSubmit={(event) => void createManual(event)}>
        <label className="sr-only" htmlFor="pa-manual-name">Nom du compte</label>
        <input id="pa-manual-name" placeholder="Nom de l’entreprise" value={manual} onChange={(event) => setManual(event.target.value)} />
        <label className="sr-only" htmlFor="pa-manual-domain">Domaine du compte</label>
        <input id="pa-manual-domain" placeholder="Domaine (facultatif, ex. exemple.com)" value={manualDomain} onChange={(event) => setManualDomain(event.target.value)} />
        <button className="dxp-iov-idbtn" disabled={busy !== null || !manual.trim()}>Créer le compte</button>
      </form>
    </div>
  </div>
}

export function MemberPicker({ overview, anchor, currentId, onPick, onClose }: { overview: { team: TeamMember[] }; anchor: { x: number; y: number }; currentId: string | null; onPick: (memberId: string) => void; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose()
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [onClose])
  return <div className="pa-pop" role="menu" style={{ left: Math.max(12, Math.min(anchor.x - 40, window.innerWidth - 260)), top: anchor.y + 8 }} onClick={(event) => event.stopPropagation()}>
    <div className="kp-head">Réattribuer à</div>
    {!overview.team.length && <div className="dxa-empty">Aucun membre d’équipe.</div>}
    {overview.team.map((member) => <button key={member.id} type="button" className="kp-opt" role="menuitem" onClick={() => onPick(member.id)}>
      <span className="kp-av">{member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : initials(member.name)}</span>
      <span>{member.name}</span>
      {member.id === currentId && <span className="kp-cur">actuel</span>}
    </button>)}
  </div>
}

function PageBody({ context }: { context: PageContext }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [, run] = useBusy()
  const [overview, setOverview] = useState<AccountsOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState(12)
  const [tierFilter, setTierFilter] = useState<string[]>([])
  const [typeFilter, setTypeFilter] = useState<string[]>([])
  const [ownerFilter, setOwnerFilter] = useState<string[]>([])
  const [sort, setSort] = useState<{ key: 'nm' | 'dur' | 'nps' | 'ct'; dir: number } | null>(null)
  const [integrateOpen, setIntegrateOpen] = useState(false)
  const [ownerPopup, setOwnerPopup] = useState<{ accountId: string; x: number; y: number } | null>(null)
  const [passation, setPassation] = useState(false)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [assignAnchor, setAssignAnchor] = useState<{ x: number; y: number } | null>(null)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      setOverview(await getAccountsOverview(context.workspaceId, context.userId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Erreur inattendue')
    }
  }, [context.workspaceId, context.userId])
  useEffect(() => { void refresh() }, [refresh])

  const toggleIn = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (value: string) =>
    setter((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])

  const filtered = useMemo(() => {
    if (!overview) return []
    let list = overview.accounts.filter((row) =>
      (!tierFilter.length || tierFilter.includes(row.tier))
      && (!typeFilter.length || typeFilter.includes(row.relationType ?? 'À qualifier'))
      && (!ownerFilter.length || ownerFilter.includes(row.ownerName ?? 'Sans owner')))
    if (sort) {
      const factor = sort.dir
      list = [...list].sort((a, b) => {
        if (sort.key === 'nm') return a.name.localeCompare(b.name) * factor
        const left = sort.key === 'dur' ? a.relationSinceMonths : sort.key === 'nps' ? a.score : a.contactCount
        const right = sort.key === 'dur' ? b.relationSinceMonths : sort.key === 'nps' ? b.score : b.contactCount
        return ((left ?? -1) - (right ?? -1)) * factor
      })
    }
    return list
  }, [overview, tierFilter, typeFilter, ownerFilter, sort])

  if (error) return <div className="ra-state error"><h1>Impossible de charger les comptes</h1><p>{error}</p><button onClick={() => void refresh()}>Réessayer</button></div>
  if (!overview) return <div className="ra-skeleton" aria-label="Chargement des comptes"><i /><i /><i /></div>

  const sortHeader = (key: 'nm' | 'dur' | 'nps' | 'ct', label: string, extraClass = '') =>
    <button type="button" className={`dxp-hsort ${extraClass} ${sort?.key === key ? (sort.dir > 0 ? 'asc' : 'desc') : ''}`}
      onClick={() => setSort((current) => current?.key === key ? { key, dir: -current.dir } : { key, dir: 1 })}>
      {label}<span className="dxp-sar" />
    </button>

  const toggleFavorite = (row: AccountListRow) => void run(`fav-${row.id}`, async () => {
    await setListFavorite(context.workspaceId, row.id, context.userId, !row.favorite)
    toast(row.favorite ? `${row.name} retiré des favoris.` : `${row.name} ajouté aux favoris.`)
    await refresh()
  })
  const toggleWatch = (row: AccountListRow) => void run(`watch-${row.id}`, async () => {
    await setListWatch(context.workspaceId, row.id, context.userId, !row.watchEnabled)
    toast(row.watchEnabled ? `Veille désactivée sur ${row.name}.` : `Veille activée sur ${row.name}.`)
    await refresh()
  })
  const pickOwner = (accountId: string) => (memberId: string) => {
    setOwnerPopup(null)
    void run(`owner-${accountId}`, async () => {
      await setListOwner(context.workspaceId, accountId, context.userId, memberId)
      toast(`Owner réattribué à ${overview.team.find((member) => member.id === memberId)?.name ?? 'ce membre'}.`)
      await refresh()
    })
  }
  const assignSelection = (memberId: string) => {
    setAssignAnchor(null)
    const accounts = overview.accounts.filter((row) => selection.has(row.id))
    void run('passation', async () => {
      const result = await reassignAccounts(context.workspaceId, accounts, memberId, context.userId)
      toast(`Passation effectuée : ${accounts.length} compte${accounts.length > 1 ? 's' : ''}, ${result.transferred} contact${result.transferred > 1 ? 's' : ''} transféré${result.transferred > 1 ? 's' : ''}${result.logged ? '' : ' (journal de transfert indisponible)'}.`)
      setPassation(false)
      setSelection(new Set())
      await refresh()
    })
  }

  return <div className="pa">
    <Ticker overview={overview} />
    {overview.degradedReasons.length > 0 && <div className="pa-degraded"><strong>Données partielles</strong> {overview.degradedReasons.join(' · ')}</div>}
    <ScoreBoard overview={overview} range={range} setRange={setRange} />
    <div className="dxp-toolbar dxa-toolbar">
      <div className="dxp-tools-l">
        <FilterChip label="Statut" options={TIERS.map((tier) => ({ value: tier, color: TIER_COLORS[tier] }))} selected={tierFilter} onToggle={toggleIn(setTierFilter)} />
        <FilterChip label="Type" options={[...RELATION_TYPES.map((value) => ({ value, color: RELATION_COLORS[value] })), { value: 'À qualifier', color: '#C4BCD8' }]} selected={typeFilter} onToggle={toggleIn(setTypeFilter)} />
        <FilterChip label="Owner" options={[...overview.team.map((member) => ({ value: member.name })), { value: 'Sans owner' }]} selected={ownerFilter} onToggle={toggleIn(setOwnerFilter)} />
      </div>
      <div style={{ display: 'flex', gap: 9 }}>
        <button type="button" className="dxp-integ" onClick={() => setIntegrateOpen(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M12 8v8M8 12h8" /></svg> Intégrer des comptes
        </button>
        <button type="button" className={`kpass-btn ${passation ? 'on' : ''}`} aria-pressed={passation} onClick={() => { setPassation((value) => !value); setSelection(new Set()) }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3l4 4-4 4M20 7H8M8 21l-4-4 4-4M4 17h12" /></svg> Passation
        </button>
      </div>
    </div>
    <div className="dxp-tablecard dxa-card">
      <div className="dxa-head">
        <span /><span /><span />
        {sortHeader('nm', 'Compte')}
        <span className="dxa-h-rel">Relation</span>
        {sortHeader('dur', 'Relation depuis', 'dxa-h-dur')}
        {sortHeader('nps', 'NPS', 'center')}
        {sortHeader('ct', 'Contacts', 'center dxa-h-ct')}
        <span className="dxa-h-ch">Canaux</span>
        <span className="center">Owner</span>
        <span className="center">Veille</span>
      </div>
      <div className="dxp-list dxa-list">
        {!filtered.length && <div className="dxa-empty">{overview.accounts.length ? 'Aucun compte pour ce filtre.' : 'Aucun compte suivi — utilise « Intégrer des comptes » pour démarrer depuis tes échanges réels.'}</div>}
        {filtered.map((row) => <div key={row.id} role="button" tabIndex={0} className={`dxa-row dxp-row ${selection.has(row.id) ? 'is-sel' : ''}`}
          onClick={() => {
            if (passation) setSelection((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next })
            else navigate(`/app/accounts/${row.id}`)
          }}
          onKeyDown={(event) => { if (event.key === 'Enter') { if (passation) setSelection((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next }); else navigate(`/app/accounts/${row.id}`) } }}>
          <span className="dxp-band" style={{ background: TIER_COLORS[row.tier] }} />
          {passation
            ? <span className="psel" aria-hidden="true">{CheckIcon}</span>
            : <span />}
          <span className="dxa-logo" style={{ background: logoColor(row.name) }} aria-hidden="true">{initials(row.name)}</span>
          <button type="button" className={`dxp-star ${row.favorite ? 'on' : ''}`} aria-pressed={row.favorite} aria-label={row.favorite ? `Retirer ${row.name} des favoris` : `Ajouter ${row.name} aux favoris`}
            onClick={(event) => { event.stopPropagation(); toggleFavorite(row) }}>{StarIcon}</button>
          <span style={{ minWidth: 0 }}>
            <span className="dxp-nm">{row.name}</span>
            {row.meta && <span className="dxa-meta">{row.meta}</span>}
          </span>
          <span onClick={(event) => event.stopPropagation()}><RelationCell row={row} workspaceId={context.workspaceId} userId={context.userId} refresh={refresh} /></span>
          <span className="dxp-dur">{durationLabel(row.relationSinceMonths)}</span>
          <span className="dxp-nps" style={{ color: scoreColor(row.score) }}>{row.score ?? '—'}{row.trend && <small>{row.trend === 'up' ? '↗' : row.trend === 'down' ? '↘' : '→'}</small>}</span>
          <span className="dxa-ct">{row.contactCount}</span>
          <span className="dxp-chans" aria-label={`Canaux actifs : ${Object.entries(row.channels).filter(([, on]) => on).map(([channel]) => channel).join(', ') || 'aucun'}`}>
            {(Object.keys(CHANNEL_ICONS) as Array<keyof typeof CHANNEL_ICONS>).map((channel) => <span key={channel} className={`dxp-ch ${row.channels[channel] ? 'on' : ''}`}>{CHANNEL_ICONS[channel]}</span>)}
          </span>
          <button type="button" className="dxa-own" title={row.ownerName ? `Owner : ${row.ownerName} — changer` : 'Attribuer un owner'}
            aria-label={row.ownerName ? `Owner : ${row.ownerName} — changer` : 'Attribuer un owner'}
            onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setOwnerPopup({ accountId: row.id, x: rect.left, y: rect.bottom }) }}>
            {row.ownerName ? initials(row.ownerName) : '+'}
          </button>
          <button type="button" className={`tgv ${row.watchEnabled ? 'on' : ''}`} aria-pressed={row.watchEnabled} aria-label={`Veille ${row.watchEnabled ? 'activée' : 'désactivée'} sur ${row.name}`}
            onClick={(event) => { event.stopPropagation(); toggleWatch(row) }} disabled={passation}><i /></button>
        </div>)}
      </div>
    </div>
    <div className="pa-note">Scores agrégés depuis les snapshots persistés du moteur relationnel · actualisé {new Date(overview.generatedAt).toLocaleTimeString('fr-FR')}</div>
    {integrateOpen && <IntegrateModal workspaceId={context.workspaceId} onClose={() => setIntegrateOpen(false)} refresh={refresh} />}
    {ownerPopup && <MemberPicker overview={overview} anchor={ownerPopup}
      currentId={overview.accounts.find((row) => row.id === ownerPopup.accountId)?.ownerId ?? null}
      onPick={pickOwner(ownerPopup.accountId)} onClose={() => setOwnerPopup(null)} />}
    {passation && <div className="pa-bar" role="toolbar" aria-label="Passation d’équipe">
      <span className="pb-n"><b>{selection.size}</b> compte{selection.size > 1 ? 's' : ''} sélectionné{selection.size > 1 ? 's' : ''}</span>
      <button type="button" className="pb-assign" disabled={!selection.size} onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setAssignAnchor({ x: rect.left, y: rect.top - 220 }) }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3l4 4-4 4M20 7H8" /></svg> Réattribuer
      </button>
      <button type="button" className="pb-cancel" onClick={() => { setPassation(false); setSelection(new Set()) }}>Annuler</button>
    </div>}
    {assignAnchor && <MemberPicker overview={overview} anchor={assignAnchor} currentId={null} onPick={assignSelection} onClose={() => setAssignAnchor(null)} />}
  </div>
}

export default function AccountsListPage({ context }: { context: PageContext }) {
  return <ToastProvider><PageBody context={context} /></ToastProvider>
}
