import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { tohuLogo } from '../components/logo'
import { initials } from '../lib/auth'
import {
  deleteSuperAdminUser, getAiUsage, getEmailDispatchRules, getSuperAdminData, setEmailDispatchRule, setSuperAdminRole, setUserAccess, triggerManualEnrichment, updateAccountDeletionRequest, verifySuperAdmin,
  type AccountDeletionRequestAdmin, type AiUsageStats, type EmailDispatchRule, type EmailDispatchScope, type EmailDispatchType, type SuperAdminConsole, type SuperAdminKpis, type SuperAdminTimeseriesPoint, type SuperAdminUser,
} from './service'

type Tab = 'overview' | 'users' | 'subscriptions' | 'product' | 'operations' | 'deletions' | 'emails' | 'ai'

const EMAIL_TYPES: Array<{ id: EmailDispatchType; label: string; desc: string }> = [
  { id: 'digest', label: 'Digest hebdo', desc: 'Lundi 8 h' },
  { id: 'antiseche', label: 'Antisèche', desc: 'À chaque réunion (T−24 h)' },
  { id: 'alerte', label: 'Alerte', desc: 'Signaux forts · max 3/sem' },
  { id: 'nurturing', label: 'Nurturing', desc: 'J+0/3/7/14/21' },
]

