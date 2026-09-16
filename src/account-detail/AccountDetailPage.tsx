import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FormEvent, ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { displayName, initials } from '../lib/auth'
import { ToastProvider, useBusy } from '../person-detail/ui'
import { setTopbarHeader } from '../shell/topbarHeaderSignal'
import {
  enrichAccountRegistry,
  getAccountDetail,
  listAccountVisions,
  setAccountFavorite,
  setAccountWatch,
  type AccountVision,
} from './service'
import type { AccountDetailData } from './types'
import { V48AccountLiveView, V48AccountSourceNote } from './V48AccountViews'
import { AccountRelationView } from './AccountRelationView'
import { FicheSkeleton } from '../components/FicheSkeleton'
import { flagEnabled } from '../lib/featureFlags'
import { AccountHeader, AccountTabs } from './AccountHeader'
import '../styles/account-relation.css'
import '../styles/account-brain-v6.css'

type PageContext = { session: Session; workspaceId: string }
type AccountDetailTab = 'relation' | 'live'

const WATCH_FAMILIES = ['gouvernance', 'dirigeants', 'recrutements', 'événements légaux', 'financement', 'presse', 'appels d’offres', 'renouvellements', 'signaux métier', 'changements d’interlocuteurs']

function formatDate(value: string | null, fallback = 'À confirmer'): string {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date) : fallback
}

type IconName = 'pulse' | 'people' | 'bolt' | 'clock' | 'building' | 'signal'

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    pulse: <><path d="M3 12h4l2-5 4 10 2-5h6" /></>,
    people: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.4" /><path d="M3.5 20c.6-4 2.5-6 5.5-6s5 2 5.5 6M14 15c3.4-.4 5.5 1.2 6 4" /></>,
    bolt: <path d="M13 2 4.5 13.5H11L10 22 19.5 10H13Z" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    building: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h2m4 0h2M8 11h2m4 0h2M8 15h2m4 0h2M9 21v-3h6v3" /></>,
    signal: <><path d="M5 12a7 7 0 0 1 14 0M8 15a4 4 0 0 1 8 0" /><circle cx="12" cy="18" r="1" /></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

/** Sélecteur « Moi | [Nom] » côté compte — même principe que côté fiche
 *  personne (voir VisionSwitcher dans PersonDetailPage.tsx) : bascule entre
 *  ma propre vision de ce compte et celles qui m'ont été partagées, sans
 *  fusionner ni recalculer quoi que ce soit. Toujours visible, y compris en
 *  lecture seule. */
function VisionSwitcher({ visions, activeOwnerUserId, onSwitch }: { visions: AccountVision[]; activeOwnerUserId: string; onSwitch: (vision: AccountVision) => void }) {
  if (visions.length <= 1) return null
  return <div className="radar-src v48-vision-switcher" role="group" aria-label="Vision affichée">
    {visions.map((vision) => (
      <button
        key={vision.ownerUserId}
        type="button"
        className={vision.ownerUserId === activeOwnerUserId ? 'on' : ''}
        title={vision.shareNote ?? undefined}
        onClick={() => onSwitch(vision)}
      >
        {vision.isMine ? 'Moi' : vision.ownerName}
      </button>
    ))}
  </div>
}

