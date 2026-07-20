import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Link } from 'react-router-dom'
import {
  emptyBillingSummary,
  getAccountCenter,
  getBillingSummary,
  getMyAccountDeletionRequest,
  inviteTeamMember,
  openBillingPortal,
  startPlanChange,
  submitAccountDeletionRequest,
  type AccountCenter,
  type AccountDeletionRequest,
  type AccountPlan,
  type BillingSummary,
} from '../../account-center/service'
import { displayName, initials, signOut } from '../../lib/auth'
import { getSupabase } from '../../lib/supabase'
import { getProfile, type ProfileRow } from '../../services/data'
import { useToast } from '../../person-detail/ui'

type PageContext = { session: Session; workspaceId: string }
type Preferences = { email_enabled: boolean; push_enabled: boolean; daily_digest_enabled: boolean }

const PREFERENCE_ROWS: Array<{ key: keyof Preferences; title: string; copy: string }> = [
  { key: 'email_enabled', title: 'Notifications email', copy: 'Alertes importantes' },
  { key: 'push_enabled', title: 'Notifications push', copy: 'Nouveaux signaux importants' },
  { key: 'daily_digest_enabled', title: 'Digest quotidien', copy: 'Résumé de l’activité utile' },
]

const PROVIDER_NAMES: Record<string, string> = {
  google: 'Google Workspace',
  microsoft: 'Microsoft 365',
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
  pipedrive: 'Pipedrive',
  slack: 'Slack',
  zoom: 'Zoom',
  teams: 'Microsoft Teams',
  meet: 'Google Meet',
}
const STATUS_LABELS: Record<string, string> = {
  active: 'Actif',
  trialing: 'Période d’essai',
  past_due: 'Paiement requis',
  canceled: 'Résilié',
  paused: 'Suspendu',
}

const DELETION_STATUS_LABELS: Record<AccountDeletionRequest['status'], string> = {
  pending: 'Demande transmise',
  reviewing: 'En cours d’étude',
  confirmed: 'Suppression confirmée',
  completed: 'Demande traitée',
  rejected: 'Demande clôturée',
  cancelled: 'Demande annulée',
}

const DELETION_QUESTIONS = [
  {
    key: 'primaryReason',
    title: 'Pourquoi souhaites-tu supprimer ton compte ?',
    options: [
      ['not_useful', 'Tohu ne répond pas à mon besoin'],
      ['too_expensive', 'Le tarif ne me convient pas'],
      ['missing_features', 'Il manque des fonctionnalités'],
      ['technical_issues', 'J’ai rencontré des problèmes techniques'],
      ['privacy', 'Je préfère ne plus conserver mes données'],
      ['other', 'Autre'],
    ],
  },
  {
    key: 'retentionFactor',
    title: 'Qu’est-ce qui aurait pu te faire rester ?',
    options: [
      ['better_price', 'Un tarif différent'],
      ['better_reliability', 'Une meilleure fiabilité'],
      ['more_features', 'Davantage de fonctionnalités'],
      ['more_support', 'Plus d’accompagnement'],
      ['temporary_pause', 'Pouvoir mettre le compte en pause'],
      ['nothing', 'Rien en particulier'],
      ['other', 'Autre'],
    ],
  },
  {
    key: 'deletionScope',
    title: 'Que souhaites-tu voir supprimé ?',
    options: [
      ['account_and_data', 'Mon compte et toutes mes données'],
      ['workspace_and_data', 'Mon workspace et ses données'],
      ['product_data_only', 'Uniquement mes données produit'],
      ['not_sure', 'Je souhaite être conseillé par l’équipe'],
      ['other', 'Autre'],
    ],
  },
] as const

function money(cents: number, currency = 'eur'): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}

function date(value: string | number | null | undefined): string {
  if (!value) return '—'
  const parsed = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(parsed)
}

function currentDisplayPlan(data: AccountCenter): AccountPlan | undefined {
  const planId = ['tester', 'super_admin', 'enterprise'].includes(data.subscription.plan_id)
    ? 'business'
    : data.subscription.plan_id
  return data.plans.find((plan) => plan.id === planId)
}