function SaSwitch({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
    style={{ width: 42, height: 24, borderRadius: 999, border: 'none', cursor: disabled ? 'wait' : 'pointer', padding: 3, background: on ? 'linear-gradient(135deg,#6E50C8,#E14FA0)' : '#4a4363', transition: 'background .2s', opacity: disabled ? 0.6 : 1 }}>
    <span style={{ display: 'block', width: 18, height: 18, borderRadius: '50%', background: '#fff', transform: on ? 'translateX(18px)' : 'translateX(0)', transition: 'transform .2s' }} />
  </button>
}

function EmailRuleGrid({ scope, refs, rules, onToggle, saving }: {
  scope: EmailDispatchScope
  refs: Array<{ ref: string; label: string }>
  rules: EmailDispatchRule[]
  onToggle: (scope: EmailDispatchScope, ref: string, type: EmailDispatchType, enabled: boolean) => void
  saving: string | null
}) {
  const enabledFor = (ref: string, type: EmailDispatchType) => {
    const rule = rules.find((r) => r.scope === scope && r.scope_ref === ref && r.email_type === type)
    return rule ? rule.enabled : true // défaut = autorisé
  }
  return <div className="sa-email-grid">
    <div className="sa-email-grid-head"><span /> {EMAIL_TYPES.map((t) => <span key={t.id}><strong>{t.label}</strong><small>{t.desc}</small></span>)}</div>
    {refs.map((r) => <div className="sa-email-grid-row" key={r.ref || 'all'}>
      <span className="sa-email-grid-label">{r.label}</span>
      {EMAIL_TYPES.map((t) => <span key={t.id}><SaSwitch on={enabledFor(r.ref, t.id)} disabled={saving === `${scope}:${r.ref}:${t.id}`} onChange={(v) => onToggle(scope, r.ref, t.id, v)} /></span>)}
    </div>)}
  </div>
}

function NotificationsView() {
  const [rules, setRules] = useState<EmailDispatchRule[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const load = useCallback(async () => { try { setRules(await getEmailDispatchRules()) } catch (e) { setError(e instanceof Error ? e.message : 'Chargement impossible') } }, [])
  useEffect(() => { void load() }, [load])

  const toggle = async (scope: EmailDispatchScope, ref: string, type: EmailDispatchType, enabled: boolean) => {
    setSaving(`${scope}:${ref}:${type}`)
    setError(null)
    try { await setEmailDispatchRule(scope, ref, type, enabled); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Enregistrement impossible') }
    finally { setSaving(null) }
  }

  return <>
    <div className="sa-view-heading"><div><p>Diffusion des e-mails</p><h1>E-mails</h1><span>Activer / couper chaque type d’e-mail — globalement ou par type de compte</span></div></div>
    {error && <div className="sa-global-error">{error}</div>}
    <section className="sa-email-block">
      <header><h2>Tous les utilisateurs</h2><p>Interrupteur maître par type d’e-mail. « Off » coupe l’envoi pour tout le monde (sauf règle plus fine).</p></header>
      <EmailRuleGrid scope="global" refs={[{ ref: '', label: 'Tous' }]} rules={rules} onToggle={toggle} saving={saving} />
    </section>
    <section className="sa-email-block">
      <header><h2>Par type de compte</h2><p>Prioritaire sur le réglage global. Utile pour n’activer que sur les comptes payants, par exemple.</p></header>
      <EmailRuleGrid scope="account_type" refs={[{ ref: 'free', label: 'Gratuit' }, { ref: 'paid', label: 'Payant' }, { ref: 'test', label: 'Test' }]} rules={rules} onToggle={toggle} saving={saving} />
    </section>
    <p className="sa-email-note">Résolution : réglage <strong>par utilisateur</strong> (fiche utilisateur) &gt; <strong>type de compte</strong> &gt; <strong>global</strong> &gt; défaut activé. L’utilisateur garde toujours son propre désabonnement.</p>
  </>
}

function EmailUserRules({ userId }: { userId: string }) {
  const [rules, setRules] = useState<EmailDispatchRule[]>([])
  const [saving, setSaving] = useState<string | null>(null)
  const load = useCallback(async () => { try { setRules(await getEmailDispatchRules()) } catch { /* silencieux */ } }, [])
  useEffect(() => { void load() }, [load, userId])
  const enabledFor = (type: EmailDispatchType) => { const r = rules.find((x) => x.scope === 'user' && x.scope_ref === userId && x.email_type === type); return r ? r.enabled : true }
  const toggle = async (type: EmailDispatchType, enabled: boolean) => { setSaving(type); try { await setEmailDispatchRule('user', userId, type, enabled); await load() } finally { setSaving(null) } }
  return <section className="sa-platform-editor">
    <div><h3>E-mails de cet utilisateur</h3><p>Réglage individuel, prioritaire sur le type de compte et le global.</p></div>
    <div className="sa-email-user-toggles">{EMAIL_TYPES.map((t) => <label key={t.id}><span>{t.label}</span><SaSwitch on={enabledFor(t.id)} disabled={saving === t.id} onChange={(v) => toggle(t.id, v)} /></label>)}</div>
  </section>
}
type MetricFormat = 'number' | 'percent' | 'currency' | 'duration'

const NAVIGATION: Array<{ id: Tab; label: string; copy: string; icon: string }> = [
  { id: 'overview', label: 'Vue d’ensemble', copy: 'Santé globale', icon: '⌁' },
  { id: 'users', label: 'Utilisateurs', copy: 'Accès & activité', icon: '◎' },
  { id: 'subscriptions', label: 'Abonnements', copy: 'Plans & revenus', icon: '◇' },
  { id: 'product', label: 'Usage produit', copy: 'Adoption & valeur', icon: '↗' },
  { id: 'operations', label: 'Opérations', copy: 'Sync & fiabilité', icon: '⎔' },
  { id: 'ai', label: 'Suivi IA & coûts', copy: 'Usage OpenRouter & dépenses', icon: '🧠' },
  { id: 'emails', label: 'E-mails', copy: 'Digests, alertes & diffusion', icon: '✉' },
  { id: 'deletions', label: 'Suppressions', copy: 'Demandes utilisateurs', icon: '⌫' },
]

const ACCOUNT_LABELS: Record<SuperAdminUser['account_type'], string> = {
  free: 'Gratuit',
  paid: 'Payant',
  test: 'Test',
}

const integerFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })
const compactFormatter = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 })
const currencyFormatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
const dateFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' })
const dateTimeFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })

const DELETION_STATUS: Record<AccountDeletionRequestAdmin['status'], string> = {
  pending: 'À traiter',
  reviewing: 'En cours',
  confirmed: 'Confirmée',
  completed: 'Traitée',
  rejected: 'Clôturée',
  cancelled: 'Annulée',
}

const DELETION_ANSWERS: Record<string, string> = {
  not_useful: 'Tohu ne répond pas au besoin',
  too_expensive: 'Tarif non adapté',
  missing_features: 'Fonctionnalités manquantes',
  technical_issues: 'Problèmes techniques',
  privacy: 'Conservation des données',
  better_price: 'Un tarif différent',
  better_reliability: 'Une meilleure fiabilité',
  more_features: 'Davantage de fonctionnalités',
  more_support: 'Plus d’accompagnement',
  temporary_pause: 'Mise en pause du compte',
  nothing: 'Rien en particulier',
  account_and_data: 'Compte et toutes les données',
  workspace_and_data: 'Workspace et ses données',
  product_data_only: 'Données produit uniquement',
  not_sure: 'Conseil de l’équipe demandé',
  other: 'Autre',
}

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

