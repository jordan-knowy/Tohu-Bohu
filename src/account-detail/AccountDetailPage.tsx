import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { initials } from '../lib/auth'
import { saveSignalFeedback } from '../services/data'
import {
  addAccountNote,
  getAccountDetail,
  setAccountArchived,
  setAccountFavorite,
  setAccountWatch,
  updateRecommendationStatus,
} from './service'
import type { AccountDetailData, AccountPerson, Provenance } from './types'

type PageContext = { session: Session; workspaceId: string }

const WATCH_FAMILIES = ['gouvernance', 'dirigeants', 'recrutements', 'événements légaux', 'financement', 'presse', 'appels d’offres', 'renouvellements', 'signaux métier', 'changements d’interlocuteurs']
const FACT_LABELS: Record<string, string> = {
  legal_name: 'Raison sociale', registration_number: 'Identifiant légal', legal_form: 'Forme juridique',
  capital: 'Capital', naf_code: 'Code NAF', activity: 'Activité', address: 'Adresse',
  executives: 'Dirigeants', employee_range: 'Effectif', revenue: 'Chiffre d’affaires',
  profit: 'Résultat', fundraising_status: 'Financement', country: 'Pays',
}

function formatDate(value: string | null, fallback = 'À confirmer'): string {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date) : fallback
}

function relativeDate(value: string | null): string {
  if (!value) return 'Aucun contact'
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000))
  return days === 0 ? 'Aujourd’hui' : `Il y a ${days} j`
}

function scoreLabel(score: number | null): string {
  return score === null ? 'Données insuffisantes' : score >= 70 ? 'Relation solide' : score >= 50 ? 'Relation à consolider' : 'Relation fragile'
}

function valueLabel(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'À confirmer'
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(valueLabel).join(', ')
  return JSON.stringify(value)
}

function provenanceLabel(item: Provenance): string {
  const freshness = item.lastVerifiedAt ?? item.observedAt
  return `${item.sourceLabel}${freshness ? ` · ${formatDate(freshness)}` : ''}${item.confidence !== null ? ` · confiance ${item.confidence}%` : ''}${item.inferenceLevel ? ` · ${item.inferenceLevel}` : ''}`
}