function PlanCard({
  plan,
  current,
  busy,
  canManage,
  onChoose,
}: {
  plan: AccountPlan
  current: boolean
  busy: boolean
  canManage: boolean
  onChoose: () => void
}) {
  return <article className={`account-plan${current ? ' is-current' : ''}${plan.id === 'pro' ? ' is-featured' : ''}`}>
    <div className="account-plan__head">
      <span className="account-plan__name">{plan.name}</span>
      {current ? <span className="account-pill success">Plan actuel</span> : null}
      {!current && plan.id === 'pro' ? <span className="account-pill violet">Populaire</span> : null}
    </div>
    <p>{plan.description}</p>
    <div className="account-plan__price"><strong>{money(plan.price_monthly)}</strong><span>/ siège / mois</span></div>
    {plan.price_yearly > 0 ? <small className="account-plan__yearly">ou {money(plan.price_yearly)} par an</small> : <small className="account-plan__yearly">Sans carte bancaire</small>}
    <ul>{plan.features.slice(0, 5).map((feature) => <li key={feature}>{feature}</li>)}</ul>
    <button
      type="button"
      className={current ? 'btn-secondary' : 'btn-view'}
      disabled={current || !canManage || busy}
      onClick={onChoose}
    >
      {current ? 'Abonnement actif' : plan.id === 'free' ? 'Passer au Free' : `Choisir ${plan.name}`}
    </button>
  </article>
}

function DeletionRequestModal({ submitting, onClose, onSubmit }: {
  submitting: boolean
  onClose: () => void
  onSubmit: (values: { primaryReason: string; retentionFactor: string; deletionScope: string; details: string }) => Promise<void>
}) {
  const [answers, setAnswers] = useState({ primaryReason: '', retentionFactor: '', deletionScope: '', details: '' })
  const detailsLength = answers.details.trim().length
  const complete = Boolean(answers.primaryReason && answers.retentionFactor && answers.deletionScope && detailsLength >= 20)

  return <div className="account-delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-request-title">
    <div className="account-delete-dialog">
      <header>
        <div><span className="account-kicker">Demande encadrée</span><h2 id="delete-request-title">Supprimer mon compte</h2><p>Aucune donnée ne sera supprimée automatiquement après l’envoi.</p></div>
        <button type="button" onClick={onClose} aria-label="Fermer">×</button>
      </header>
      <form onSubmit={(event) => { event.preventDefault(); if (complete) void onSubmit(answers) }}>
        {DELETION_QUESTIONS.map((question, index) => <fieldset key={question.key}>
          <legend><span>{index + 1}</span>{question.title}</legend>
          <div className="account-delete-options">{question.options.map(([value, label]) => <label key={value} className={answers[question.key] === value ? 'selected' : ''}>
            <input type="radio" name={question.key} value={value} checked={answers[question.key] === value} onChange={() => setAnswers((current) => ({ ...current, [question.key]: value }))} />
            <i />{label}
          </label>)}</div>
        </fieldset>)}
        <label className="account-delete-details" htmlFor="deletion-details">
          <span>Précise les raisons de ta demande</span>
          <textarea id="deletion-details" className="textarea" minLength={20} maxLength={1500} value={answers.details} onChange={(event) => setAnswers((current) => ({ ...current, details: event.target.value }))} placeholder="Explique-nous ta situation en quelques mots…" required />
          <small className={detailsLength >= 20 ? 'valid' : ''}>{detailsLength} / 20 caractères minimum</small>
        </label>
        <div className="account-delete-notice"><b>Et ensuite ?</b><span>La demande sera transmise à l’équipe technique. Elle reviendra vers toi pour confirmer précisément la suppression de ton compte et de tes données.</span></div>
        <div className="account-delete-actions"><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="submit" className="btn-danger" disabled={!complete || submitting}>{submitting ? 'Transmission…' : 'Transmettre ma demande'}</button></div>
      </form>
    </div>
  </div>
}