function tenure(value: string | null): string {
  if (!value) return '—'
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000))
  if (days < 1) return 'Depuis aujourd’hui'
  if (days < 30) return `Depuis ${days} jour${days > 1 ? 's' : ''}`
  const months = Math.floor(days / 30.4375)
  if (months < 12) return `Depuis ${months} mois`
  const years = Math.floor(months / 12)
  const remainingMonths = months % 12
  return `Depuis ${years} an${years > 1 ? 's' : ''}${remainingMonths ? ` et ${remainingMonths} mois` : ''}`
}

function historySource(value: string): string {
  const labels: Record<string, string> = {
    super_admin: 'Console Super Admin',
    stripe: 'Stripe',
    system: 'Système',
    migration_snapshot: 'État initial',
    migration_cleanup: 'Mise en conformité',
  }
  return labels[value] ?? value
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

function UserDetail({ user, plans, saving, onSaveCommercial, onSaveRole, onClose, onDeleted }: {
  user: SuperAdminUser
  plans: SuperAdminConsole['plans']
  saving: boolean
  onSaveCommercial: (access: SuperAdminUser['account_type'], plan?: string) => Promise<void>
  onSaveRole: (makeAdmin: boolean) => Promise<void>
  onClose: () => void
  onDeleted: (organizationsDeleted: number) => Promise<void>
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmEmail, setConfirmEmail] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const emailMatch = confirmEmail.trim().toLowerCase() === (user.email ?? '').trim().toLowerCase() && !!user.email
  const runDelete = async () => {
    if (!emailMatch) return
    setDeleting(true); setDeleteError(null)
    try {
      const result = await deleteSuperAdminUser(user.user_id)
      setConfirmDelete(false)
      await onDeleted(result.organizations_deleted)
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : 'Suppression impossible.')
    } finally { setDeleting(false) }
  }
  const [access, setAccess] = useState(user.account_type)
  const paidPlans = plans.filter((plan) => ['solo', 'pro', 'business'].includes(plan.id) && plan.is_active)
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
      <div><div className="sa-user-badges"><span className={`sa-type type-${user.account_type}`}>{ACCOUNT_LABELS[user.account_type]} · {user.plan_name}</span>{user.is_super_admin && <span className="sa-platform-badge">Super Admin</span>}</div><h2>{user.full_name}</h2><p>{user.email ?? 'Email indisponible'}</p></div>
      <button type="button" onClick={onClose} aria-label="Fermer">×</button>
    </div>
    <div className="sa-detail-meta">
      <div><span>Workspace</span><strong>{user.organization_name ?? 'Sans workspace'}</strong></div>
      <div><span>Compte créé le</span><strong>{when(user.created_at)}</strong></div>
      <div><span>Client Tohu</span><strong>{tenure(user.customer_since)}</strong></div>
      <div><span>Plan actuel depuis</span><strong>{tenure(user.plan_changed_at ?? user.subscription_started_at)}</strong></div>
      <div><span>Dernière activité</span><strong>{when(user.last_activity_at)}</strong></div>
      <div><span>Onboarding</span><strong>{user.onboarding_completed ? 'Terminé' : 'À terminer'}</strong></div>
    </div>
    <div className="sa-detail-stats">{stats.map(([label, value]) => <div key={label}><span>{label}</span><strong>{compactFormatter.format(value)}</strong></div>)}</div>
    <section className="sa-access-editor">
      <div><h3>Abonnement commercial</h3><p>Gratuit, compte Test ou offre payante précise. Ce réglage est indépendant du rôle Super Admin.</p></div>
      <div className="sa-access-options">{(Object.keys(ACCOUNT_LABELS) as SuperAdminUser['account_type'][]).map((type) => <button key={type} type="button" className={access === type ? 'active' : ''} onClick={() => setAccess(type)}><i className={`type-${type}`} />{ACCOUNT_LABELS[type]}</button>)}</div>
      {access === 'paid' && <label>Offre payante<select value={paidPlan} onChange={(event) => setPaidPlan(event.target.value)}>{paidPlans.map((plan) => <option value={plan.id} key={plan.id}>{plan.name} · {currencyFormatter.format(plan.price_monthly / 100)}/mois</option>)}</select></label>}
      {user.stripe_managed && <p className="sa-stripe-note">Ce workspace possède un abonnement Stripe. Cette action programme l’accès produit ; la facturation Stripe reste gérée séparément.</p>}
      <button className="sa-primary-action" type="button" disabled={saving || (access === user.account_type && (access !== 'paid' || paidPlan === user.plan_id))} onClick={() => void onSaveCommercial(access, access === 'paid' ? paidPlan : undefined)}>{saving ? 'Application…' : `Enregistrer ${access === 'paid' ? paidPlans.find((plan) => plan.id === paidPlan)?.name ?? 'le plan' : ACCOUNT_LABELS[access]}`}</button>
    </section>
    <section className="sa-platform-editor">
      <div><h3>Rôle plateforme</h3><p>Donne accès à la console et aux KPI. Cela ne change jamais l’abonnement du client.</p></div>
      <div className="sa-platform-state"><span className={user.is_super_admin ? 'active' : ''}>{user.is_super_admin ? 'Super Admin actif' : 'Utilisateur standard'}</span><button type="button" disabled={saving} className={user.is_super_admin ? 'danger' : ''} onClick={() => void onSaveRole(!user.is_super_admin)}>{user.is_super_admin ? 'Retirer le rôle' : 'Activer Super Admin'}</button></div>
    </section>
    <EmailUserRules userId={user.user_id} />
    <section className="sa-history-block">
      <div><h3>Évolution de l’abonnement</h3><p>{user.plan_history.length} événement{user.plan_history.length > 1 ? 's' : ''} enregistré{user.plan_history.length > 1 ? 's' : ''}</p></div>
      <div className="sa-history-list">
        {user.plan_history.map((change) => <article key={change.id}>
          <i />
          <div>
            <strong>{change.previous_plan_name ? `${change.previous_plan_name} → ` : ''}{change.new_plan_name}</strong>
            <span>{historySource(change.change_source)}{change.changed_by_name ? ` · par ${change.changed_by_name}` : ''}</span>
            {change.reason && <small>{change.reason}</small>}
          </div>
          <time dateTime={change.changed_at}>{dateTimeFormatter.format(new Date(change.changed_at))}</time>
        </article>)}
        {!user.plan_history.length && <p className="sa-empty-history">Aucun changement enregistré pour le moment.</p>}
      </div>
    </section>
    <section className="sa-health-block">
      <h3>Fiabilité de la synchronisation</h3>
      <div><span>Jobs lancés</span><strong>{user.sync_jobs_count}</strong></div>
      <div><span>Échecs</span><strong className={user.sync_failures_count ? 'danger' : ''}>{user.sync_failures_count}</strong></div>
      <div><span>Taux de réussite</span><strong>{user.sync_jobs_count ? `${integerFormatter.format((user.sync_jobs_count - user.sync_failures_count) / user.sync_jobs_count * 100)} %` : '—'}</strong></div>
    </section>
    <section className="sa-danger-block">
      <div><h3>Zone dangereuse</h3><p>Supprime définitivement cet utilisateur et <b>toutes ses données en cascade</b> (workspace, comptes, personnes, messages, signaux, profils…). <b>Irréversible.</b></p></div>
      <button type="button" className="sa-danger-btn" disabled={user.is_super_admin} title={user.is_super_admin ? 'Retire d’abord le rôle Super Admin' : undefined} onClick={() => { setConfirmDelete(true); setConfirmEmail(''); setDeleteError(null) }}>Supprimer l’utilisateur</button>
    </section>
    {confirmDelete && <div className="sa-modal-mask" onClick={() => !deleting && setConfirmDelete(false)}>
      <div className="sa-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <h3>Supprimer définitivement&nbsp;?</h3>
        <p>Cette action supprime <b>{user.full_name}</b> et <b>toutes ses données en cascade</b> (workspace, comptes, personnes, messages, profils cognitifs…). C’est <b>irréversible</b>.</p>
        <p className="sa-modal-confirm-hint">Pour confirmer, tape l’email exact : <code>{user.email ?? '—'}</code></p>
        <input className="sa-modal-input" value={confirmEmail} onChange={(event) => setConfirmEmail(event.target.value)} placeholder={user.email ?? ''} autoFocus />
        {deleteError && <p className="sa-modal-error">{deleteError}</p>}
        <div className="sa-modal-actions">
          <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting}>Annuler</button>
          <button type="button" className="sa-danger-btn" disabled={!emailMatch || deleting} onClick={() => void runDelete()}>{deleting ? 'Suppression…' : 'Supprimer définitivement'}</button>
        </div>
      </div>
    </div>}
  </aside>
}

