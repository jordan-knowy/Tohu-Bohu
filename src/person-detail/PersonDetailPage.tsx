import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useParams } from 'react-router-dom'
import { initials } from '../lib/auth'
import { verifySuperAdmin } from '../super-admin/service'
import { getPersonDetail, setPersonArchived, setPersonFavorite, setPersonRoles, setPersonWatch, triggerPersonEnrichment } from './service'
import { BehaviorSection, RecommendationsSection, RelationSection } from './sections'
import { CareerSection, ContactsCard, HistoryCard, MemoryCard, SignalsCard } from './sections2'
import { DECISION_ROLES, RELATIONSHIP_TYPES, type PersonDetailData } from './types'
import { ToastProvider, formatDate, phaseLabel, provenanceLabel, relativeDate, scoreTone, useBusy, useToast } from './ui'

type PageContext = { workspaceId: string; userId: string }

const RELATION_COLORS: Record<string, string> = {
  Prospect: '#2896A8', Client: '#2EA86A', Partenaire: '#6E50C8', 'Fournisseur / Prestataire': '#C97A20',
  Investisseur: '#D94F63', Interne: '#8B83A8', 'Réseau': '#3C3489',
}
const RELATION_VERBS: Record<string, string> = {
  Prospect: 'convertir', Client: 'fidéliser', Partenaire: 'capitaliser', 'Fournisseur / Prestataire': 'entretenir',
  Investisseur: 'rassurer', Interne: 'aligner', 'Réseau': 'cultiver',
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

function Hero({ data, userId, refresh }: { data: PersonDetailData; userId: string; refresh: () => Promise<void> }) {
  const toast = useToast()
  const [, run] = useBusy()
  const person = data.person
  const relation = data.relationship
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
  return <div className="hero-header">
    <div className="hero-body">
      <div className="hero-left">
        <div>
          <div className="hero-name">{person.fullName}</div>
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
              options={DECISION_ROLES.map((value) => ({ value, hint: ROLE_POWER[value] ?? '' }))}
              onSelect={setRole}
            />
            {person.relationshipRole && <span className="mh-pill mh-pill-v">{person.relationshipRole}</span>}
            {person.jobTitle && <span className="mh-pill">{person.jobTitle}</span>}
          </div>
          {data.summary
            ? <div className="k-accroche">
              <span className="k-acc-ic" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="#6E50C8"><path d="M12 2l1.9 5.8L20 9l-5.4 1.6L12 16l-1.6-5.4L4 9l6.1-1.2z" /></svg></span>
              <span><b>{data.summary.text}</b></span>
              <span className="k-acc-src">{provenanceLabel(data.summary.provenance)}</span>
            </div>
            : <div className="k-accroche k-acc-empty">
              <span>Tohu ne dispose pas encore de suffisamment d’éléments pour produire une synthèse fiable.</span>
            </div>}
        </div>
      </div>
      <div className="hero-right">
        <div className="hero-score-block">
          <div className="hero-score-val" style={{ color: relation.score === null ? 'rgba(212,197,245,.4)' : scoreTone(relation.score) }}>{relation.score ?? '—'}</div>
          <div className="hero-score-label">Score relationnel</div>
          <div className="hero-score-trend" style={{ color: 'var(--sage-l)' }}>{relation.score === null ? 'données insuffisantes' : phaseLabel(relation.phase)}</div>
        </div>
        <div className="hero-divider" />
        <div className="hero-conf-block">
          <div className="hero-conf-ring" style={{ background: relation.confidence === null ? 'conic-gradient(#3a2f66 0 100%)' : `conic-gradient(var(--violet) 0 ${Math.round(relation.confidence)}%,rgba(255,255,255,.1) ${Math.round(relation.confidence)}% 100%)` }}>
            <span className="hero-conf-val">{relation.confidence === null ? '—' : `${Math.round(relation.confidence)}%`}</span>
          </div>
          <div className="hero-conf-label">Confiance</div>
        </div>
        <div className="hero-photo">
          {person.avatarUrl ? <img alt={person.fullName} src={person.avatarUrl} /> : <span className="hero-av" aria-hidden="true">{initials(person.fullName)}</span>}
        </div>
      </div>
    </div>
  </div>
}

function ControlCards({ data, userId, refresh }: { data: PersonDetailData; userId: string; refresh: () => Promise<void> }) {
  const toast = useToast()
  const [busy, run] = useBusy()
  const toggleWatch = () => void run('watch', async () => {
    await setPersonWatch(data, userId, !data.person.watchEnabled)
    toast(data.person.watchEnabled ? 'Veille désactivée.' : 'Veille activée — signaux internes & externes.')
    await refresh()
  })
  return <div className="kctrl">
    {data.employment
      ? <div className="acct-block">
        <span className="acct-mono" aria-hidden="true">{data.employment.accountLogoUrl ? <img src={data.employment.accountLogoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} /> : initials(data.employment.accountName)}</span>
        <div className="acct-info">
          <div className="acct-eyebrow">Compte</div>
          <div className="acct-name">{data.employment.accountName}</div>
        </div>
        <Link className="acct-btn" to={`/app/accounts/${data.employment.accountId}`}>Voir la fiche compte →</Link>
      </div>
      : <div className="acct-block">
        <span className="acct-mono" aria-hidden="true">◇</span>
        <div className="acct-info">
          <div className="acct-eyebrow">Compte</div>
          <div className="acct-name">Aucun compte associé</div>
        </div>
      </div>}
    <div className="kveille">
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
  </div>
}

function SourceBar({ data }: { data: PersonDetailData }) {
  return <div className="ctx-grid">
    {!data.sources.length && <span className="src-tile"><span className="src-name">Aucune source connectée pour cette personne</span></span>}
    {data.sources.map((source) => <div className="src-tile" key={source.provider} title={source.error ?? (source.lastSyncedAt ? `Dernière synchro : ${formatDate(source.lastSyncedAt)}` : 'Jamais synchronisé')}>
      <span className="src-name">{source.label}</span>
      <span className={`src-led ${source.status === 'connected' ? 'on' : 'off'}`} aria-label={source.status === 'connected' ? 'connecté' : source.status} />
      {source.interactionCount !== null && <span className="src-count">{source.interactionCount}</span>}
      {source.error && <span className="src-count" style={{ color: 'var(--coral)' }}>erreur</span>}
    </div>)}
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
  return <div className={`kfav ${data.person.favorite ? 'on' : ''}`}>
    <button type="button" className="kfav-star" disabled={busy !== null} aria-pressed={data.person.favorite} aria-label={data.person.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'} onClick={toggle}>★</button>
    <div className="kfav-b">
      <div className="kfav-t">{data.person.favorite ? 'Dans tes favoris' : 'Ajouter aux favoris'}</div>
      <div className="kfav-d">Favori personnel — visible uniquement par toi.</div>
    </div>
    <Link className="kfav-w" to={`/app/ask?personId=${data.person.id}`}>Demander à Tohu</Link>
  </div>
}

const TrashIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
const RestoreIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4v6h6" /><path d="M4.5 13a8 8 0 1 0 2-8.5L4 10" /></svg>

function ArchiveIconButton({ data, userId, refresh }: { data: PersonDetailData; userId: string; refresh: () => Promise<void> }) {
  const toast = useToast()
  const [busy, run] = useBusy()
  const archived = Boolean(data.person.archivedAt)
  const toggle = () => {
    if (!archived && !window.confirm(`Supprimer ${data.person.fullName} de Tohu ? La fiche sera masquée des listes mais l’historique réel (emails, réunions, signaux) reste conservé — tu pourras la restaurer à tout moment.`)) return
    void run('archive', async () => {
      await setPersonArchived(data, userId, !archived)
      window.dispatchEvent(new Event('tohu:workspace-updated'))
      toast(archived ? `${data.person.fullName} restaurée.` : `${data.person.fullName} supprimée des listes.`)
      await refresh()
    })
  }
  return <button type="button" className="kfav-star" disabled={busy !== null} title={archived ? 'Restaurer cette personne' : 'Supprimer cette personne'} aria-label={archived ? 'Restaurer cette personne' : 'Supprimer cette personne'} onClick={toggle} style={{ color: archived ? 'var(--sage)' : 'var(--coral)' }}>
    <span style={{ width: 16, height: 16, display: 'inline-flex' }}>{archived ? RestoreIcon : TrashIcon}</span>
  </button>
}

function EnrichPersonButton({ data }: { data: PersonDetailData }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = () => void (async () => {
    setBusy(true)
    try {
      const result = await triggerPersonEnrichment(data.person.id)
      toast(result.enriched > 0 ? `${data.person.fullName} enrichie via l’agent IA.` : 'Aucune donnée fiable retournée par le moteur d’enrichissement.')
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Enrichissement impossible.')
    } finally {
      setBusy(false)
    }
  })()
  return <button type="button" className="kfav-star" disabled={busy} title="Enrichir maintenant (super admin)" aria-label="Enrichir maintenant" onClick={run}>
    <span style={{ fontSize: 14 }}>{busy ? '…' : '✨'}</span>
  </button>
}

function PageBody({ data, userId, refresh, isSuperAdmin }: { data: PersonDetailData; userId: string; refresh: () => Promise<void>; isSuperAdmin: boolean }) {
  return <>
    <div className="pp-back" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <Link to="/app/people">← Personnes</Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {isSuperAdmin && <EnrichPersonButton data={data} />}
        <ArchiveIconButton data={data} userId={userId} refresh={refresh} />
      </div>
    </div>
    {data.person.archivedAt && <div className="pp-degraded">Personne archivée le {formatDate(data.person.archivedAt)} — fiche en lecture seule recommandée.</div>}
    {data.degradedReasons.length > 0 && <div className="pp-degraded"><strong>Données partielles</strong> {data.degradedReasons.join(' · ')}</div>}
    <div className="page">
      <div className="col-main">
        <Hero data={data} userId={userId} refresh={refresh} />
        <ControlCards data={data} userId={userId} refresh={refresh} />
        <SourceBar data={data} />
        <FavoriteRow data={data} userId={userId} refresh={refresh} />
        <RelationSection data={data} />
        <RecommendationsSection data={data} userId={userId} refresh={refresh} />
        <BehaviorSection data={data} />
        <CareerSection data={data} userId={userId} refresh={refresh} />
        <MemoryCard data={data} userId={userId} refresh={refresh} />
        <HistoryCard data={data} />
        <div className="pp-footnote">
          Tohu · {data.person.fullName} — chaque bloc est alimenté par des données persistées et sourcées ({relativeDate(data.relationship.lastInteractionAt).toLowerCase()} pour le dernier échange observé). Les informations non vérifiées sont marquées « à confirmer ».
        </div>
      </div>
      <aside className="rail">
        <ContactsCard data={data} userId={userId} refresh={refresh} />
        <SignalsCard data={data} userId={userId} refresh={refresh} />
      </aside>
    </div>
  </>
}

export default function PersonDetailPage({ context }: { context: PageContext }) {
  const { personId = '' } = useParams()
  const [data, setData] = useState<PersonDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const refresh = useCallback(async () => {
    try {
      setError(null)
      setData(await getPersonDetail(context.workspaceId, personId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Erreur inattendue')
    }
  }, [context.workspaceId, personId])
  useEffect(() => { setData(null); void refresh() }, [refresh])
  useEffect(() => { void verifySuperAdmin().then(setIsSuperAdmin).catch(() => setIsSuperAdmin(false)) }, [])

  if (error === 'PERSON_NOT_FOUND') return <div className="ra-state"><h1>Personne introuvable</h1><p>Cette personne n’existe pas ou n’est pas accessible dans ton workspace.</p><Link to="/app/people">Retour aux personnes</Link></div>
  if (error === 'PERSON_FORBIDDEN') return <div className="ra-state error"><h1>Accès interdit</h1><p>Tu n’as pas les droits nécessaires pour consulter cette personne.</p><Link to="/app/people">Retour aux personnes</Link></div>
  if (error) return <div className="ra-state error"><h1>Impossible de charger la personne</h1><p>{error}</p><button onClick={() => void refresh()}>Réessayer</button></div>
  if (!data) return <div className="ra-skeleton" aria-label="Chargement de la fiche personne"><i /><i /><i /></div>

  return <ToastProvider>
    <div className="pp">
      <PageBody data={data} userId={context.userId} refresh={refresh} isSuperAdmin={isSuperAdmin} />
    </div>
  </ToastProvider>
}
