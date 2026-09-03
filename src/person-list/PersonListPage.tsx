import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createPerson } from '../services/data'
import { initials } from '../lib/auth'
import { ContactAvatar } from '../components/ContactAvatar'
import { IntegrationModal, ageSince, type IntegrationItem } from '../components/IntegrationModal'
import { listSharedWithMe, type SharedWithMeEntry } from '../person-detail/service'
import { ToastProvider, useBusy, useToast } from '../person-detail/ui'
import { setBohuBarShrunk } from '../shell/bohuBarSignal'
import {
  CHANNEL_ICONS, CheckIcon, DocIcon, FilterChip, LinkIcon, MailIcon, MemberPicker, StarIcon,
} from '../account-list/AccountsListPage'
import {
  durationLabel, lastContactLabel, logoColor, RELATION_COLORS, scoreColor, tickerDurationSeconds, TIER_COLORS,
  type PersonListRow, type TickerItem,
} from './mapping'
import {
  archivePeople, detectPersonCandidates, getPeopleOverview, reassignPeople, setPersonFavorite, setPersonOwner,
  setPersonWatch, trackPersonCandidate, type PeopleOverview, type PersonCandidate,
} from './service'

type PageContext = { workspaceId: string; userId: string }
type SortKey = 'nm' | 'job' | 'acc' | 'dur' | 'nps' | 'last'

const RELATION_TYPES = Object.keys(RELATION_COLORS)

function Ticker({ ticker }: { ticker: TickerItem[] }) {
  if (!ticker.length) return null
  const sequence = ticker.map((item, index) => <span className={`crm-mv-item ${item.src}`} key={index}>
    <span className="crm-mv-ic">{item.src === 'ext' ? LinkIcon : MailIcon}</span>
    <span className="crm-mv-src">{item.src === 'ext' ? 'Externe' : 'Interne'}</span>
    <span className="crm-mv-t">{item.tag}</span>
    <span className="crm-mv-txt"><b>{item.person}</b> · {item.summary}</span>
  </span>)
  const duration = tickerDurationSeconds(ticker.length)
  return <div className="crm-mvt" role="marquee" aria-label="Mouvements détectés">
    <div className="crm-mvt-head">
      <div className="crm-mvt-head-t"><span className="crm-mvt-hic">{DocIcon}</span>Mouvements détectés</div>
      <div className="crm-mvt-head-s">Live</div>
    </div>
    <div className="crm-mvt-view"><div className="crm-mvt-track" style={{ '--mvt-duration': `${duration}s` } as React.CSSProperties}>{sequence}{sequence}</div></div>
  </div>
}

function CreatePersonModal({ workspaceId, onClose, refresh }: { workspaceId: string; onClose: () => void; refresh: () => Promise<void> }) {
  const toast = useToast()
  const [candidates, setCandidates] = useState<PersonCandidate[] | null>(null)
  const [candidateError, setCandidateError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    detectPersonCandidates(workspaceId)
      .then((rows) => { if (active) setCandidates(rows) })
      .catch((reason) => { if (active) setCandidateError(reason instanceof Error ? reason.message : 'Détection impossible') })
    return () => { active = false }
  }, [workspaceId])
  const items: IntegrationItem[] | null = useMemo(() => candidates?.map((candidate) => ({
    id: candidate.contactId,
    name: candidate.fullName,
    subtitle: [candidate.roleTitle, candidate.companyName].filter(Boolean).join(' · ') || candidate.email,
    interactions: candidate.interactions,
    lastInteractionAt: candidate.lastInteractionAt,
    ageLabel: ageSince(candidate.firstInteractionAt),
  })) ?? null, [candidates])
  const total = candidates?.length ?? 0
  const handleConfirm = async (ids: string[]) => {
    setBusy(true)
    try {
      await Promise.all(ids.map((id) => trackPersonCandidate(workspaceId, id)))
      toast(`${ids.length} personne${ids.length > 1 ? 's' : ''} intégrée${ids.length > 1 ? 's' : ''} et ajoutée${ids.length > 1 ? 's' : ''} à la veille.`)
      await refresh()
      onClose()
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Intégration impossible', 'error')
      setBusy(false)
    }
  }
  return <IntegrationModal
    entity="personne"
    title={`${total} personne${total > 1 ? 's' : ''} détectée${total > 1 ? 's' : ''} dans tes échanges`}
    subtitle={<>Aucun score à ce stade — que du mesurable. <b>Échanges lus · lecture seule</b>. Les 10 plus actives sont pré-cochées : tu peux continuer sans rien décider.</>}
    items={items}
    loading={candidates === null && !candidateError}
    error={candidateError}
    busy={busy}
    onConfirm={handleConfirm}
    onClose={onClose}
  />
}