function UsersView({ consoleData, refresh }: { consoleData: SuperAdminConsole; refresh: () => Promise<void> }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | SuperAdminUser['account_type']>('all')
  const [planFilter, setPlanFilter] = useState<'all' | 'free' | 'tester' | 'solo' | 'pro' | 'business'>('all')
  const [sort, setSort] = useState<'recent' | 'name' | 'activity' | 'type'>('recent')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const users = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = consoleData.users.filter((user) =>
      (filter === 'all' || user.account_type === filter)
      && (planFilter === 'all' || user.plan_id === planFilter)
      && (!needle || `${user.full_name} ${user.email ?? ''} ${user.organization_name ?? ''}`.toLowerCase().includes(needle)))
    return [...rows].sort((a, b) => {
      if (sort === 'name') return a.full_name.localeCompare(b.full_name)
      if (sort === 'activity') return (b.last_activity_at ?? '').localeCompare(a.last_activity_at ?? '')
      if (sort === 'type') return a.plan_id.localeCompare(b.plan_id) || a.full_name.localeCompare(b.full_name)
      return b.created_at.localeCompare(a.created_at)
    })
  }, [consoleData.users, filter, planFilter, query, sort])
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

  const saveRole = async (makeAdmin: boolean) => {
    if (!selected) return
    setSaving(true)
    setFeedback(null)
    try {
      await setSuperAdminRole(selected.user_id, makeAdmin)
      await refresh()
      setFeedback(`${selected.full_name} est maintenant ${makeAdmin ? 'Super Admin' : 'utilisateur standard'}. Son abonnement n’a pas été modifié.`)
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'Modification du rôle impossible.')
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
        <label className="sa-sort">Plan précis<select value={planFilter} onChange={(event) => setPlanFilter(event.target.value as typeof planFilter)}><option value="all">Tous les plans</option><option value="free">Free</option><option value="tester">Test</option><option value="solo">Solo</option><option value="pro">Pro</option><option value="business">Business</option></select></label>
        <label className="sa-sort">Trier par<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="recent">Inscription récente</option><option value="activity">Dernière activité</option><option value="name">Nom</option><option value="type">Type de compte</option></select></label>
      </div>
      <div className="sa-users-table">
        <div className="sa-users-row head"><span>Utilisateur</span><span>Type</span><span>Workspace</span><span>Activité</span><span>Usage</span><span /></div>
        {users.map((user) => <button type="button" className={`sa-users-row ${selectedId === user.user_id ? 'active' : ''}`} key={user.user_id} onClick={() => setSelectedId(user.user_id)}>
          <span className="sa-user-identity"><i className="sa-user-avatar">{user.avatar_url ? <img src={user.avatar_url} alt="" /> : initials(user.full_name)}</i><span><strong>{user.full_name}</strong><small>{user.email ?? 'Sans email'}{user.is_super_admin ? ' · Super Admin' : ''}</small></span></span>
          <span><i className={`sa-type type-${user.account_type}`}>{user.plan_name}</i><small>{ACCOUNT_LABELS[user.account_type]}</small></span>
          <span><strong>{user.organization_name ?? '—'}</strong><small>{user.membership_role ?? 'Sans rôle'}</small></span>
          <span><strong>{when(user.last_activity_at)}</strong><small>{user.onboarding_completed ? 'Onboarding terminé' : 'Onboarding incomplet'}</small></span>
          <span><strong>{compactFormatter.format(user.ai_calls_count)} appels IA</strong><small>{user.contacts_count} personnes · {user.meetings_count} réunions</small></span>
          <span className="sa-row-arrow">→</span>
        </button>)}
        {!users.length && <div className="sa-empty">Aucun utilisateur ne correspond à ces filtres.</div>}
      </div>
    </section>
    {selected && <UserDetail user={selected} plans={consoleData.plans} saving={saving} onSaveCommercial={save} onSaveRole={saveRole} onClose={() => setSelectedId(null)} onDeleted={async () => { setSelectedId(null); await refresh() }} />}
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

function ManualEnrichmentTrigger() {
  const [running, setRunning] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const run = async () => {
    setRunning(true)
    setFeedback(null)
    try {
      const result = await triggerManualEnrichment()
      setFeedback({
        tone: 'success',
        text: `${result.scanned} contact${result.scanned > 1 ? 's' : ''} analysé${result.scanned > 1 ? 's' : ''} · ${result.enriched} enrichi${result.enriched > 1 ? 's' : ''} · ${result.failed} échec${result.failed > 1 ? 's' : ''}.`,
      })
    } catch (reason) {
      setFeedback({ tone: 'error', text: reason instanceof Error ? reason.message : 'Déclenchement impossible.' })
    } finally {
      setRunning(false)
    }
  }

  return <article className="sa-manual-trigger">
    <div>
      <h3>Enrichissement manuel</h3>
      <p>Force un passage immédiat de la veille IA (parcours, poste, actualité) sur les contacts trackés les plus anciens, tous workspaces confondus, sans attendre le prochain cycle planifié. Réservé aux Super Admin.</p>
      {feedback && <p className={feedback.tone === 'error' ? 'sa-trigger-error' : 'sa-trigger-success'}>{feedback.text}</p>}
    </div>
    <button type="button" className="sa-primary-action" onClick={() => void run()} disabled={running}>{running ? 'Enrichissement en cours…' : 'Déclencher maintenant'}</button>
  </article>
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
    <ManualEnrichmentTrigger />
  </>
}

function DeletionRequestsView({ requests, refresh }: {
  requests: AccountDeletionRequestAdmin[]
  refresh: () => Promise<void>
}) {
  const [filter, setFilter] = useState<'all' | AccountDeletionRequestAdmin['status']>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const selected = requests.find((request) => request.id === selectedId) ?? null
  const visible = requests.filter((request) => filter === 'all' || request.status === filter)

  useEffect(() => { setNote(selected?.admin_note ?? '') }, [selected?.id, selected?.admin_note])

  const update = async (status: AccountDeletionRequestAdmin['status']) => {
    if (!selected) return
    setSaving(true)
    setFeedback(null)
    try {
      await updateAccountDeletionRequest(selected.id, status, note)
      await refresh()
      setFeedback('La demande a été mise à jour et l’action a été journalisée.')
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'Mise à jour impossible.')
    } finally {
      setSaving(false)
    }
  }

  const activeCount = requests.filter((request) => ['pending', 'reviewing', 'confirmed'].includes(request.status)).length

  return <div className={`sa-deletions-layout ${selected ? 'has-detail' : ''}`}>
    <section className="sa-deletions-main">
      <div className="sa-view-heading"><div><p>Protection des données</p><h1>Demandes de suppression</h1><span>{activeCount} demande{activeCount > 1 ? 's' : ''} active{activeCount > 1 ? 's' : ''}</span></div></div>
      {feedback ? <div className="sa-feedback">{feedback}</div> : null}
      <div className="sa-deletion-filters">
        {(['all', 'pending', 'reviewing', 'confirmed', 'completed', 'rejected'] as const).map((status) => <button type="button" key={status} className={filter === status ? 'active' : ''} onClick={() => setFilter(status)}>
          {status === 'all' ? 'Toutes' : DELETION_STATUS[status]} <b>{status === 'all' ? requests.length : requests.filter((request) => request.status === status).length}</b>
        </button>)}
      </div>
      <div className="sa-deletion-table">
        <div className="sa-deletion-row head"><span>Utilisateur</span><span>Motif</span><span>Demandé le</span><span>État</span><span /></div>
        {visible.map((request) => <button type="button" key={request.id} className={`sa-deletion-row ${selectedId === request.id ? 'active' : ''}`} onClick={() => setSelectedId(request.id)}>
          <span><strong>{request.full_name}</strong><small>{request.email}</small></span>
          <span><strong>{DELETION_ANSWERS[request.primary_reason] ?? request.primary_reason}</strong><small>{request.organization_name ?? 'Sans workspace'}</small></span>
          <span><strong>{dateFormatter.format(new Date(request.requested_at))}</strong><small>{when(request.requested_at)}</small></span>
          <span><i className={`sa-deletion-status status-${request.status}`}>{DELETION_STATUS[request.status]}</i></span>
          <span className="sa-row-arrow">→</span>
        </button>)}
        {!visible.length ? <div className="sa-empty">Aucune demande dans cette catégorie.</div> : null}
      </div>
    </section>
    {selected ? <aside className="sa-deletion-detail">
      <header><div><span className={`sa-deletion-status status-${selected.status}`}>{DELETION_STATUS[selected.status]}</span><h2>{selected.full_name}</h2><p>{selected.email}</p></div><button type="button" onClick={() => setSelectedId(null)} aria-label="Fermer">×</button></header>
      <div className="sa-deletion-meta"><div><span>Workspace</span><strong>{selected.organization_name ?? '—'}</strong></div><div><span>Demande</span><strong>{when(selected.requested_at)}</strong></div></div>
      <section className="sa-deletion-answers">
        <div><span>1 · Motif principal</span><strong>{DELETION_ANSWERS[selected.primary_reason] ?? selected.primary_reason}</strong></div>
        <div><span>2 · Ce qui aurait pu le retenir</span><strong>{DELETION_ANSWERS[selected.retention_factor] ?? selected.retention_factor}</strong></div>
        <div><span>3 · Périmètre demandé</span><strong>{DELETION_ANSWERS[selected.deletion_scope] ?? selected.deletion_scope}</strong></div>
        <div className="full"><span>Explication de l’utilisateur</span><p>{selected.details}</p></div>
      </section>
      <label className="sa-admin-note">Note interne<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Suivi, vérifications effectuées, contact avec l’utilisateur…" /></label>
      <div className="sa-deletion-actions">
        {selected.status === 'pending' ? <button type="button" onClick={() => void update('reviewing')} disabled={saving}>Prendre en charge</button> : null}
        {['pending', 'reviewing'].includes(selected.status) ? <button type="button" onClick={() => void update('confirmed')} disabled={saving}>Confirmer avec l’utilisateur</button> : null}
        {['reviewing', 'confirmed'].includes(selected.status) ? <button type="button" className="success" onClick={() => void update('completed')} disabled={saving}>Marquer comme traitée</button> : null}
        {!['completed', 'rejected', 'cancelled'].includes(selected.status) ? <button type="button" className="muted" onClick={() => void update('rejected')} disabled={saving}>Clôturer sans suppression</button> : null}
      </div>
      <p className="sa-deletion-warning">Changer le statut ne supprime aucune donnée automatiquement. La suppression technique reste une opération séparée et contrôlée.</p>
    </aside> : null}
  </div>
}

const usdFormatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const usdPrecise = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 })
const AI_PERIODS: Array<{ key: 'day' | 'week' | 'month' | 'year' | 'all'; label: string }> = [
  { key: 'day', label: 'Aujourd’hui' },
  { key: 'week', label: '7 jours' },
  { key: 'month', label: '30 jours' },
  { key: 'year', label: '1 an' },
  { key: 'all', label: 'Total' },
]

function AiUsageView() {
  const [stats, setStats] = useState<AiUsageStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void getAiUsage().then(setStats).catch((reason) => setError(reason instanceof Error ? reason.message : 'Chargement impossible')) }, [])
  const maxDayCost = useMemo(() => Math.max(1e-9, ...(stats?.by_day ?? []).map((day) => day.cost)), [stats])
  if (error) return <div className="inline-error">{error}</div>
  if (!stats) return <div className="super-admin-loading"><span className="spinner" /></div>
  const empty = (stats.totals.all?.calls ?? 0) === 0
  return <section className="sa-ai">
    <div className="sa-view-heading"><div><p>OpenRouter · tokens réels, coût estimé</p><h1>Suivi IA &amp; coûts</h1><span>Actualisé {dateTimeFormatter.format(new Date(stats.generated_at))}</span></div></div>
    {empty && <div className="sa-ai-empty">Aucun appel IA journalisé pour l’instant. La collecte démarre <b>après le déploiement</b> des fonctions instrumentées (<code>sync-email-analysis</code>, <code>ingest-transcript</code>, <code>ask-tohu-proxy</code>). Les chiffres s’accumuleront ensuite ici automatiquement.</div>}
    <div className="sa-ai-cards">
      {AI_PERIODS.map(({ key, label }) => { const bucket = stats.totals[key] ?? { calls: 0, tokens: 0, cost: 0 }; return <article key={key} className="sa-ai-card">
        <span className="sa-ai-card-l">{label}</span>
        <strong className="sa-ai-card-v">{usdFormatter.format(bucket.cost)}</strong>
        <span className="sa-ai-card-s">{integerFormatter.format(bucket.calls)} appels · {compactFormatter.format(bucket.tokens)} tokens</span>
      </article> })}
    </div>
    <div className="sa-ai-cols">
      <div className="sa-ai-block"><h2>Par fonction <small>· 30 j</small></h2>
        <table className="sa-ai-table"><thead><tr><th>Fonction</th><th>Appels</th><th>Tokens</th><th>Coût est.</th></tr></thead>
          <tbody>{stats.by_function.map((row) => <tr key={row.fn}><td>{row.fn}</td><td>{integerFormatter.format(row.calls)}</td><td>{compactFormatter.format(row.tokens)}</td><td>{usdPrecise.format(row.cost)}</td></tr>)}{!stats.by_function.length && <tr><td colSpan={4} className="sa-ai-none">—</td></tr>}</tbody></table>
      </div>
      <div className="sa-ai-block"><h2>Par modèle <small>· 30 j</small></h2>
        <table className="sa-ai-table"><thead><tr><th>Modèle</th><th>Appels</th><th>Tokens</th><th>Coût est.</th></tr></thead>
          <tbody>{stats.by_model.map((row) => <tr key={row.model}><td>{row.model}</td><td>{integerFormatter.format(row.calls)}</td><td>{compactFormatter.format(row.tokens)}</td><td>{usdPrecise.format(row.cost)}</td></tr>)}{!stats.by_model.length && <tr><td colSpan={4} className="sa-ai-none">—</td></tr>}</tbody></table>
      </div>
    </div>
    <div className="sa-ai-block"><h2>Coût par jour <small>· 30 j</small></h2>
      <div className="sa-ai-bars">{stats.by_day.length ? stats.by_day.map((day) => <div key={day.day} className="sa-ai-bar" title={`${day.day} · ${usdPrecise.format(day.cost)} · ${day.calls} appels`}><i style={{ height: `${Math.max(3, (day.cost / maxDayCost) * 100)}%` }} /><span>{day.day.slice(8)}</span></div>) : <p className="sa-ai-none">Aucune donnée.</p>}</div>
    </div>
    <div className="sa-ai-block"><h2>Par utilisateur <small>· 30 j · top 20</small></h2>
      <table className="sa-ai-table"><thead><tr><th>Utilisateur</th><th>Appels</th><th>Tokens</th><th>Coût est.</th></tr></thead>
        <tbody>{stats.by_user.map((row) => <tr key={row.user_id ?? 'null'}><td>{row.full_name}</td><td>{integerFormatter.format(row.calls)}</td><td>{compactFormatter.format(row.tokens)}</td><td>{usdPrecise.format(row.cost)}</td></tr>)}{!stats.by_user.length && <tr><td colSpan={4} className="sa-ai-none">—</td></tr>}</tbody></table>
    </div>
    <p className="sa-ai-note"><b>Tokens</b> = valeurs réelles renvoyées par OpenRouter. <b>Coût</b> = estimation via une grille de prix approximative (source de vérité : ton tableau de bord OpenRouter). Suivi actif : analyses email/transcript (<code>gemini-3.1-flash-lite</code>), Ask Bohu (<code>gpt-4.1-mini</code>), veille contacts (<code>claude-haiku-4.5</code>). Non compté ici : la recherche web (Perplexity) de la veille société, facturée séparément.</p>
  </section>
}

