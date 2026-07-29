import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { initials } from '../../lib/auth'
import { confidenceLevel } from '../../person-detail/ui'
import { getProfile, getResponsibleBehaviorProfile, listManagedAccounts, type Account, type ProfileRow } from '../../services/data'

type PageContext = { session: Session; workspaceId: string }
type Behavior = Awaited<ReturnType<typeof getResponsibleBehaviorProfile>>
type ProfileTab = 'profile' | 'portfolio' | 'sources'
type Insight = { trait: string; observation: string; confidence: number | null }

function formatDate(value: string | null | undefined, fallback = 'Jamais'): string {
  if (!value) return fallback
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}

function Icon({ name }: { name: 'profile' | 'sparkle' | 'accounts' | 'source' }) {
  const paths: Record<typeof name, ReactNode> = {
    profile: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3" /><circle cx="12" cy="12" r="2.5" /></>,
    sparkle: <><path d="m12 3 1.3 3.7L17 8l-3.7 1.3L12 13l-1.3-3.7L7 8l3.7-1.3Z" /><path d="m18 14 .8 2.2 2.2.8-2.2.8L18 20l-.8-2.2L15 17l2.2-.8Z" /></>,
    accounts: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M8.5 8h2M13.5 8h2M8.5 12h2M13.5 12h2M10 20v-4h4v4" /></>,
    source: <><path d="M8 12h8M12 8v8" /><circle cx="12" cy="12" r="8.5" /></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function SectionTitle({ icon, title, meta }: { icon: Parameters<typeof Icon>[0]['name']; title: string; meta?: ReactNode }) {
  return <header className="v48-section-title">
    <span><Icon name={icon} /></span>
    <h2>{title}</h2>
    {meta && <div>{meta}</div>}
  </header>
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="v48-empty"><span>◇</span><p>{children}</p></div>
}

function SelfRadar({ insights }: { insights: Insight[] }) {
  const themes = insights.slice(0, 6)
  if (themes.length < 3) return <EmptyState>Le radar apparaîtra lorsque trois dimensions comportementales seront suffisamment étayées.</EmptyState>
  const cx = 210
  const cy = 160
  const radius = 102
  const value = (item: Insight) => Math.max(12, Math.min(100, item.confidence ?? 42))
  const point = (index: number, score: number): [number, number] => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / themes.length
    const distance = radius * score / 100
    return [cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance]
  }
  const polygon = themes.map((item, index) => point(index, value(item)).join(',')).join(' ')
  const ring = (score: number) => themes.map((_, index) => point(index, score).join(',')).join(' ')
  return <div className="v48-radar-wrap">
    <svg className="v48-radar" viewBox="0 0 420 320" role="img" aria-label={themes.map((item) => `${item.trait} ${value(item)} sur 100`).join(', ')}>
      {[25, 50, 75, 100].map((score) => <polygon key={score} points={ring(score)} className="v48-radar-ring" />)}
      {themes.map((_, index) => {
        const [x, y] = point(index, 100)
        return <line key={index} x1={cx} y1={cy} x2={x} y2={y} className="v48-radar-axis" />
      })}
      <polygon points={polygon} className="v48-radar-area" />
      {themes.map((item, index) => {
        const [x, y] = point(index, value(item))
        const [labelX, labelY] = point(index, 125)
        return <g key={`${item.trait}-${index}`}>
          <circle cx={x} cy={y} r="4.5" className="v48-radar-dot" />
          <text x={labelX} y={labelY} textAnchor={labelX < cx - 12 ? 'end' : labelX > cx + 12 ? 'start' : 'middle'} className="v48-radar-label">{item.trait}</text>
          <text x={labelX} y={labelY + 15} textAnchor={labelX < cx - 12 ? 'end' : labelX > cx + 12 ? 'start' : 'middle'} className="v48-radar-value">{value(item)}%</text>
        </g>
      })}
    </svg>
  </div>
}

function IdentityCard({ profile, behavior, email, accountCount }: {
  profile: ProfileRow
  behavior: Behavior
  email: string
  accountCount: number
}) {
  const level = confidenceLevel(behavior?.global_confidence ?? null)
  return <section className="hero-header v48-identity-card v48-self-identity">
    <div className="hero-body v48-identity-body">
      <div className="hero-left v48-identity-left">
        <div className="v48-avatar-wrap">
          {profile.avatar_url ? <img src={profile.avatar_url} alt={`Photo de ${profile.full_name}`} /> : <span>{initials(profile.full_name)}</span>}
          <i aria-hidden="true" />
        </div>
        <div className="v48-identity-copy">
          <div className="v48-eyebrow">Mon profil / {profile.full_name}</div>
          <div className="v48-name-row">
            <div className="hero-name">{profile.full_name}</div>
            <span className="v48-live"><i />Moi</span>
          </div>
          <div className="hero-sub">
            <span>{profile.role_title ?? 'Fonction à préciser'}</span>
            {profile.company_name && <><span className="hero-dot" /><span>{profile.company_name}</span></>}
          </div>
          <div className="mh-meta">
            <span className="rel-chip"><span className="rel-k">Rôle</span><span className="rel-v">{profile.role_title ?? 'À compléter'}</span></span>
            <span className="rel-chip"><span className="rel-k">Organisation</span><span className="rel-v">{profile.company_name ?? 'À compléter'}</span></span>
          </div>
        </div>
      </div>
      <div className="hero-right v48-identity-right">
        <div className="v48-reliability">
          <span>Indice de fiabilité</span>
          <strong className={`v48-reliability-${level ?? 'none'}`}>{level ? level.charAt(0).toUpperCase() + level.slice(1) : 'À confirmer'}</strong>
          <div>
            <span><b>{behavior?.source_message_count ?? 0}</b> email{(behavior?.source_message_count ?? 0) > 1 ? 's' : ''} analysé{(behavior?.source_message_count ?? 0) > 1 ? 's' : ''}</span>
            <span><b>{accountCount}</b> compte{accountCount > 1 ? 's' : ''} suivi{accountCount > 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="v48-owner-card">
          <span className="v48-owner-avatar">{initials(profile.full_name)}</span>
          <div>
            <span>Profil connecté</span>
            <strong>{email}</strong>
            <small>{profile.platform_role === 'super_admin' ? 'Super administrateur' : 'Membre Tohu'}</small>
          </div>
        </div>
      </div>
    </div>
  </section>
}

function ProfileView({ behavior, insights }: { behavior: Behavior; insights: Insight[] }) {
  return <div className="v48-person-profile">
    <div className="v48-now-grid">
      <article className="v48-next-meeting v48-self-summary">
        <span className="v48-now-icon"><Icon name="sparkle" /></span>
        <div>
          <span className="v48-kicker">Votre lecture Tohu <b><i />Live</b></span>
          <strong>{behavior?.executive_summary ?? 'Lecture comportementale en construction'}</strong>
          <small>Déduite de vos communications professionnelles envoyées, jamais d’un questionnaire.</small>
        </div>
      </article>
      <article className="v48-posture">
        <span>Mode relationnel dominant</span>
        <p>{behavior?.cognitive_mode ?? 'Connectez Gmail ou Outlook puis synchronisez vos échanges pour faire émerger votre mode relationnel.'}</p>
      </article>
    </div>

    <section className="v48-section">
      <SectionTitle
        icon="profile"
        title="Profil comportemental"
        meta={<span className="v48-section-count"><b>{insights.length}</b> dimensions · {behavior?.source_message_count ?? 0} emails analysés</span>}
      />
      {!insights.length
        ? <EmptyState>Les dimensions comportementales apparaîtront après plusieurs emails envoyés suffisamment riches et concordants.</EmptyState>
        : <div className="v48-behavior-grid">
          <div>
            <p className="v48-overline">Votre profil déduit des échanges réels</p>
            <SelfRadar insights={insights} />
          </div>
          <div className="v48-adaptation-list">
            <p className="v48-overline">Ce que montre votre communication</p>
            {insights.map((item, index) => <article key={`${item.trait}-${index}`}>
              <span className="v48-confidence v48-confidence-observed">{confidenceLevel(item.confidence) ?? 'à confirmer'}</span>
              <h3>{item.trait}</h3>
              <p>{item.observation}</p>
              <small>Observation inférée · emails envoyés</small>
            </article>)}
          </div>
        </div>}
    </section>

    <details className="v48-detail-fold">
      <summary><Icon name="profile" /><strong>Le profil en détail</strong><span>{insights.length} dimensions observées</span><b>⌄</b></summary>
      <div className="v48-detail-grid">
        {insights.map((item, index) => <article key={`${item.trait}-detail-${index}`}>
          <strong>{item.confidence ?? '—'}%</strong>
          <div><h3>{item.trait}</h3><p>{item.observation}</p></div>
        </article>)}
        {!insights.length && <EmptyState>Aucune dimension détaillée suffisamment étayée pour le moment.</EmptyState>}
      </div>
    </details>
  </div>
}

function PortfolioView({ accounts, navigate }: { accounts: Account[]; navigate: ReturnType<typeof useNavigate> }) {
  return <div className="v48-person-profile">
    <section className="v48-section">
      <SectionTitle icon="accounts" title="Comptes suivis" meta={<span className="v48-section-count"><b>{accounts.length}</b> sous votre responsabilité</span>} />
      {accounts.length
        ? <div className="v48-org-grid v48-self-accounts">
          {accounts.map((account) => <button type="button" key={account.id} style={{ '--person-tone': '#6e50c8' } as CSSProperties} onClick={() => navigate(`/app/accounts/${account.id}`)}>
            <span>{initials(account.name)}</span>
            <div><small>Compte suivi</small><strong>{account.name}</strong><p>{account.industry ?? account.domain ?? 'Secteur à confirmer'}</p></div>
            <b>→</b>
          </button>)}
        </div>
        : <EmptyState>Les comptes dont vous êtes responsable apparaîtront ici.</EmptyState>}
    </section>
  </div>
}

function SourcesView({ profile, behavior, email }: { profile: ProfileRow; behavior: Behavior; email: string }) {
  const sources = behavior?.updated_from ?? []
  return <div className="v48-person-profile">
    <section className="v48-section">
      <SectionTitle icon="source" title="Sources et preuves" meta={<span className="v48-section-count">Données agrégées · aucun corps d’email conservé</span>} />
      <div className="v48-firmographic-grid v48-self-sources">
        <article><span>Email connecté</span><strong>{email}</strong><small>Identité du profil</small></article>
        <article><span>Emails analysés</span><strong>{behavior?.source_message_count ?? 0}</strong><small>Productions sortantes attribuées</small></article>
        <article><span>Sources</span><strong>{sources.length ? sources.join(' + ') : 'À connecter'}</strong><small>Gmail ou Microsoft 365</small></article>
        <article><span>Dernière analyse</span><strong>{formatDate(behavior?.updated_at)}</strong><small>Mise à jour du profil</small></article>
        <article><span>Site web</span><strong>{profile.website_url ?? 'À compléter'}</strong><small>Information déclarative</small></article>
        <article><span>Mode dominant</span><strong>{behavior?.cognitive_mode ?? 'À confirmer'}</strong><small>Inférence comportementale</small></article>
      </div>
    </section>
  </div>
}

export default function ProfilePage({ context }: { context: PageContext }) {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<ProfileTab>('profile')
  const [state, setState] = useState<{ profile: ProfileRow; behavior: Behavior; accounts: Account[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void Promise.all([
      getProfile(context.session.user.id),
      getResponsibleBehaviorProfile(context.session.user.id, context.workspaceId),
      listManagedAccounts(context.session.user.id),
    ]).then(([profile, behavior, accounts]) => setState({ profile, behavior, accounts }))
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Une erreur inattendue est survenue.'))
  }, [context.session.user.id, context.workspaceId])

  const insights = useMemo<Insight[]>(() => (state?.behavior?.behavioral_analysis_data ?? []).flatMap((item) => {
    const trait = item.trait?.trim()
    const observation = item.observation?.trim()
    if (!trait || !observation) return []
    return [{ trait, observation, confidence: item.confidence ?? null }]
  }), [state?.behavior])

  if (error) return <div className="ra-state error"><h1>Impossible de charger votre profil</h1><p>{error}</p></div>
  if (!state) return <div className="ra-skeleton" aria-label="Chargement du profil"><i /><i /><i /></div>

  const { profile, behavior, accounts } = state
  const email = context.session.user.email ?? 'Email indisponible'

  return <div className="pp profile-self-page">
    <nav className="v48-tabs" role="tablist" aria-label="Sections de mon profil">
      <button type="button" role="tab" aria-selected={activeTab === 'profile'} className={activeTab === 'profile' ? 'on' : ''} onClick={() => setActiveTab('profile')}>Profil</button>
      <button type="button" role="tab" aria-selected={activeTab === 'portfolio'} className={activeTab === 'portfolio' ? 'on' : ''} onClick={() => setActiveTab('portfolio')}>Portefeuille</button>
      <button type="button" role="tab" aria-selected={activeTab === 'sources'} className={activeTab === 'sources' ? 'on' : ''} onClick={() => setActiveTab('sources')}>Sources &amp; preuves</button>
    </nav>
    <IdentityCard profile={profile} behavior={behavior} email={email} accountCount={accounts.length} />
    <div className="v48-tab-panel" role="tabpanel">
      {activeTab === 'profile' && <ProfileView behavior={behavior} insights={insights} />}
      {activeTab === 'portfolio' && <PortfolioView accounts={accounts} navigate={navigate} />}
      {activeTab === 'sources' && <SourcesView profile={profile} behavior={behavior} email={email} />}
    </div>
    <footer className="v48-source-note">
      {behavior?.source_message_count ?? 0} email{(behavior?.source_message_count ?? 0) > 1 ? 's' : ''} analysé{(behavior?.source_message_count ?? 0) > 1 ? 's' : ''}
      {' · '}profil mis à jour {formatDate(behavior?.updated_at)}
      {behavior?.updated_from?.length ? <> · {behavior.updated_from.join(' + ')}</> : null}
    </footer>
  </div>
}