/** Fiches partagées par d'autres membres de l'équipe : elles vivent dans leur
 *  organisation, pas la mienne, donc invisibles via le filtre workspace normal
 *  de la liste — seul point d'entrée pour les atteindre (voir list_shared_with_me). */
function SharedWithMe({ entries }: { entries: SharedWithMeEntry[] }) {
  if (!entries.length) return null
  return <div className="pa-shared-with-me">
    <div className="pa-shared-with-me-title">Partagé avec moi</div>
    <div className="pa-shared-with-me-list">
      {entries.map((entry) => (
        <Link key={entry.entityId} className="pa-shared-with-me-row" to={`/app/people/${entry.entityId}?org=${entry.organizationId}`}>
          <ContactAvatar src={entry.avatarUrl} name={entry.fullName} />
          <div className="pa-shared-with-me-copy">
            <strong>{entry.fullName}</strong>
            <span>{[entry.jobTitle, `partagée par ${entry.fromName}`].filter(Boolean).join(' · ')}</span>
          </div>
        </Link>
      ))}
    </div>
  </div>
}

function PageBody({ context }: { context: PageContext }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [, run] = useBusy()
  const [overview, setOverview] = useState<PeopleOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sharedWithMe, setSharedWithMe] = useState<SharedWithMeEntry[]>([])
  const [ownerFilter, setOwnerFilter] = useState<string[]>([])
  const [relationFilter, setRelationFilter] = useState<string[]>([])
  const [accountFilter, setAccountFilter] = useState<string[]>([])
  const [sort, setSort] = useState<{ key: SortKey; dir: number } | null>(null)
  const [integrateOpen, setIntegrateOpen] = useState(false)
  const [ownerPopup, setOwnerPopup] = useState<{ personId: string; x: number; y: number } | null>(null)
  const [passation, setPassation] = useState(false)
  const [passationClosing, setPassationClosing] = useState(false)
  const [selection, setSelection] = useState<Set<string>>(new Set())

  useEffect(() => {
    setBohuBarShrunk(passation && !passationClosing)
    return () => setBohuBarShrunk(false)
  }, [passation, passationClosing])
  const closePassation = () => {
    setPassationClosing(true)
    setTimeout(() => { setPassation(false); setSelection(new Set()); setPassationClosing(false) }, 260)
  }
  const [assignAnchor, setAssignAnchor] = useState<{ x: number; y: number } | null>(null)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      setOverview(await getPeopleOverview(context.workspaceId, context.userId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Erreur inattendue')
    }
  }, [context.workspaceId, context.userId])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { void listSharedWithMe('contact').then(setSharedWithMe).catch(() => setSharedWithMe([])) }, [context.workspaceId])

  const toggleIn = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (value: string) =>
    setter((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])
  const toggleSelect = (id: string) => setSelection((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })

  const filtered = useMemo(() => {
    if (!overview) return []
    let list = overview.people.filter((row) =>
      (!ownerFilter.length || ownerFilter.includes(row.ownerName ?? 'Sans owner'))
      && (!relationFilter.length || relationFilter.includes(row.relationType ?? 'À qualifier'))
      && (!accountFilter.length || accountFilter.includes(row.companyName ?? 'Sans compte')))
    if (sort) {
      const factor = sort.dir
      list = [...list].sort((a, b) => {
        if (sort.key === 'nm') return a.name.localeCompare(b.name) * factor
        if (sort.key === 'job') return (a.jobTitle ?? '').localeCompare(b.jobTitle ?? '') * factor
        if (sort.key === 'acc') return (a.companyName ?? '').localeCompare(b.companyName ?? '') * factor
        if (sort.key === 'last') return (a.lastContactAt ?? '').localeCompare(b.lastContactAt ?? '') * factor
        const left = sort.key === 'dur' ? a.relationSinceMonths : a.score
        const right = sort.key === 'dur' ? b.relationSinceMonths : b.score
        return ((left ?? -1) - (right ?? -1)) * factor
      })
    }
    return list
  }, [overview, ownerFilter, relationFilter, accountFilter, sort])

  if (error) return <div className="ra-state error"><h1>Impossible de charger les personnes</h1><p>{error}</p><button onClick={() => void refresh()}>Réessayer</button></div>
  if (!overview) return <div className="ra-skeleton" aria-label="Chargement des personnes"><i /><i /><i /></div>

  const accountOptions = [...new Set(overview.people.map((row) => row.companyName ?? 'Sans compte'))].sort().map((value) => ({ value }))
  const ownerOptions = [...overview.team.map((member) => ({ value: member.name })), { value: 'Sans owner' }]
  const relationOptions = [...RELATION_TYPES.map((value) => ({ value, color: RELATION_COLORS[value] })), { value: 'À qualifier', color: '#C4BCD8' }]

  const sortHeader = (key: SortKey, label: string, extraClass = '') =>
    <button type="button" className={`dxp-hsort ${extraClass} ${sort?.key === key ? (sort.dir > 0 ? 'asc' : 'desc') : ''}`}
      onClick={() => setSort((current) => current?.key === key ? { key, dir: -current.dir } : { key, dir: 1 })}>
      {label}<span className="dxp-sar" />
    </button>

  const toggleFavorite = (row: PersonListRow) => void run(`fav-${row.id}`, async () => {
    await setPersonFavorite(context.workspaceId, row.id, context.userId, !row.favorite)
    toast(row.favorite ? `${row.name} retiré(e) des favoris.` : `${row.name} ajouté(e) aux favoris.`)
    await refresh()
  })
  const toggleWatch = (row: PersonListRow) => void run(`watch-${row.id}`, async () => {
    await setPersonWatch(context.workspaceId, row.id, context.userId, !row.watchEnabled)
    toast(row.watchEnabled ? `Veille désactivée sur ${row.name}.` : `Veille activée sur ${row.name}.`)
    await refresh()
  })
  const pickOwner = (personId: string) => (memberId: string) => {
    setOwnerPopup(null)
    void run(`owner-${personId}`, async () => {
      await setPersonOwner(context.workspaceId, personId, context.userId, memberId)
      toast(`Owner réattribué à ${overview.team.find((member) => member.id === memberId)?.name ?? 'ce membre'}.`)
      await refresh()
    })
  }
  const assignSelection = (memberId: string) => {
    setAssignAnchor(null)
    const people = overview.people.filter((row) => selection.has(row.id))
    void run('passation', async () => {
      const result = await reassignPeople(context.workspaceId, people, memberId, context.userId)
      toast(`Passation effectuée : ${result.transferred} personne${result.transferred > 1 ? 's' : ''} transférée${result.transferred > 1 ? 's' : ''}${result.logged ? '' : ' (journal de transfert indisponible)'}.`)
      setPassation(false)
      setSelection(new Set())
      await refresh()
    })
  }
  const deleteSelection = () => {
    const ids = [...selection]
    if (!ids.length) return
    if (!window.confirm(`Supprimer ${ids.length} personne${ids.length > 1 ? 's' : ''} de Tohu ? Elles seront masquées des listes — l’historique réel (emails, réunions, signaux) est conservé et restaurable depuis chaque fiche.`)) return
    void run('delete-selection', async () => {
      await archivePeople(context.workspaceId, context.userId, ids)
      window.dispatchEvent(new Event('tohu:workspace-updated'))
      toast(`${ids.length} personne${ids.length > 1 ? 's' : ''} supprimée${ids.length > 1 ? 's' : ''}.`)
      setPassation(false)
      setSelection(new Set())
      await refresh()
    })
  }

  return <div className="pa">
    <Ticker ticker={overview.ticker} />
    <SharedWithMe entries={sharedWithMe} />
    {overview.degradedReasons.length > 0 && <div className="pa-degraded"><strong>Données partielles</strong> {overview.degradedReasons.join(' · ')}</div>}
    <div className="dxp-toolbar dxa-toolbar">
      <div className="dxp-tools-l">
        <FilterChip label="Géré par" options={ownerOptions} selected={ownerFilter} onToggle={toggleIn(setOwnerFilter)} />
        <FilterChip label="Relation" options={relationOptions} selected={relationFilter} onToggle={toggleIn(setRelationFilter)} />
        <FilterChip label="Clients" options={accountOptions} selected={accountFilter} onToggle={toggleIn(setAccountFilter)} />
      </div>
      <div style={{ display: 'flex', gap: 9 }}>
        <button type="button" className="dxp-integ" onClick={() => setIntegrateOpen(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M12 8v8M8 12h8" /></svg> Intégrer des personnes
        </button>
        <button type="button" className={`kpass-btn ${passation ? 'on' : ''}`} aria-pressed={passation} onClick={() => { passation ? closePassation() : setPassation(true) }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3l4 4-4 4M20 7H8M8 21l-4-4 4-4M4 17h12" /></svg> Sélectionner
        </button>
      </div>
    </div>
    <div className="dxp-tablecard dxa-card">
      <div className="dxpp-head">
        <span /><span /><span />
        {sortHeader('nm', 'Contact')}
        <span className="dxpp-h-job">Poste</span>
        <span className="dxpp-h-acc">Compte</span>
        {sortHeader('dur', 'Relation depuis', 'dxpp-h-dur')}
        {sortHeader('nps', 'Score', 'center')}
        {sortHeader('last', 'Dernier contact', 'dxpp-h-last')}
        <span className="dxpp-h-ch">Canaux</span>
        <span className="center">Owner</span>
        <span className="center">Veille</span>
      </div>
      <div className="dxp-list">
        {!filtered.length && <div className="dxa-empty">{overview.people.length ? 'Aucune personne pour ce filtre.' : 'Aucune personne suivie — utilise « Intégrer des personnes » pour en ajouter une.'}</div>}
        {filtered.map((row) => <div key={row.id} role="button" tabIndex={0} className={`dxpp-row dxp-row ${selection.has(row.id) ? 'is-sel' : ''}`}
          onClick={() => { if (passation) toggleSelect(row.id); else navigate(`/app/people/${row.id}`) }}
          onKeyDown={(event) => { if (event.key === 'Enter') { if (passation) toggleSelect(row.id); else navigate(`/app/people/${row.id}`) } }}>
          <span className="dxp-band" style={{ background: TIER_COLORS[row.tier] }} />
          {passation ? <span className="psel" aria-hidden="true">{CheckIcon}</span> : <span />}
          <button type="button" className={`dxp-star ${row.favorite ? 'on' : ''}`} aria-pressed={row.favorite} aria-label={row.favorite ? `Retirer ${row.name} des favoris` : `Ajouter ${row.name} aux favoris`}
            onClick={(event) => { event.stopPropagation(); toggleFavorite(row) }}>{StarIcon}</button>
          <span className="dxa-logo" style={{ background: logoColor(row.name) }} aria-hidden="true"><ContactAvatar src={row.avatarUrl} name={row.name} domain={row.companyDomain} /></span>
          <span className="dxp-nm">{row.name}</span>
          <span className="dxpp-job">{row.jobTitle ?? '—'}</span>
          {row.companyId
            ? <button type="button" className="dxpp-acc" onClick={(event) => { event.stopPropagation(); navigate(`/app/accounts/${row.companyId}`) }}>{row.companyName ?? 'Compte'}</button>
            : <span className="dxpp-acc muted">{row.companyName ?? '—'}</span>}
          <span className="dxp-dur">{durationLabel(row.relationSinceMonths)}</span>
          <span className="dxp-nps" style={{ color: scoreColor(row.score) }}>{row.score ?? '—'}{row.trend && <small>{row.trend === 'up' ? '↗' : row.trend === 'down' ? '↘' : '→'}</small>}</span>
          <span className="dxp-dur">{lastContactLabel(row.lastContactAt)}</span>
          <span className="dxp-chans" aria-label={`Canaux actifs : ${Object.entries(row.channels).filter(([, on]) => on).map(([channel]) => channel).join(', ') || 'aucun'}`}>
            {(Object.keys(CHANNEL_ICONS) as Array<keyof typeof CHANNEL_ICONS>).map((channel) => <span key={channel} className={`dxp-ch ${row.channels[channel] ? 'on' : ''}`}>{CHANNEL_ICONS[channel]}</span>)}
          </span>
          <button type="button" className="dxa-own" title={row.ownerName ? `Owner : ${row.ownerName} — changer` : 'Attribuer un owner'}
            aria-label={row.ownerName ? `Owner : ${row.ownerName} — changer` : 'Attribuer un owner'}
            onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setOwnerPopup({ personId: row.id, x: rect.left, y: rect.bottom }) }}>
            {row.ownerName ? initials(row.ownerName) : '+'}
          </button>
          <button type="button" className={`tgv ${row.watchEnabled ? 'on' : ''}`} aria-pressed={row.watchEnabled} aria-label={`Veille ${row.watchEnabled ? 'activée' : 'désactivée'} sur ${row.name}`}
            onClick={(event) => { event.stopPropagation(); toggleWatch(row) }} disabled={passation}><i /></button>
        </div>)}
      </div>
    </div>
    <div className="pa-note">Scores agrégés depuis les snapshots persistés du moteur relationnel · actualisé {new Date(overview.generatedAt).toLocaleTimeString('fr-FR')}</div>
    {integrateOpen && <CreatePersonModal workspaceId={context.workspaceId} onClose={() => setIntegrateOpen(false)} refresh={refresh} />}
    {ownerPopup && <MemberPicker overview={overview} anchor={ownerPopup}
      currentId={overview.people.find((row) => row.id === ownerPopup.personId)?.ownerId ?? null}
      onPick={pickOwner(ownerPopup.personId)} onClose={() => setOwnerPopup(null)} />}
    {(passation || passationClosing) && <div className="pa-bar-wrap"><div className={`pa-bar${passationClosing ? ' pa-bar-out' : ''}`} role="toolbar" aria-label="Actions groupées">
      <span className="pb-n"><b>{selection.size}</b> personne{selection.size > 1 ? 's' : ''} sélectionnée{selection.size > 1 ? 's' : ''}</span>
      <button type="button" className="pb-assign" disabled={!selection.size} onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setAssignAnchor({ x: rect.left, y: rect.top - 220 }) }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3l4 4-4 4M20 7H8" /></svg> Réattribuer
      </button>
      <button type="button" className="pb-delete" disabled={!selection.size} onClick={deleteSelection}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg> Supprimer
      </button>
      <button type="button" className="pb-cancel" aria-label="Fermer la sélection" onClick={closePassation}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div></div>}
    {assignAnchor && <MemberPicker overview={overview} anchor={assignAnchor} currentId={null} onPick={assignSelection} onClose={() => setAssignAnchor(null)} />}
  </div>
}

export default function PersonListPage({ context }: { context: PageContext }) {
  return <ToastProvider><PageBody context={context} /></ToastProvider>
}