function historyPoints(history: AccountDetailData['relationship']['history']): string {
  if (history.length < 2) return ''
  const width = 520
  const height = 130
  return history.map((item, index) => {
    const x = index / (history.length - 1) * width
    const y = height - item.score / 100 * height
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="ra-empty"><span>◇</span><strong>{title}</strong><p>{children}</p></div>
}

function Section({ id, title, subtitle, children, defaultOpen = true }: { id: string; title: string; subtitle: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return <section className="ra-panel">
    <button className="ra-panel-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
      <span><strong>{title}</strong><small>{subtitle}</small></span><b aria-hidden="true">{open ? '−' : '+'}</b>
    </button>
    {open && <div className="ra-panel-body" id={id}>{children}</div>}
  </section>
}

function SourceStrip({ data }: { data: AccountDetailData }) {
  const publicFacts = data.firmographics.length
  const inferred = data.signals.filter((signal) => signal.provenance.inferenceLevel && signal.provenance.inferenceLevel !== 'observed').length
  return <div className="ra-provenance">
    <span>Échanges : {data.relationship.totalInteractions}</span>
    <span>Données publiques : {publicFacts}</span>
    <span>Inférences : {inferred}</span>
    <span>Couverture équipe : {data.account.primaryOwnerName ?? 'À confirmer'}</span>
    <span>Actualisé le {formatDate(data.generatedAt)}</span>
  </div>
}

function Health({ data }: { data: AccountDetailData }) {
  const relation = data.relationship
  const points = historyPoints(relation.history)
  return <Section id="account-health" title="Santé du compte" subtitle="Score backend, évolution et couverture">
    <div className="ra-kpis">
      <article><span>Score agrégé</span><strong>{relation.score ?? '—'}</strong><small>{scoreLabel(relation.score)}</small></article>
      <article><span>Phase</span><strong>{relation.phase === 'unknown' ? 'À confirmer' : relation.phase}</strong><small>{relation.phaseDelta === null ? 'Variation indisponible' : `${relation.phaseDelta > 0 ? '+' : ''}${relation.phaseDelta}`}</small></article>
      <article><span>Interactions</span><strong>{relation.totalInteractions}</strong><small>Dernier échange {relativeDate(relation.lastInteractionAt).toLowerCase()}</small></article>
      <article><span>Confiance</span><strong>{relation.confidence === null ? '—' : `${relation.confidence}%`}</strong><small>Calculé le {formatDate(relation.computedAt)}</small></article>
    </div>
    <div className="ra-health-grid">
      <div className="ra-chart">
        <div className="ra-section-label">Historique réel du score</div>
        {points ? <><svg viewBox="0 0 520 130" role="img" aria-label={`Évolution du score sur ${relation.history.length} snapshots`}>
          <line x1="0" y1="32.5" x2="520" y2="32.5" /><line x1="0" y1="65" x2="520" y2="65" /><line x1="0" y1="97.5" x2="520" y2="97.5" />
          <polyline points={points} />
        </svg><div className="ra-chart-dates"><span>{formatDate(relation.history[0]?.computedAt ?? null)}</span><span>{formatDate(relation.history.at(-1)?.computedAt ?? null)}</span></div></> : <Empty title="Historique insuffisant">Les snapshots du score Compte apparaîtront ici après les calculs backend.</Empty>}
      </div>
      <div className="ra-coverage">
        <div className="ra-section-label">Contrôles relationnels</div>
        <Meter label="Couverture contacts" value={relation.contactCoverage} />
        <Meter label="Couverture décideurs" value={relation.decisionMakerCoverage} />
        <Meter label="Risque de concentration" value={relation.concentrationRisk} danger />
      </div>
    </div>
  </Section>
}

function Meter({ label, value, danger = false }: { label: string; value: number | null; danger?: boolean }) {
  return <div className="ra-meter"><div><span>{label}</span><b>{value === null ? 'À confirmer' : `${value}%`}</b></div><i><span className={danger ? 'danger' : ''} style={{ width: `${value ?? 0}%` }} /></i></div>
}

function PeopleMap({ people, navigate }: { people: AccountPerson[]; navigate: (path: string) => void }) {
  const [mode, setMode] = useState<'general' | 'coverage' | 'power'>('general')
  const shown = useMemo(() => {
    if (mode === 'power') return people.filter((person) => person.decisionRole)
    if (mode === 'coverage') return [...people].sort((a, b) => (b.exchangeShare ?? -1) - (a.exchangeShare ?? -1))
    return people
  }, [mode, people])
  return <Section id="account-people" title="Cartographie des interlocuteurs" subtitle={`${people.length} personne${people.length > 1 ? 's' : ''} liée${people.length > 1 ? 's' : ''}`}>
    <div className="ra-tabs" role="tablist" aria-label="Mode de cartographie">
      {([['general', 'Vue générale'], ['coverage', 'Couverture'], ['power', 'Pouvoir']] as const).map(([value, label]) =>
        <button role="tab" aria-selected={mode === value} className={mode === value ? 'active' : ''} onClick={() => setMode(value)} key={value}>{label}</button>)}
    </div>
    {!shown.length ? <Empty title={people.length ? 'Rôles de pouvoir non qualifiés' : 'Aucun interlocuteur lié'}>{people.length ? 'Les rôles décisionnels doivent être confirmés et persistés.' : 'Ajoute ou rattache un contact réel à ce compte.'}</Empty> :
      <div className="ra-people-map">{shown.map((person) => <button className="ra-person-card" key={person.id} onClick={() => navigate(`/app/people/${person.id}`)}>
        <span className="ra-person-avatar">{person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : initials(person.name)}</span>
        <span className="ra-person-copy"><strong>{person.name}</strong><small>{person.jobTitle ?? 'Fonction à confirmer'}</small><span>{person.decisionRole ?? person.relationshipRole ?? 'Rôle à confirmer'}</span></span>
        <span className="ra-person-score"><b>{person.score ?? '—'}</b><small>{person.score === null ? 'Données insuffisantes' : person.phase ?? 'Phase à confirmer'}</small></span>
        <span className="ra-person-meta">{person.exchangeShare === null ? 'Part des échanges inconnue' : `${person.exchangeShare}% des échanges`} · {relativeDate(person.lastInteractionAt)}</span>
      </button>)}</div>}
  </Section>
}

function Recommendations({ data, userId, refresh }: { data: AccountDetailData; userId: string; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null)
  const open = data.recommendations.filter((item) => item.status === 'open' || item.status === 'postponed')
  const act = async (id: string, status: 'completed' | 'dismissed' | 'postponed') => {
    setBusy(id)
    try { await updateRecommendationStatus(data, id, userId, status); await refresh() } finally { setBusy(null) }
  }
  return <Section id="account-recommendations" title="Recommandations et manœuvres" subtitle="Actions persistées, classées par priorité">
    {!open.length ? <Empty title="Aucune recommandation ouverte">Tohu n’affiche pas de conseil générique sans signal déclencheur persistant.</Empty> :
      <div className="ra-recommendations">{open.map((item) => <article key={item.id}>
        <div className="ra-rec-head"><span>{item.category}</span><b>Priorité {item.priority}</b></div>
        <h3>{item.title}</h3><p>{item.justification}</p>
        {item.recommendedAction && <strong className="ra-next-action">{item.recommendedAction}</strong>}
        <div className="ra-evidence">{provenanceLabel(item.provenance)}</div>
        <div className="ra-card-actions">
          <button disabled={busy === item.id} onClick={() => void act(item.id, 'completed')}>Marquer comme fait</button>
          <button disabled={busy === item.id} onClick={() => void act(item.id, 'postponed')}>Reporter</button>
          <button disabled={busy === item.id} onClick={() => void act(item.id, 'dismissed')}>Écarter</button>
          {item.personId && <Link to={`/app/people/${item.personId}`}>Ouvrir la personne</Link>}
        </div>
      </article>)}</div>}
  </Section>
}

function Memory({ data, userId, refresh }: { data: AccountDetailData; userId: string; refresh: () => Promise<void> }) {
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!content.trim()) return
    setSaving(true)
    try { await addAccountNote(data, userId, content.trim()); setContent(''); await refresh() } finally { setSaving(false) }
  }
  return <Section id="account-memory" title="Mémoire d’équipe" subtitle="Notes et décisions manuelles, distinctes des faits confirmés">
    <form className="ra-note-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor="account-note">Nourrir le compte</label>
      <textarea id="account-note" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Ajouter un contexte, une décision, un risque…" />
      <button disabled={saving || !content.trim()}>{saving ? 'Enregistrement…' : 'Ajouter à la mémoire'}</button>
    </form>
    {!data.memoryEntries.length ? <Empty title="Mémoire en construction">Aucune note d’équipe n’a encore été ajoutée.</Empty> :
      <div className="ra-memory-list">{data.memoryEntries.map((entry) => <article key={entry.id}><span>{entry.entryType}</span><p>{entry.content}</p><small>{entry.authorName} · {formatDate(entry.createdAt)} · {entry.visibility}</small></article>)}</div>}
  </Section>
}

function Firmographics({ data }: { data: AccountDetailData }) {
  const grouped = new Map<string, typeof data.firmographics>()
  data.firmographics.forEach((fact) => grouped.set(fact.key, [...(grouped.get(fact.key) ?? []), fact]))
  return <section className="ra-rail-card"><header><strong>Carte d’identité</strong><small>Firmographie sourcée</small></header>
    {!grouped.size ? <Empty title="Firmographie absente">Aucune donnée publique vérifiée n’est disponible.</Empty> :
      <div className="ra-facts">{[...grouped].map(([key, facts]) => {
        const fact = facts[0]!
        return <article key={key} className={facts.some((item) => item.validationStatus === 'conflicting') ? 'conflict' : ''}>
          <span>{FACT_LABELS[key] ?? key.replaceAll('_', ' ')}</span><strong>{valueLabel(fact.value)}</strong>
          <small>{provenanceLabel(fact.provenance)}</small>{facts.length > 1 && <em>{facts.length} sources — vérifier les contradictions</em>}
        </article>
      })}</div>}
  </section>
}

function Signals({ data, userId, refresh }: { data: AccountDetailData; userId: string; refresh: () => Promise<void> }) {
  const validate = async (id: string, verdict: 'confirmed' | 'dismissed') => { await saveSignalFeedback(id, userId, verdict); await refresh() }
  return <section className="ra-rail-card"><header><strong>Signaux du compte</strong><small>Faits, sources et inférences</small></header>
    {!data.signals.length ? <Empty title="Aucun signal">Aucun signal réel n’est actuellement rattaché à ce compte.</Empty> :
      <div className="ra-signal-list">{data.signals.map((signal) => <article key={signal.id}><span>{signal.type}</span><h3>{signal.title}</h3>{signal.summary && <p>{signal.summary}</p>}
        <small>{provenanceLabel(signal.provenance)}</small>
        <div><button className={signal.validationStatus === 'confirmed' ? 'active' : ''} onClick={() => void validate(signal.id, 'confirmed')}>Confirmer</button><button className={signal.validationStatus === 'dismissed' ? 'active' : ''} onClick={() => void validate(signal.id, 'dismissed')}>Infirmer</button></div>
      </article>)}</div>}
    <Link className="ra-rail-link" to={`/app/signals?accountId=${data.account.id}`}>Voir toute la veille →</Link>
  </section>
}

export default function AccountDetailPage({ context }: { context: PageContext }) {
  const { accountId = '' } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<AccountDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [watchOpen, setWatchOpen] = useState(false)
  const refresh = useCallback(async () => {
    try { setError(null); setData(await getAccountDetail(context.workspaceId, accountId)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Erreur inattendue') }
  }, [accountId, context.workspaceId])
  useEffect(() => { void refresh() }, [refresh])
  if (error === 'ACCOUNT_NOT_FOUND') return <div className="ra-state"><h1>Compte introuvable</h1><p>Ce compte n’existe pas ou n’est pas accessible dans ton workspace.</p><Link to="/app/accounts">Retour aux comptes</Link></div>
  if (error) return <div className="ra-state error"><h1>Impossible de charger le compte</h1><p>{error}</p><button onClick={() => void refresh()}>Réessayer</button></div>
  if (!data) return <div className="ra-skeleton" aria-label="Chargement de la fiche compte"><i /><i /><i /></div>
  const account = data.account
  const relation = data.relationship
  const toggleFavorite = async () => { await setAccountFavorite(data, context.session.user.id, !account.favorite); await refresh() }
  const saveWatch = async (families: string[]) => { await setAccountWatch(data, context.session.user.id, true, families); setWatchOpen(false); await refresh() }
  const archived = Boolean(account.archivedAt)
  const toggleArchived = async () => {
    if (!archived && !window.confirm(`Supprimer ${account.name} de Tohu ? Le compte sera masqué des listes mais l’historique réel (contacts, signaux, échanges) reste conservé — tu pourras le restaurer à tout moment.`)) return
    await setAccountArchived(data, context.session.user.id, !archived)
    await refresh()
  }
  return <>
    <div className="ra-page-actions"><Link to="/app/accounts">← Comptes</Link><div><button onClick={() => void toggleFavorite()} aria-pressed={account.favorite}>{account.favorite ? '★ Favori' : '☆ Ajouter aux favoris'}</button><Link to={`/app/ask?accountId=${account.id}`}>Demander à Tohu</Link><button onClick={() => void toggleArchived()} style={{ color: archived ? 'var(--sage)' : 'var(--coral)' }}>{archived ? 'Restaurer ce compte' : 'Supprimer ce compte'}</button></div></div>
    <section className={`ra-hero ${account.archivedAt ? 'archived' : ''}`}>
      <div className="ra-account-avatar">{account.logoUrl ? <img src={account.logoUrl} alt={`Logo de ${account.name}`} /> : initials(account.name)}</div>
      <div className="ra-account-identity"><div className="ra-eyebrow">{account.strategic ? 'Compte stratégique' : account.relationshipStatus ?? 'Statut à confirmer'}</div><h1>{account.name}</h1>
        {account.legalName && account.legalName !== account.name && <p>{account.legalName}</p>}
        <div className="ra-account-meta"><span>{account.sector ?? 'Secteur à confirmer'}</span><span>{account.location ?? 'Ville à confirmer'}</span><span>{account.accountType ?? 'Type à confirmer'}</span><span>Relation depuis {formatDate(account.relationshipStartedAt)}</span></div>
        <div className="ra-tags">{account.offerScope && <span>{account.offerScope}</span>}{account.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
      </div>
      <div className="ra-score-block"><span>Score relationnel du compte</span><strong>{relation.score ?? '—'}</strong><b>{scoreLabel(relation.score)}</b><small>Confiance {relation.confidence === null ? 'à confirmer' : `${relation.confidence}%`} · dernier contact {relativeDate(relation.lastInteractionAt).toLowerCase()}</small></div>
    </section>
    <SourceStrip data={data} />
    {data.degradedReasons.length > 0 && <div className="ra-degraded"><strong>Données partielles</strong><span>{data.degradedReasons.join(' · ')}</span></div>}
    <div className="ra-source-controls">
      <div>{data.sources.length ? data.sources.map((source) => <span className={source.status} key={source.provider}>{source.label} · {source.status} · {formatDate(source.lastSyncedAt)}</span>) : <span>Aucune source contributrice confirmée</span>}</div>
      <button onClick={() => setWatchOpen(true)} className={account.watchEnabled ? 'on' : ''}>Veille Tohu {account.watchEnabled ? 'activée' : 'désactivée'}</button>
      <Link to="/app/connectors">Gérer les connecteurs</Link>
    </div>
    {watchOpen && <WatchDialog selected={account.watchFamilies} onClose={() => setWatchOpen(false)} onSave={(families) => void saveWatch(families)} />}
    <div className="ra-layout"><div className="ra-primary">
      <Health data={data} />
      <Recommendations data={data} userId={context.session.user.id} refresh={refresh} />
      <PeopleMap people={data.people} navigate={navigate} />
      <Memory data={data} userId={context.session.user.id} refresh={refresh} />
    </div><aside className="ra-rail"><Firmographics data={data} /><Signals data={data} userId={context.session.user.id} refresh={refresh} /></aside></div>
  </>
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