export default function SuperAdminPage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [kpis, setKpis] = useState<SuperAdminKpis | null>(null)
  const [consoleData, setConsoleData] = useState<SuperAdminConsole | null>(null)
  const [deletionRequests, setDeletionRequests] = useState<AccountDeletionRequestAdmin[]>([])
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
        setDeletionRequests(data.deletionRequests)
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
      <div className="sa-brand"><span className="sa-brand-logo" dangerouslySetInnerHTML={{ __html: tohuLogo('Tohu Bohu') }} /><div><strong>TOHU BOHU</strong><small>Super Admin</small></div><button type="button" onClick={() => setMobileNav(false)}>×</button></div>
      <nav>{NAVIGATION.map((item) => <button type="button" key={item.id} className={activeTab === item.id ? 'active' : ''} onClick={() => { setActiveTab(item.id); setMobileNav(false) }}><i>{item.icon}</i><span><strong>{item.label}</strong><small>{item.copy}</small></span>{item.id === 'users' && <b>{consoleData.users.length}</b>}{item.id === 'deletions' && <b>{deletionRequests.filter((request) => ['pending', 'reviewing', 'confirmed'].includes(request.status)).length}</b>}</button>)}</nav>
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
        {activeTab === 'ai' && <AiUsageView />}
        {activeTab === 'emails' && <NotificationsView />}
        {activeTab === 'deletions' && <DeletionRequestsView requests={deletionRequests} refresh={load} />}
      </main>
    </div>
  </div>
}
