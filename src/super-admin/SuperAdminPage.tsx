import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { tohuLogo } from '../components/logo'
import { initials } from '../lib/auth'
import {
  getSuperAdminData, setUserAccess, verifySuperAdmin,
  type SuperAdminConsole, type SuperAdminKpis, type SuperAdminTimeseriesPoint, type SuperAdminUser,
} from './service'

type Tab = 'overview' | 'users' | 'subscriptions' | 'product' | 'operations'
type MetricFormat = 'number' | 'percent' | 'currency' | 'duration'

const NAVIGATION: Array<{ id: Tab; label: string; copy: string; icon: string }> = [
  { id: 'overview', label: 'Vue d’ensemble', copy: 'Santé globale', icon: '⌁' },
  { id: 'users', label: 'Utilisateurs', copy: 'Accès & activité', icon: '◎' },
  { id: 'subscriptions', label: 'Abonnements', copy: 'Plans & revenus', icon: '◇' },
  { id: 'product', label: 'Usage produit', copy: 'Adoption & valeur', icon: '↗' },
  { id: 'operations', label: 'Opérations', copy: 'Sync & fiabilité', icon: '⎔' },
]

const ACCOUNT_LABELS: Record<SuperAdminUser['account_type'], string> = {
  free: 'Gratuit',
  paid: 'Payant',
  test: 'Test',
  super_admin: 'Super Admin',
}

const integerFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })
const compactFormatter = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 })
const currencyFormatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
const dateFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' })
const dateTimeFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })

function metric(value: number | null | undefined, format: MetricFormat = 'number'): string {
  if (value === null || value === undefined) return '—'
  if (format === 'currency') return currencyFormatter.format(value / 100)
  if (format === 'percent') return `${integerFormatter.format(value)} %`
  if (format === 'duration') return `${integerFormatter.format(value)} s`
  return integerFormatter.format(value)
}

function when(value: string | null): string {
  return value ? dateTimeFormatter.format(new Date(value)) : 'Jamais'
}

function MetricCard({ label, value, format, tone = 'violet', detail }: {
  label: string
  value: number | null | undefined
  format?: MetricFormat
  tone?: 'violet' | 'green' | 'amber' | 'pink'
  detail?: string
}) {
  return <article className={`sa-metric tone-${tone}`}>
    <span>{label}</span>
    <strong>{metric(value, format)}</strong>
    <small>{detail ?? 'Donnée de production'}</small>
  </article>
}