export default function AccountSettingsPage({ context }: { context: PageContext }) {
  const toast = useToast()
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [account, setAccount] = useState<AccountCenter | null>(null)
  const [billing, setBilling] = useState<BillingSummary>(emptyBillingSummary)
  const [deletionRequest, setDeletionRequest] = useState<AccountDeletionRequest | null>(null)
  const [deletionModal, setDeletionModal] = useState(false)
  const [preferences, setPreferences] = useState<Preferences>({ email_enabled: true, push_enabled: true, daily_digest_enabled: true })
  const [form, setForm] = useState({ full_name: '', avatar_url: '' })
  const [invite, setInvite] = useState({ email: '', role: 'member' as 'admin' | 'member' })
  const [seats, setSeats] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = async () => {
    const client = getSupabase()
    try {
      const [profileRow, preferencesResult, center, billingResult, deletionResult] = await Promise.all([
        getProfile(context.session.user.id),
        client.from('notification_preferences').select('*').eq('user_id', context.session.user.id).eq('organization_id', context.workspaceId).maybeSingle(),
        getAccountCenter(context.workspaceId),
        getBillingSummary(context.workspaceId).catch(() => emptyBillingSummary),
        getMyAccountDeletionRequest(),
      ])
      if (preferencesResult.error) throw preferencesResult.error
      setProfile(profileRow)
      setForm({ full_name: profileRow.full_name, avatar_url: profileRow.avatar_url ?? '' })
      if (preferencesResult.data) setPreferences(preferencesResult.data as Preferences)
      setAccount(center)
      setSeats(Math.max(1, center.subscription.seat_quantity ?? 1))
      setBilling(billingResult)
      setDeletionRequest(deletionResult)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Impossible de charger le compte.')
    }
  }

  useEffect(() => { void load() }, [context.session.user.id, context.workspaceId])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('billing') === 'success' || params.get('billing') === 'updated') {
      toast('Paiement confirmé par Stripe. La mise à jour apparaîtra après validation du webhook.')
      window.history.replaceState(null, '', '/app/account')
    }
  }, [toast])

  const plan = account ? currentDisplayPlan(account) : undefined
  const isBeta = account?.subscription.plan_id === 'tester'
  const isInternal = account?.subscription.plan_id === 'super_admin'
  const isComped = isBeta || isInternal
  const displayPlanName = isBeta ? 'Business Beta' : isInternal ? 'Business Interne' : plan?.name
  const memberCount = account?.members.length ?? 0
  const seatLimit = plan?.max_licenses ?? 1
  const paidSeats = Math.max(1, account?.subscription.seat_quantity ?? 1)
  const availableSeats = Math.max(0, Math.min(seatLimit, paidSeats) - memberCount)
  const connected = useMemo(() => account?.connectors.filter((item) => item.status === 'connected') ?? [], [account])

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy('profile')
    try {
      const values = { full_name: form.full_name.trim(), avatar_url: form.avatar_url.trim() || null }
      const { error: updateError } = await getSupabase().from('profiles').update(values).eq('id', context.session.user.id)
      if (updateError) throw updateError
      setProfile((current) => current ? { ...current, ...values } : current)
      toast('Informations enregistrées.')
      window.dispatchEvent(new CustomEvent('tohu:profile-updated'))
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Impossible d’enregistrer.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const togglePreference = async (key: keyof Preferences) => {
    const enabled = !preferences[key]
    try {
      const { error: updateError } = await getSupabase().from('notification_preferences').update({ [key]: enabled }).eq('organization_id', context.workspaceId).eq('user_id', context.session.user.id)
      if (updateError) throw updateError
      setPreferences((current) => ({ ...current, [key]: enabled }))
      toast('Préférence enregistrée.')
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Préférence non enregistrée.', 'error')
    }
  }

  const redirectToPlan = async (selected: AccountPlan, selectedSeats = Math.max(1, paidSeats)) => {
    setBusy(`plan-${selected.id}`)
    try {
      const quantity = Math.min(selected.max_licenses, selectedSeats)
      window.location.assign(await startPlanChange(context.workspaceId, selected.id, 'monthly', quantity))
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Paiement indisponible.', 'error')
      setBusy(null)
    }
  }

  const redirectToPortal = async (paymentMethod = false) => {
    setBusy(paymentMethod ? 'payment' : 'portal')
    try {
      window.location.assign(await openBillingPortal(context.workspaceId, paymentMethod ? 'payment_method_update' : undefined))
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Portail Stripe indisponible.', 'error')
      setBusy(null)
    }
  }

  const sendInvitation = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy('invite')
    try {
      await inviteTeamMember(context.workspaceId, invite.email, invite.role)
      toast(`Invitation envoyée à ${invite.email}.`)
      setInvite({ email: '', role: 'member' })
      await load()
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Invitation impossible.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const sendDeletionRequest = async (values: { primaryReason: string; retentionFactor: string; deletionScope: string; details: string }) => {
    setBusy('deletion')
    try {
      await submitAccountDeletionRequest({ organizationId: context.workspaceId, ...values })
      const request = await getMyAccountDeletionRequest()
      setDeletionRequest(request)
      setDeletionModal(false)
      toast('Ta demande a été transmise à l’équipe technique.')
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Impossible de transmettre la demande.', 'error')
    } finally {
      setBusy(null)
    }
  }

  if (error) return <div className="inline-error">{error}</div>
  if (!profile || !account || !plan) return <div className="loading-state"><span className="spinner" /></div>

  const nextAmount = billing.upcoming?.amountDue ?? account.subscription.amount_per_period
  const nextDate = billing.upcoming?.date ?? account.subscription.current_period_end
  const paidPlan = plan.id !== 'free' && !isComped

  return <div className="account-center">
    <section className="account-hero">
      <div className="account-hero__identity">
        <span className="account-avatar">{profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : initials(profile.full_name || displayName(context.session.user))}</span>
        <div><span className="account-eyebrow">{account.organization.name}</span><h2>{profile.full_name}</h2><p>{context.session.user.email}</p></div>
      </div>
      <div className="account-hero__plan">
        <span>{isComped ? displayPlanName : `Tohu ${plan.name}`}</span>
        <b>{isComped ? 'Offert' : money(plan.price_monthly)}</b>
        <small>{isComped ? 'Accès Business sans facturation' : 'par siège / mois'}</small>
      </div>
    </section>

    <nav className="account-jump" aria-label="Sections du compte">
      <a href="#abonnement">Abonnement</a><a href="#canaux">Canaux</a><a href="#equipe">Équipe & sièges</a><a href="#facturation">Facturation</a><a href="#profil">Profil</a>
    </nav>

    <section className="account-section" id="abonnement">
      <header className="account-section__head">
        <div><span className="account-kicker">Abonnement</span><h2>Le plan adapté à ton usage</h2><p>Change de formule depuis Tohu, puis confirme le paiement de façon sécurisée dans Stripe.</p></div>
        <span className={`account-pill ${account.subscription.status === 'active' ? 'success' : 'warning'}`}>{STATUS_LABELS[account.subscription.status] ?? account.subscription.status}</span>
      </header>
      <div className="account-current">
        <div><span>Plan actuel</span><strong>{displayPlanName}</strong><small>{plan.description}</small></div>
        <div><span>Cycle</span><strong>{account.subscription.billing_cycle === 'yearly' ? 'Annuel' : 'Mensuel'}</strong><small>{account.subscription.cancel_at_period_end ? `Fin prévue le ${date(account.subscription.current_period_end)}` : 'Renouvellement automatique'}</small></div>
        <div><span>Sièges actifs</span><strong>{memberCount} / {paidSeats}</strong><small>Maximum du plan : {seatLimit}</small></div>
      </div>
      <div className="account-plans">
        {account.plans.map((item) => <PlanCard
          key={item.id}
          plan={item}
          current={item.id === plan.id}
          busy={busy !== null}
          canManage={account.can_manage && !isComped}
          onChoose={() => item.id === 'free' ? void redirectToPortal() : void redirectToPlan(item)}
        />)}
      </div>
      {!billing.configured ? <p className="account-setup-note">Configuration requise avant ouverture des paiements : ajoute les secrets Stripe et les Price IDs dans Supabase. Les boutons sont déjà branchés au parcours sécurisé.</p> : null}
    </section>

    <section className="account-section" id="canaux">
      <header className="account-section__head">
        <div><span className="account-kicker">Canaux connectés</span><h2>{connected.length} source{connected.length > 1 ? 's' : ''} active{connected.length > 1 ? 's' : ''}</h2><p>Les données synchronisées alimentent la mémoire relationnelle de ton workspace.</p></div>
        <Link className="btn-secondary" to="/app/connectors">Gérer les canaux</Link>
      </header>
      {account.connectors.length ? <div className="account-channels">{account.connectors.map((connector) => <article key={connector.id}>
        <span className="account-channel__icon">{PROVIDER_NAMES[connector.provider]?.slice(0, 1) ?? connector.provider.slice(0, 1).toUpperCase()}</span>
        <div><strong>{PROVIDER_NAMES[connector.provider] ?? connector.provider}</strong><small>{connector.account_email ?? (connector.last_synced_at ? `Synchronisé le ${date(connector.last_synced_at)}` : 'Aucun compte identifié')}</small></div>
        <span className={`account-dot ${connector.status === 'connected' ? 'on' : ''}`}><i />{connector.status === 'connected' ? 'Connecté' : 'À connecter'}</span>
      </article>)}</div> : <div className="account-empty"><b>Aucun canal connecté</b><span>Connecte Google, Microsoft ou ton CRM pour commencer la synchronisation.</span><Link className="btn-view" to="/app/connectors">Connecter un canal</Link></div>}
    </section>

    <section className="account-section" id="equipe">
      <header className="account-section__head">
        <div><span className="account-kicker">Équipe & sièges</span><h2>{memberCount} membre{memberCount > 1 ? 's' : ''} actif{memberCount > 1 ? 's' : ''}</h2><p>Un siège est facturé uniquement lorsqu’un membre rejoint réellement le workspace.</p></div>
        <div className="account-seat-ring" style={{ '--seat-progress': `${Math.min(100, memberCount / paidSeats * 100)}%` } as React.CSSProperties}><b>{Math.max(0, paidSeats - memberCount)}</b><span>libre{paidSeats - memberCount > 1 ? 's' : ''}</span></div>
      </header>
      <div className="account-team-layout">
        <div className="account-members">
          {account.members.map((member) => <article key={member.user_id}>
            <span className="account-member-avatar">{member.avatar_url ? <img src={member.avatar_url} alt="" /> : initials(member.full_name)}</span>
            <div><strong>{member.full_name}</strong><small>{member.email}</small></div>
            <span className="account-role">{member.role === 'owner' ? 'Propriétaire' : member.role === 'admin' ? 'Admin' : 'Membre'}</span>
          </article>)}
          {account.invitations.map((pending) => <article className="is-pending" key={pending.id}>
            <span className="account-member-avatar">…</span><div><strong>{pending.email}</strong><small>Expire le {date(pending.expires_at)}</small></div><span className="account-role">Invitation en attente</span>
          </article>)}
        </div>
        <aside className="account-seats">
          <span className="account-kicker">Sièges professionnels</span>
          <h3>{paidSeats} siège{paidSeats > 1 ? 's' : ''} souscrit{paidSeats > 1 ? 's' : ''}</h3>
          <div className="account-progress"><i style={{ width: `${Math.min(100, memberCount / paidSeats * 100)}%` }} /></div>
          <p>{memberCount} utilisé{memberCount > 1 ? 's' : ''} · {availableSeats} disponible{availableSeats > 1 ? 's' : ''}</p>
          {account.can_manage && ['pro', 'business'].includes(plan.id) && !isComped ? <div className="account-seat-adjust">
            <label htmlFor="seat-count">Nombre de sièges</label>
            <input id="seat-count" className="input" type="number" min={memberCount} max={seatLimit} value={seats} onChange={(event) => setSeats(Math.max(memberCount, Number(event.target.value)))} />
            <button className="btn-secondary" type="button" disabled={seats === paidSeats || busy !== null} onClick={() => void redirectToPlan(plan, seats)}>Mettre à jour via Stripe</button>
          </div> : null}
          <form className="account-invite" onSubmit={(event) => void sendInvitation(event)}>
            <label htmlFor="team-email">Inviter un membre</label>
            <input id="team-email" className="input" type="email" placeholder="prenom@entreprise.com" value={invite.email} onChange={(event) => setInvite((current) => ({ ...current, email: event.target.value }))} required />
            <select className="select" value={invite.role} onChange={(event) => setInvite((current) => ({ ...current, role: event.target.value as 'admin' | 'member' }))}><option value="member">Membre</option><option value="admin">Admin</option></select>
            <button className="btn-view" type="submit" disabled={!account.can_manage || availableSeats < 1 || busy !== null}>{busy === 'invite' ? 'Envoi…' : availableSeats < 1 ? 'Aucun siège disponible' : 'Envoyer l’invitation'}</button>
          </form>
        </aside>
      </div>
    </section>

    <section className="account-section" id="facturation">
      <header className="account-section__head">
        <div><span className="account-kicker">Facturation</span><h2>Paiements et factures</h2><p>Stripe sécurise les moyens de paiement, les échéances et les documents comptables.</p></div>
        {account.can_manage ? <button className="btn-secondary" type="button" disabled={!billing.customerLinked || busy !== null} onClick={() => void redirectToPortal()}>{busy === 'portal' ? 'Ouverture…' : 'Gérer dans Stripe'}</button> : null}
      </header>
      <div className="account-billing-cards">
        <article><span>Prochaine échéance</span><strong>{isComped || !paidPlan ? 'Aucune' : money(nextAmount, billing.upcoming?.currency)}</strong><small>{isComped ? `${displayPlanName} offert` : paidPlan ? date(nextDate) : 'Plan gratuit, sans prélèvement'}</small></article>
        <article><span>Moyen de paiement</span><strong>{billing.paymentMethod?.last4 ? `•••• ${billing.paymentMethod.last4}` : 'Non renseigné'}</strong><small>{billing.paymentMethod?.brand ? `${billing.paymentMethod.brand.toUpperCase()} · expire ${billing.paymentMethod.expMonth}/${billing.paymentMethod.expYear}` : 'Géré de manière sécurisée par Stripe'}</small>{account.can_manage ? <button type="button" disabled={!billing.customerLinked || busy !== null} onClick={() => void redirectToPortal(true)}>Mettre à jour</button> : null}</article>
        <article><span>Statut</span><strong>{STATUS_LABELS[account.subscription.status] ?? account.subscription.status}</strong><small>{account.subscription.cancel_at_period_end ? `Résiliation prévue le ${date(account.subscription.current_period_end)}` : 'Abonnement à jour'}</small></article>
      </div>
      <div className="account-invoices">
        <div className="account-invoices__head"><strong>Historique des factures</strong><span>{billing.invoices.length} document{billing.invoices.length > 1 ? 's' : ''}</span></div>
        {billing.invoices.length ? billing.invoices.map((invoice) => <article key={invoice.id}>
          <div><strong>{invoice.number ?? 'Facture Stripe'}</strong><small>{date(invoice.created)}</small></div>
          <span className={`account-pill ${invoice.status === 'paid' ? 'success' : 'warning'}`}>{invoice.status === 'paid' ? 'Payée' : invoice.status}</span>
          <b>{money(invoice.amountPaid || invoice.amountDue, invoice.currency)}</b>
          {invoice.invoicePdf ? <a className="btn-secondary" href={invoice.invoicePdf} target="_blank" rel="noreferrer">Télécharger</a> : invoice.hostedInvoiceUrl ? <a className="btn-secondary" href={invoice.hostedInvoiceUrl} target="_blank" rel="noreferrer">Consulter</a> : <span>—</span>}
        </article>) : <div className="account-empty compact"><b>Aucune facture disponible</b><span>{billing.configured ? 'Les factures Stripe apparaîtront ici après le premier paiement.' : 'L’historique sera synchronisé dès que Stripe sera configuré.'}</span></div>}
      </div>
    </section>

    <section className="account-profile-grid" id="profil">
      <section className="panel">
        <header className="panel-head"><span><span className="panel-title">Informations du compte</span><span className="panel-sub">Ton identité dans Tohu</span></span></header>
        <form className="panel-body settings-form" onSubmit={(event) => void saveProfile(event)}>
          <div className="field"><label htmlFor="settings-name">Nom complet</label><input className="input" id="settings-name" value={form.full_name} onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))} required /></div>
          <div className="field"><label htmlFor="settings-email">Email</label><input className="input" id="settings-email" value={context.session.user.email ?? ''} disabled /></div>
          <div className="field"><label htmlFor="settings-avatar">URL de l’avatar</label><input className="input" id="settings-avatar" value={form.avatar_url} onChange={(event) => setForm((current) => ({ ...current, avatar_url: event.target.value }))} placeholder="https://…" /></div>
          <button className="btn-view" type="submit" disabled={busy !== null}>{busy === 'profile' ? 'Enregistrement…' : 'Enregistrer'}</button>
        </form>
      </section>
      <section className="panel">
        <header className="panel-head"><span><span className="panel-title">Notifications</span><span className="panel-sub">Choisis les alertes utiles</span></span></header>
        <div className="panel-body">{PREFERENCE_ROWS.map((row) => <div className="switch-row" key={row.key}><span><b>{row.title}</b><small>{row.copy}</small></span><button type="button" className={`switch ${preferences[row.key] ? 'on' : ''}`} onClick={() => void togglePreference(row.key)} aria-pressed={preferences[row.key]}><i /></button></div>)}</div>
      </section>
      {profile.platform_role === 'super_admin' && profile.is_super_admin ? <section className="panel super-admin-entry">
        <header className="panel-head"><span className="super-admin-entry__badge">TOHU INTERNE</span><span><span className="panel-title">Mode Super Admin</span><span className="panel-sub">Pilotage global et KPIs de la plateforme</span></span></header>
        <div className="panel-body"><p>Accède à la vue consolidée de Tohu, séparée de ce workspace.</p><Link className="btn-view" to="/super-admin">Activer le mode Super Admin <span aria-hidden="true">→</span></Link></div>
      </section> : null}
      <section className="panel account-session"><header className="panel-head"><span><span className="panel-title">Session</span><span className="panel-sub">Sécurité du compte</span></span></header><div className="panel-body"><button type="button" className="btn-secondary" onClick={() => void signOut()}>Se déconnecter</button></div></section>
    </section>
    <section className="account-delete-entry">
      <div><span className="account-kicker">Gestion du compte</span><h2>Supprimer mon compte</h2><p>Demande la suppression de ton compte et de tes données. L’équipe technique vérifiera ta demande avant toute action.</p></div>
      {deletionRequest && ['pending', 'reviewing', 'confirmed'].includes(deletionRequest.status)
        ? <div className="account-delete-state"><span className="account-pill warning">{DELETION_STATUS_LABELS[deletionRequest.status]}</span><small>Envoyée le {date(deletionRequest.requested_at)}</small></div>
        : <button type="button" className="btn-danger" onClick={() => setDeletionModal(true)}>Supprimer mon compte</button>}
    </section>
    {deletionModal ? <DeletionRequestModal submitting={busy === 'deletion'} onClose={() => setDeletionModal(false)} onSubmit={sendDeletionRequest} /> : null}
  </div>
}