export default function AccountDetailPage({ context }: { context: PageContext }) {
  const { accountId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [data, setData] = useState<AccountDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [watchOpen, setWatchOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<AccountDetailTab>('relation')
  // Sections V6 (Météo/Ce qui a changé récemment/Engagements) intégrées à la
  // Vue Relation elle-même — pas un onglet séparé (voir AccountWeatherV6.tsx).
  const [v6Enabled, setV6Enabled] = useState(false)
  useEffect(() => {
    void flagEnabled('scoring_v6_ui', { userId: context.session.user.id, organizationId: context.workspaceId })
      .then(setV6Enabled).catch(() => setV6Enabled(false))
  }, [context.session.user.id, context.workspaceId])
  const [coordsOpen, setCoordsOpen] = useState(false)
  const [visions, setVisions] = useState<AccountVision[]>([])
  // Même logique que côté fiche personne : la vision affichée peut vivre dans
  // une autre organisation que le workspace actif (compte partagé par un membre
  // d'une autre équipe).
  const [view, setView] = useState({ organizationId: searchParams.get('org') || context.workspaceId, companyId: accountId, ownerUserId: context.session.user.id })
  useEffect(() => {
    setView({ organizationId: searchParams.get('org') || context.workspaceId, companyId: accountId, ownerUserId: context.session.user.id })
  }, [context.session.user.id, context.workspaceId, accountId, searchParams])
  const refresh = useCallback(async () => {
    try {
      setError(null)
      const [detail, visionList] = await Promise.all([
        getAccountDetail(view.organizationId, view.companyId, view.ownerUserId),
        listAccountVisions(view.organizationId, view.companyId),
      ])
      setData(detail)
      setVisions(visionList)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Erreur inattendue') }
  }, [view.companyId, view.organizationId, view.ownerUserId])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!data) return
    setTopbarHeader({ backTo: '/app/accounts', backLabel: 'Retour', title: data.account.name })
    return () => setTopbarHeader(null)
  }, [data?.account.name])
  if (error === 'ACCOUNT_NOT_FOUND') return <div className="ra-state"><h1>Compte introuvable</h1><p>Ce compte n’existe pas ou n’est pas accessible dans ton workspace.</p><Link to="/app/accounts">Retour aux comptes</Link></div>
  if (error === 'ACCOUNT_FORBIDDEN') return <div className="ra-state error"><h1>Accès interdit</h1><p>Tu n’as pas accès à cette vision du compte.</p><Link to="/app/accounts">Retour aux comptes</Link></div>
  if (error) return <div className="ra-state error"><h1>Impossible de charger le compte</h1><p>{error}</p><button onClick={() => void refresh()}>Réessayer</button></div>
  if (!data) return <FicheSkeleton label="Chargement de la fiche compte…" />
  const account = data.account
  const activeVision = visions.find((vision) => vision.ownerUserId === view.ownerUserId)
  const readOnly = activeVision ? !activeVision.isMine : false
  const toggleFavorite = async () => { await setAccountFavorite(data, context.session.user.id, !account.favorite); await refresh() }
  const saveWatch = async (families: string[]) => { await setAccountWatch(data, context.session.user.id, true, families); setWatchOpen(false); await refresh() }
  return <ToastProvider><div className="pp account-pp">
    <VisionSwitcher visions={visions} activeOwnerUserId={view.ownerUserId} onSwitch={(vision) => setView({ organizationId: vision.organizationId, companyId: vision.companyId, ownerUserId: vision.ownerUserId })} />
    {readOnly && <div className="ra-degraded">Vision de {activeVision?.ownerName ?? 'un membre'} — lecture seule, reviens sur « Moi » pour éditer ta propre relation.</div>}
    {!readOnly && activeVision?.relationshipState === 'relationship_to_build' && <div className="ra-degraded"><strong>Relation à construire</strong><span>Aucun email, rendez-vous ou échange personnel pour le moment.</span></div>}
    {data.degradedReasons.length > 0 && <div className="ra-degraded"><strong>Données partielles</strong><span>{data.degradedReasons.join(' · ')}</span></div>}
    <AccountTabs activeTab={activeTab} onChange={setActiveTab} readOnly={readOnly} sources={data.sources} onOpenCoordinates={() => setCoordsOpen(true)} />
    <AccountHeader data={data} userId={context.session.user.id} readOnly={readOnly} toggleFavorite={toggleFavorite} openPeople={() => setActiveTab('live')} refresh={refresh} />
    {activeTab === 'relation' && <main className={`v48-tab-panel ${readOnly ? 'vision-readonly' : ''}`} role="tabpanel" inert={readOnly || undefined}><AccountRelationView data={data} userId={context.session.user.id} currentUserName={displayName(context.session.user)} refresh={refresh} navigate={navigate} organizationId={context.workspaceId} v6Enabled={v6Enabled} /></main>}
    {activeTab === 'live' && <div className={`v48-tab-panel ${readOnly ? 'vision-readonly' : ''}`} role="tabpanel" id="account-details-panel" inert={readOnly || undefined}><V48AccountLiveView data={data} userId={context.session.user.id} refresh={refresh} navigate={navigate} openWatch={() => setWatchOpen(true)} /></div>}
    <V48AccountSourceNote data={data} />
    {watchOpen && <WatchDialog selected={account.watchFamilies} onClose={() => setWatchOpen(false)} onSave={(families) => void saveWatch(families)} />}
    {coordsOpen && <AccountContactDialog data={data} navigate={navigate} refresh={refresh} onClose={() => setCoordsOpen(false)} />}
  </div></ToastProvider>
}

const AcctGlobeIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" /></svg>
const AcctPinIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s6.4-5.8 6.4-10.2a6.4 6.4 0 1 0-12.8 0C5.6 15.2 12 21 12 21z" /><circle cx="12" cy="10.6" r="2.3" /></svg>
const AcctBuildingIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="4.4" y="3.6" width="15.2" height="16.8" rx="2.2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>

/** Panneau latéral « Coordonnées » du compte (site, localisation, interlocuteurs) —
 *  glisse depuis la droite, réutilise le CSS .pc-* de la fiche personne via .pp. */
function AccountContactDialog({ data, navigate, refresh, onClose }: { data: AccountDetailData; navigate: (path: string) => void; refresh: () => Promise<void>; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const account = data.account
  const website = account.websiteUrl ?? (account.domain ? `https://${account.domain}` : null)
  const people = [...data.people].sort((a, b) => (b.exchangeShare ?? 0) - (a.exchangeShare ?? 0))
  const connected = data.sources.filter((source) => source.status === 'connected')
  const [busy, run] = useBusy()
  const [sirenInput, setSirenInput] = useState('')
  const [editingSiren, setEditingSiren] = useState(false)
  const fact = (key: string) => data.firmographics.find((item) => item.key === key) ?? null
  const registrationFact = fact('registration_number')
  const legalFormFact = fact('legal_form')
  const nafFact = fact('naf_code')
  const executivesFact = fact('executives')
  const legalRows = [registrationFact, legalFormFact, nafFact, executivesFact].filter((item): item is NonNullable<typeof item> => item !== null)
  const submitSiren = () => void run('siren', async () => {
    await enrichAccountRegistry(data, sirenInput.trim())
    setSirenInput('')
    setEditingSiren(false)
    await refresh()
  })

  return createPortal(
    <div className="pp">
    <div className="pc-mask" role="presentation" onClick={onClose}>
      <aside className="pc-panel" role="dialog" aria-label="Coordonnées du compte" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="pc-h">
          <div><p className="pc-title">Coordonnées</p><p className="pc-who">{account.name}</p></div>
          <button type="button" className="pc-x" onClick={onClose} aria-label="Fermer">×</button>
        </div>
        <div className="pc-b">
          <p className="pc-l">Web</p>
          <div className="pc-g">
            {website
              ? <a className="pc-row" href={website} target="_blank" rel="noreferrer">
                <span className="pc-i">{AcctGlobeIcon}</span>
                <div className="pc-c"><p className="pc-rl">Site web</p><p className="pc-v">{account.domain ?? website}</p></div>
                <span className="pc-a">Ouvrir</span>
              </a>
              : <div className="pc-row"><span className="pc-i">{AcctGlobeIcon}</span><div className="pc-c"><p className="pc-rl">Site web</p><p className="pc-v na">à confirmer</p></div></div>}
            {account.location && <div className="pc-row">
              <span className="pc-i">{AcctPinIcon}</span>
              <div className="pc-c"><p className="pc-rl">Localisation</p><p className="pc-v">{account.location}</p></div>
            </div>}
          </div>

          {people.length > 0 && <>
            <p className="pc-l">Interlocuteurs<span className="pc-n">{people.length}</span></p>
            <div className="pc-g">
              {people.map((person) => <Link key={person.id} className="pc-row" to={`/app/people/${person.id}`} onClick={onClose}>
                <span className="pc-i">{person.avatarUrl ? <img src={person.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} /> : initials(person.name)}</span>
                <div className="pc-c"><p className="pc-rl">{person.jobTitle ?? person.organizationalRole ?? 'Interlocuteur'}</p><p className="pc-v">{person.name}</p>{person.email && <p className="pc-s">{person.email}</p>}</div>
                <span className="pc-a">Ouvrir</span>
              </Link>)}
            </div>
          </>}

          <p className="pc-l">Identité légale</p>
          <div className="pc-g">
            {registrationFact && <div className="pc-row">
              <span className="pc-i">{AcctBuildingIcon}</span>
              <div className="pc-c"><p className="pc-rl">SIREN</p><p className="pc-v">{String(registrationFact.value)}</p></div>
              <a className="pc-a" href={registrationFact.provenance.sourceUrl ?? '#'} target="_blank" rel="noreferrer">Annuaire</a>
            </div>}
            {legalFormFact && <div className="pc-row">
              <span className="pc-i">{AcctBuildingIcon}</span>
              <div className="pc-c"><p className="pc-rl">Forme juridique</p><p className="pc-v">{String(legalFormFact.value)}{nafFact ? ` · NAF ${String(nafFact.value)}` : ''}</p></div>
            </div>}
            {executivesFact && <div className="pc-row">
              <span className="pc-i">{AcctBuildingIcon}</span>
              <div className="pc-c"><p className="pc-rl">Dirigeants</p><p className="pc-v">{String(executivesFact.value)}</p></div>
            </div>}
            {!legalRows.length && !editingSiren && <div className="pc-row"><span className="pc-i">{AcctBuildingIcon}</span><div className="pc-c"><p className="pc-rl">Identité légale</p><p className="pc-v na">à confirmer</p></div></div>}
            {editingSiren
              ? <form className="pc-add" onSubmit={(event) => { event.preventDefault(); submitSiren() }}>
                <input className="pc-add-input" autoFocus inputMode="numeric" maxLength={9} value={sirenInput} onChange={(event) => setSirenInput(event.target.value.replace(/\D/g, ''))} placeholder="SIREN (9 chiffres)" aria-label="SIREN" />
                <button className="pc-add-ok" disabled={busy !== null || sirenInput.length !== 9} aria-label="Enregistrer">✓</button>
                <button type="button" className="pc-add-no" onClick={() => { setEditingSiren(false); setSirenInput('') }} aria-label="Annuler">✕</button>
              </form>
              : <button type="button" className="pc-row pc-search" disabled={busy !== null} onClick={() => { setEditingSiren(true); setSirenInput(account.siren ?? '') }}>
                <span className="pc-i">{busy === 'siren' ? <span className="pc-spin" aria-hidden="true" /> : AcctBuildingIcon}</span>
                <div className="pc-c"><p className="pc-rl">{account.siren ? 'Actualiser' : 'Renseigner le SIREN'}</p><p className="pc-v">{busy === 'siren' ? 'Vérification en cours…' : account.siren ? `SIREN ${account.siren} · INSEE Sirene + INPI RNE` : 'Identité légale vérifiée via INSEE Sirene + INPI RNE'}</p></div>
              </button>}
          </div>

          {connected.length > 0 && <p className="pc-src"><i />{connected.map((source) => source.label).join(' · ')}</p>}
        </div>
      </aside>
    </div>
    </div>,
    document.body,
  )
}


function WatchDialog({ selected, onClose, onSave }: { selected: string[]; onClose: () => void; onSave: (families: string[]) => void }) {
  const [families, setFamilies] = useState(selected)
  return <div className="ra-dialog-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="ra-dialog" role="dialog" aria-modal="true" aria-labelledby="watch-title"><header><h2 id="watch-title">Configurer la veille Tohu</h2><button onClick={onClose} aria-label="Fermer">×</button></header>
      <p>Sélectionne uniquement les familles utiles à ce compte.</p><div className="ra-watch-list">{WATCH_FAMILIES.map((family) => <label key={family}><input type="checkbox" checked={families.includes(family)} onChange={(event) => setFamilies(event.target.checked ? [...families, family] : families.filter((item) => item !== family))} />{family}</label>)}</div>
      <footer><button onClick={onClose}>Annuler</button><button onClick={() => onSave(families)}>Activer la veille</button></footer>
    </section>
  </div>
}