function LineChart({ data, series, title, subtitle }: {
  data: SuperAdminTimeseriesPoint[]
  series: Array<{ key: keyof SuperAdminTimeseriesPoint; label: string; color: string }>
  title: string
  subtitle: string
}) {
  const width = 760
  const height = 250
  const pad = { left: 34, right: 18, top: 24, bottom: 30 }
  const numericValues = data.flatMap((point) => series.map((item) => Number(point[item.key]) || 0))
  const max = Math.max(1, ...numericValues)
  const x = (index: number) => pad.left + index * (width - pad.left - pad.right) / Math.max(1, data.length - 1)
  const y = (value: number) => pad.top + (max - value) * (height - pad.top - pad.bottom) / max
  const path = (key: keyof SuperAdminTimeseriesPoint) => data
    .map((point, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(1)} ${y(Number(point[key]) || 0).toFixed(1)}`)
    .join(' ')

  return <article className="sa-chart-card">
    <header><div><h3>{title}</h3><p>{subtitle}</p></div><div className="sa-chart-legend">{series.map((item) => <span key={String(item.key)}><i style={{ background: item.color }} />{item.label}</span>)}</div></header>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
      {[0, .25, .5, .75, 1].map((ratio) => {
        const value = Math.round(max * (1 - ratio))
        const lineY = pad.top + ratio * (height - pad.top - pad.bottom)
        return <g key={ratio}><line x1={pad.left} y1={lineY} x2={width - pad.right} y2={lineY} className="sa-grid-line" /><text x={pad.left - 8} y={lineY + 3} textAnchor="end">{value}</text></g>
      })}
      {series.map((item) => <g key={String(item.key)}>
        <path d={path(item.key)} fill="none" stroke={item.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {data.map((point, index) => <circle key={point.date} cx={x(index)} cy={y(Number(point[item.key]) || 0)} r="2.5" fill={item.color}><title>{`${dateFormatter.format(new Date(point.date))} · ${item.label} : ${point[item.key]}`}</title></circle>)}
      </g>)}
      {data.filter((_, index) => index % 7 === 0 || index === data.length - 1).map((point) => {
        const index = data.indexOf(point)
        return <text key={point.date} x={x(index)} y={height - 8} textAnchor="middle">{new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(new Date(point.date))}</text>
      })}
    </svg>
  </article>
}

function PlanDistribution({ users }: { users: SuperAdminUser[] }) {
  const counts = (Object.keys(ACCOUNT_LABELS) as SuperAdminUser['account_type'][]).map((type) => ({
    type,
    value: users.filter((user) => user.account_type === type).length,
  }))
  const total = Math.max(1, users.length)
  return <article className="sa-chart-card sa-distribution">
    <header><div><h3>Répartition des accès</h3><p>Classification actuelle des utilisateurs</p></div></header>
    <div className="sa-distribution-bar">{counts.map((item) => <i key={item.type} className={`type-${item.type}`} style={{ width: `${item.value / total * 100}%` }} />)}</div>
    <div className="sa-distribution-list">{counts.map((item) => <div key={item.type}><span><i className={`type-${item.type}`} />{ACCOUNT_LABELS[item.type]}</span><strong>{item.value}</strong><small>{integerFormatter.format(item.value / total * 100)} %</small></div>)}</div>
  </article>
}

function UserDetail({ user, plans, saving, onSave, onClose }: {
  user: SuperAdminUser
  plans: SuperAdminConsole['plans']
  saving: boolean
  onSave: (access: SuperAdminUser['account_type'], plan?: string) => Promise<void>
  onClose: () => void
}) {
  const [access, setAccess] = useState(user.account_type)
  const paidPlans = plans.filter((plan) => !['free', 'tester', 'super_admin'].includes(plan.id) && plan.price_monthly > 0)
  const initialPaid = paidPlans.some((plan) => plan.id === user.plan_id) ? user.plan_id : (paidPlans[0]?.id ?? 'pro')
  const [paidPlan, setPaidPlan] = useState(initialPaid)
  useEffect(() => {
    setAccess(user.account_type)
    setPaidPlan(paidPlans.some((plan) => plan.id === user.plan_id) ? user.plan_id : (paidPlans[0]?.id ?? 'pro'))
  }, [user.user_id, user.account_type, user.plan_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = [
    ['Comptes', user.companies_count],
    ['Personnes', user.contacts_count],
    ['Réunions', user.meetings_count],
    ['Briefs', user.briefs_count],
    ['Emails analysés', user.messages_count],
    ['Appels IA', user.ai_calls_count],
    ['Tokens IA', user.ai_tokens_count],
    ['Connecteurs', user.connectors_count],
  ] as const

  return <aside className="sa-user-detail">
    <div className="sa-user-detail__head">
      <div className="sa-user-avatar large">{user.avatar_url ? <img src={user.avatar_url} alt="" /> : initials(user.full_name)}</div>
      <div><span className={`sa-type type-${user.account_type}`}>{ACCOUNT_LABELS[user.account_type]}</span><h2>{user.full_name}</h2><p>{user.email ?? 'Email indisponible'}</p></div>
      <button type="button" onClick={onClose} aria-label="Fermer">×</button>
    </div>
    <div className="sa-detail-meta">
      <div><span>Workspace</span><strong>{user.organization_name ?? 'Sans workspace'}</strong></div>
      <div><span>Inscription</span><strong>{dateFormatter.format(new Date(user.created_at))}</strong></div>
      <div><span>Dernière activité</span><strong>{when(user.last_activity_at)}</strong></div>
      <div><span>Onboarding</span><strong>{user.onboarding_completed ? 'Terminé' : 'À terminer'}</strong></div>
    </div>
    <div className="sa-detail-stats">{stats.map(([label, value]) => <div key={label}><span>{label}</span><strong>{compactFormatter.format(value)}</strong></div>)}</div>
    <section className="sa-access-editor">
      <div><h3>Type de compte</h3><p>Le changement est appliqué immédiatement.</p></div>
      <div className="sa-access-options">{(Object.keys(ACCOUNT_LABELS) as SuperAdminUser['account_type'][]).map((type) => <button key={type} type="button" className={access === type ? 'active' : ''} onClick={() => setAccess(type)}><i className={`type-${type}`} />{ACCOUNT_LABELS[type]}</button>)}</div>
      {access === 'paid' && <label>Plan payant<select value={paidPlan} onChange={(event) => setPaidPlan(event.target.value)}>{paidPlans.map((plan) => <option value={plan.id} key={plan.id}>{plan.name} · {currencyFormatter.format(plan.price_monthly / 100)}/mois</option>)}</select></label>}
      <button className="sa-primary-action" type="button" disabled={saving || (access === user.account_type && (access !== 'paid' || paidPlan === user.plan_id))} onClick={() => void onSave(access, access === 'paid' ? paidPlan : undefined)}>{saving ? 'Application…' : 'Appliquer ce type de compte'}</button>
    </section>
    <section className="sa-health-block">
      <h3>Fiabilité de la synchronisation</h3>
      <div><span>Jobs lancés</span><strong>{user.sync_jobs_count}</strong></div>
      <div><span>Échecs</span><strong className={user.sync_failures_count ? 'danger' : ''}>{user.sync_failures_count}</strong></div>
      <div><span>Taux de réussite</span><strong>{user.sync_jobs_count ? `${integerFormatter.format((user.sync_jobs_count - user.sync_failures_count) / user.sync_jobs_count * 100)} %` : '—'}</strong></div>
    </section>
  </aside>
}

function UsersView({ consoleData, refresh }: { consoleData: SuperAdminConsole; refresh: () => Promise<void> }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | SuperAdminUser['account_type']>('all')
  const [sort, setSort] = useState<'recent' | 'name' | 'activity' | 'type'>('recent')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const users = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = consoleData.users.filter((user) =>
      (filter === 'all' || user.account_type === filter)
      && (!needle || `${user.full_name} ${user.email ?? ''} ${user.organization_name ?? ''}`.toLowerCase().includes(needle)))
    return [...rows].sort((a, b) => {
      if (sort === 'name') return a.full_name.localeCompare(b.full_name)
      if (sort === 'activity') return (b.last_activity_at ?? '').localeCompare(a.last_activity_at ?? '')
      if (sort === 'type') return a.account_type.localeCompare(b.account_type) || a.full_name.localeCompare(b.full_name)
      return b.created_at.localeCompare(a.created_at)
    })
  }, [consoleData.users, filter, query, sort])
  const selected = consoleData.users.find((user) => user.user_id === selectedId) ?? null

  const save = async (access: SuperAdminUser['account_type'], plan?: string) => {
    if (!selected) return
    setSaving(true)
    setFeedback(null)
    try {
      await setUserAccess(selected.user_id, access, plan)
      await refresh()
      setFeedback(`L’accès de ${selected.full_name} a été mis à jour.`)
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'Modification impossible.')
    } finally {
      setSaving(false)
    }
  }

  return <div className={`sa-users-layout ${selected ? 'has-detail' : ''}`}>
    <section className="sa-users-main">
      <div className="sa-view-heading"><div><p>Annuaire plateforme</p><h1>Utilisateurs</h1><span>{consoleData.users.length} comptes enregistrés</span></div></div>
      {feedback && <div className="sa-feedback">{feedback}</div>}
      <div className="sa-user-tools">
        <label className="sa-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un nom, email ou workspace…" /></label>
        <div className="sa-filter-tabs"><button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Tous <b>{consoleData.users.length}</b></button>{(Object.keys(ACCOUNT_LABELS) as SuperAdminUser['account_type'][]).map((type) => <button type="button" key={type} className={filter === type ? 'active' : ''} onClick={() => setFilter(type)}>{ACCOUNT_LABELS[type]} <b>{consoleData.users.filter((user) => user.account_type === type).length}</b></button>)}</div>
        <label className="sa-sort">Trier par<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="recent">Inscription récente</option><option value="activity">Dernière activité</option><option value="name">Nom</option><option value="type">Type de compte</option></select></label>
      </div>
      <div className="sa-users-table">
        <div className="sa-users-row head"><span>Utilisateur</span><span>Type</span><span>Workspace</span><span>Activité</span><span>Usage</span><span /></div>
        {users.map((user) => <button type="button" className={`sa-users-row ${selectedId === user.user_id ? 'active' : ''}`} key={user.user_id} onClick={() => setSelectedId(user.user_id)}>
          <span className="sa-user-identity"><i className="sa-user-avatar">{user.avatar_url ? <img src={user.avatar_url} alt="" /> : initials(user.full_name)}</i><span><strong>{user.full_name}</strong><small>{user.email ?? 'Sans email'}</small></span></span>
          <span><i className={`sa-type type-${user.account_type}`}>{ACCOUNT_LABELS[user.account_type]}</i><small>{user.plan_id}</small></span>
          <span><strong>{user.organization_name ?? '—'}</strong><small>{user.membership_role ?? 'Sans rôle'}</small></span>
          <span><strong>{when(user.last_activity_at)}</strong><small>{user.onboarding_completed ? 'Onboarding terminé' : 'Onboarding incomplet'}</small></span>
          <span><strong>{compactFormatter.format(user.ai_calls_count)} appels IA</strong><small>{user.contacts_count} personnes · {user.meetings_count} réunions</small></span>
          <span className="sa-row-arrow">→</span>
        </button>)}
        {!users.length && <div className="sa-empty">Aucun utilisateur ne correspond à ces filtres.</div>}
      </div>
    </section>
    {selected && <UserDetail user={selected} plans={consoleData.plans} saving={saving} onSave={save} onClose={() => setSelectedId(null)} />}
  </div>
}

function Overview({ kpis, consoleData }: { kpis: SuperAdminKpis; consoleData: SuperAdminConsole }) {
  return <>
    <div className="sa-view-heading hero"><div><p>Vue consolidée</p><h1>Tout Tohu,<br /><em>en un regard.</em></h1></div><span>30 derniers jours · données de production</span></div>
    <div className="sa-key-metrics">
      <MetricCard label="Utilisateurs" value={kpis.users.total} detail={`+${metric(kpis.users.new_30d)} sur 30 jours`} />
      <MetricCard label="Actifs mensuels" value={kpis.users.monthly_active} tone="green" detail={`${metric(kpis.users.onboarding_rate, 'percent')} onboardés`} />
      <MetricCard label="MRR" value={kpis.finance.mrr_cents} format="currency" tone="amber" detail={`${metric(kpis.finance.arr_cents, 'currency')} ARR`} />
      <MetricCard label="Santé des synchronisations" value={kpis.operations.sync_success_rate_24h} format="percent" tone="pink" detail={`${metric(kpis.operations.sync_jobs_24h)} jobs sur 24 h`} />
    </div>
    <div className="sa-chart-grid">
      <LineChart data={consoleData.timeseries} title="Acquisition & activation" subtitle="Nouveaux comptes et utilisateurs actifs par jour" series={[{ key: 'active_users', label: 'Actifs', color: '#9b7cf4' }, { key: 'signups', label: 'Inscriptions', color: '#58d6a5' }]} />
      <PlanDistribution users={consoleData.users} />
    </div>
    <div className="sa-summary-grid">
      <section><header><span>Produit</span><h2>Valeur délivrée</h2></header><div><MetricCard label="Personnes" value={kpis.product.contacts} /><MetricCard label="Comptes" value={kpis.product.companies} /><MetricCard label="Signaux" value={kpis.product.signals} /><MetricCard label="Connecteurs actifs" value={kpis.product.connected_connectors} /></div></section>
      <section><header><span>Portefeuille</span><h2>Workspaces</h2></header><div><MetricCard label="Total" value={kpis.workspaces.total} /><MetricCard label="Actifs" value={kpis.workspaces.active} /><MetricCard label="Membres moyens" value={kpis.workspaces.avg_members} /><MetricCard label="Comptes moyens" value={kpis.workspaces.avg_companies} /></div></section>
    </div>
  </>
}

function SubscriptionView({ kpis, users }: { kpis: SuperAdminKpis; users: SuperAdminUser[] }) {
  return <>
    <div className="sa-view-heading"><div><p>Monétisation</p><h1>Abonnements</h1><span>Plans, revenu et cycle de vie</span></div></div>
    <div className="sa-key-metrics">
      <MetricCard label="MRR" value={kpis.finance.mrr_cents} format="currency" />
      <MetricCard label="ARR" value={kpis.finance.arr_cents} format="currency" tone="green" />
      <MetricCard label="Panier moyen" value={kpis.finance.average_revenue_per_workspace_cents} format="currency" tone="amber" />
      <MetricCard label="Utilisateurs payants" value={kpis.users.paying} tone="pink" />
    </div>
    <div className="sa-chart-grid"><PlanDistribution users={users} /><section className="sa-plan-cards">{['free', 'solo', 'pro', 'business'].map((plan) => <article key={plan}><span>{plan}</span><strong>{metric(kpis.subscriptions[plan])}</strong><small>abonnements</small></article>)}</section></div>
    <div className="sa-summary-grid one"><section><header><span>Cycle de vie</span><h2>État des abonnements</h2></header><div><MetricCard label="Actifs" value={kpis.subscriptions.active} /><MetricCard label="Essais" value={kpis.subscriptions.trialing} /><MetricCard label="Annulés" value={kpis.subscriptions.canceled} /><MetricCard label="Paiements échoués" value={kpis.subscriptions.past_due} tone="pink" /></div></section></div>
  </>
}

function ProductView({ kpis, timeseries }: { kpis: SuperAdminKpis; timeseries: SuperAdminTimeseriesPoint[] }) {
  const values: Array<[string, number | null | undefined, MetricFormat?]> = [
    ['Briefs générés', kpis.product.briefs], ['Questions Ask Tohu', kpis.product.ask_questions],
    ['Fiches Personne', kpis.product.contacts], ['Fiches Compte', kpis.product.companies],
    ['Signaux générés', kpis.product.signals], ['Recommandations', kpis.product.recommendations],
    ['Connecteurs actifs', kpis.product.connected_connectors], ['Tokens IA · 30 j', kpis.product.ai_tokens_30d],
    ['Adoption Home', kpis.product.home_adoption_rate, 'percent'],
  ]
  return <>
    <div className="sa-view-heading"><div><p>Adoption</p><h1>Usage produit</h1><span>Ce que les utilisateurs font réellement</span></div></div>
    <LineChart data={timeseries} title="Consommation IA" subtitle="Nombre d’appels IA quotidiens sur 30 jours" series={[{ key: 'ai_calls', label: 'Appels IA', color: '#9b7cf4' }]} />
    <div className="sa-metric-wall">{values.map(([label, value, format]) => <MetricCard key={label} label={label} value={value} format={format} />)}</div>
  </>
}

function OperationsView({ kpis, timeseries }: { kpis: SuperAdminKpis; timeseries: SuperAdminTimeseriesPoint[] }) {
  const values: Array<[string, number | null | undefined, MetricFormat?]> = [
    ['Jobs · 24 h', kpis.operations.sync_jobs_24h], ['Jobs réussis', kpis.operations.sync_succeeded_24h],
    ['Jobs échoués', kpis.operations.sync_failed_24h], ['Taux de réussite', kpis.operations.sync_success_rate_24h, 'percent'],
    ['Connecteurs en erreur', kpis.operations.connector_errors], ['Durée moyenne', kpis.operations.average_sync_seconds, 'duration'],
    ['Quotas dépassés', kpis.operations.quota_overruns_30d],
  ]
  return <>
    <div className="sa-view-heading"><div><p>Fiabilité</p><h1>Opérations</h1><span>Synchronisations et santé technique</span></div></div>
    <LineChart data={timeseries} title="Santé des synchronisations" subtitle="Jobs réussis et échoués par jour" series={[{ key: 'sync_succeeded', label: 'Réussis', color: '#58d6a5' }, { key: 'sync_failed', label: 'Échoués', color: '#f27891' }]} />
    <div className="sa-metric-wall">{values.map(([label, value, format]) => <MetricCard key={label} label={label} value={value} format={format} tone={label.includes('échoué') || label.includes('erreur') ? 'pink' : 'violet'} />)}</div>
  </>
}

export default function SuperAdminPage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [kpis, setKpis] = useState<SuperAdminKpis | null>(null)
  const [consoleData, setConsoleData] = useState<SuperAdminConsole | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      const allowed = await verifySuperAdmin()
      setAuthorized(allowed)
      if (allowed) {
        const data = await getSuperAdminData()
        setKpis(data.kpis)
        setConsoleData(data.console)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Impossible de charger le pilotage.')
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    document.body.classList.add('super-admin-page')
    return () => document.body.classList.remove('super-admin-page')
  }, [])

  if (authorized === false) return <Navigate to="/app/account" replace />
  if (authorized === null || !kpis || !consoleData) return <div className="super-admin-loading"><span className="spinner" /><span>{error ?? 'Chargement de la console Super Admin…'}</span></div>

  return <div className="sa-shell">
    <aside className={`sa-sidebar ${mobileNav ? 'open' : ''}`}>
      <div className="sa-brand"><span dangerouslySetInnerHTML={{ __html: tohuLogo() }} /><div><strong>TOHU</strong><small>Console interne</small></div><button type="button" onClick={() => setMobileNav(false)}>×</button></div>
      <nav>{NAVIGATION.map((item) => <button type="button" key={item.id} className={activeTab === item.id ? 'active' : ''} onClick={() => { setActiveTab(item.id); setMobileNav(false) }}><i>{item.icon}</i><span><strong>{item.label}</strong><small>{item.copy}</small></span>{item.id === 'users' && <b>{consoleData.users.length}</b>}</button>)}</nav>
      <div className="sa-sidebar-foot"><span>MODE</span><strong>Super Admin</strong><small>Données globales de production</small><Link to="/app/account">← Retour à mon compte</Link></div>
    </aside>
    <div className="sa-main">
      <header className="sa-topbar"><button className="sa-mobile-menu" type="button" onClick={() => setMobileNav(true)}>☰</button><div><span className="sa-live-dot" />Production live</div><div><span>Actualisé {dateTimeFormatter.format(new Date(consoleData.generated_at))}</span><button type="button" onClick={() => void load()} disabled={refreshing}>{refreshing ? 'Actualisation…' : '↻ Actualiser'}</button></div></header>
      {error && <div className="sa-global-error">{error}</div>}
      <main className="sa-content">
        {activeTab === 'overview' && <Overview kpis={kpis} consoleData={consoleData} />}
        {activeTab === 'users' && <UsersView consoleData={consoleData} refresh={load} />}
        {activeTab === 'subscriptions' && <SubscriptionView kpis={kpis} users={consoleData.users} />}
        {activeTab === 'product' && <ProductView kpis={kpis} timeseries={consoleData.timeseries} />}
        {activeTab === 'operations' && <OperationsView kpis={kpis} timeseries={consoleData.timeseries} />}
      </main>
    </div>
  </div>
}
