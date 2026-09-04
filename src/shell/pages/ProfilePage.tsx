import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { initials } from '../../lib/auth'
import { buildCognitiveProfile } from '../../person-detail/mapping'
import { V48PersonProfileView } from '../../person-detail/V48PersonViews'
import type { PersonDetailData, PersonSourceStatus } from '../../person-detail/types'
import { MIN_BEHAVIOR_INTERACTIONS, MIN_COGNITIVE_PROFILE_INTERACTIONS } from '../../person-detail/types'
import { confidenceLevel } from '../../person-detail/ui'
import { FicheSkeleton } from '../../components/FicheSkeleton'
import { getProfile, getResponsibleBehaviorProfile, listManagedAccounts, type Account, type ProfileRow, type UserBehaviorProfile } from '../../services/data'

type PageContext = { session: Session; workspaceId: string }
type Behavior = UserBehaviorProfile | null
type ProfileTab = 'profile' | 'portfolio' | 'sources'

function formatDate(value: string | null | undefined, fallback = 'Jamais'): string {
  if (!value) return fallback
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}

function Icon({ name }: { name: 'accounts' | 'source' }) {
  const paths: Record<typeof name, ReactNode> = {
    accounts: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M8.5 8h2M13.5 8h2M8.5 12h2M13.5 12h2M10 20v-4h4v4" /></>,
    source: <><path d="M8 12h8M12 8v8" /><circle cx="12" cy="12" r="8.5" /></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function SectionTitle({ icon, title, meta }: { icon: Parameters<typeof Icon>[0]['name']; title: string; meta?: ReactNode }) {
  return <header className="v48-section-title"><span><Icon name={icon} /></span><h2>{title}</h2>{meta && <div>{meta}</div>}</header>
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="v48-empty"><span>◇</span><p>{children}</p></div>
}

function sourceRows(behavior: Behavior): PersonSourceStatus[] {
  return [...new Set(behavior?.updated_from ?? [])].map((provider) => ({
    provider,
    label: provider === 'google' ? 'Gmail' : provider === 'microsoft' ? 'Microsoft 365' : provider === 'email' ? 'Emails envoyés' : provider,
    status: 'connected',
    lastSyncedAt: behavior?.updated_at ?? null,
    interactionCount: behavior?.source_message_count ?? 0,
    error: null,
  }))
}

/** Adaptateur d'affichage uniquement : « Mon profil » consomme exactement le
 * même composant V57 et le même contrat cognitif que les fiches Personne. */
function buildSelfDetail(profile: ProfileRow, behavior: Behavior, workspaceId: string): PersonDetailData {
  const analyzed = behavior?.source_interaction_count ?? behavior?.source_message_count ?? 0
  const updatedAt = behavior?.last_analyzed_at ?? behavior?.updated_at ?? null
  const generatedAt = new Date().toISOString()
  return {
    generatedAt,
    degradedReasons: [],
    person: {
      id: profile.id, workspaceId, fullName: profile.full_name, avatarUrl: profile.avatar_url,
      jobTitle: profile.role_title, location: null, biography: profile.product_summary,
      relationshipType: 'Interne', decisionRole: null, relationshipRole: null,
      favorite: false, watchEnabled: false, archivedAt: null, primaryOwnerName: profile.full_name,
      primaryOwnerUserId: null, visibility: 'workspace',
      createdAt: null, updatedAt, locked: false, lockedByMe: false, lockedByName: null, lockedAt: null,
    },
    summary: behavior?.executive_summary ? {
      text: behavior.executive_summary, confidence: behavior.global_confidence, generatedAt: updatedAt,
      provenance: null,
    } : null,
    employment: null,
    relationship: {
      score: null, phase: 'unknown', phaseDelta: null, confidence: behavior?.global_confidence ?? null,
      computedAt: updatedAt, totalInteractions: analyzed, emailInteractions: analyzed, meetingInteractions: 0,
      firstInteractionAt: null, lastInteractionAt: updatedAt, relationshipAgeDays: null,
      dimensions: { confiance: null, satisfaction: null, engagement: null, reciprocite: null, ancrage: null, ancrageCarriers: null, confianceMeasured: false, satisfactionMeasured: false },
      axisInterpretation: null,
    },
    scoreHistory: [],
    behavior: {
      executiveSummary: behavior?.executive_summary ?? null,
      globalConfidence: behavior?.global_confidence ?? null,
      cognitiveMode: behavior?.cognitive_mode ?? null,
      availableInteractions: analyzed,
      analyzedInteractions: analyzed,
      analyzedEmailInteractions: analyzed,
      analyzedMeetingInteractions: 0,
      profileMinimumInteractions: MIN_COGNITIVE_PROFILE_INTERACTIONS,
      minimumInteractions: MIN_BEHAVIOR_INTERACTIONS,
      cognitiveProfile: buildCognitiveProfile({ cognitive_profile_data: behavior?.cognitive_profile_data ?? {} }, analyzed),
      insights: [], evidences: [], updatedAt,
    },
    sources: sourceRows(behavior), recommendations: [], signals: [], contactDetails: [], careerEntries: [],
    memoryEntries: [], enrichment: null, keyMoments: [], history: [], nameSuggestion: null, mergeSuggestions: [],
  }
}

function IdentityCard({ profile, behavior, email, accountCount }: { profile: ProfileRow; behavior: Behavior; email: string; accountCount: number }) {
  const level = confidenceLevel(behavior?.global_confidence ?? null)
  const analyzed = behavior?.source_interaction_count ?? behavior?.source_message_count ?? 0
  return <section className="hero-header v48-identity-card v48-self-identity">
    <div className="hero-body v48-identity-body">
      <div className="hero-left v48-identity-left">
        <div className="v48-avatar-wrap">{profile.avatar_url ? <img src={profile.avatar_url} alt={`Photo de ${profile.full_name}`} /> : <span>{initials(profile.full_name)}</span>}<i aria-hidden="true" /></div>
        <div className="v48-identity-copy">
          <div className="v48-eyebrow">Mon profil / {profile.full_name}</div>
          <div className="v48-name-row"><div className="hero-name">{profile.full_name}</div><span className="v48-live"><i />Moi</span></div>
          <div className="hero-sub"><span>{profile.role_title ?? 'Fonction à préciser'}</span>{profile.company_name && <><span className="hero-dot" /><span>{profile.company_name}</span></>}</div>
          <div className="mh-meta">
            <span className="rel-chip"><span className="rel-k">Rôle</span><span className="rel-v">{profile.role_title ?? 'À compléter'}</span></span>
            <span className="rel-chip"><span className="rel-k">Organisation</span><span className="rel-v">{profile.company_name ?? 'À compléter'}</span></span>
          </div>
        </div>
      </div>
      <div className="hero-right v48-identity-right">
        <div className="v48-reliability"><span>Indice de fiabilité</span><strong className={`v48-reliability-${level ?? 'none'}`}>{level ? level.charAt(0).toUpperCase() + level.slice(1) : 'À confirmer'}</strong><div><span><b>{analyzed}</b> email{analyzed > 1 ? 's' : ''} analysé{analyzed > 1 ? 's' : ''}</span><span><b>{accountCount}</b> compte{accountCount > 1 ? 's' : ''} suivi{accountCount > 1 ? 's' : ''}</span></div></div>
        <div className="v48-owner-card"><span className="v48-owner-avatar">{initials(profile.full_name)}</span><div><span>Profil connecté</span><strong>{email}</strong><small>{profile.platform_role === 'super_admin' ? 'Super administrateur' : 'Membre Tohu'}</small></div></div>
      </div>
    </div>
  </section>
}

function PortfolioView({ accounts, navigate }: { accounts: Account[]; navigate: ReturnType<typeof useNavigate> }) {
  return <div className="v48-person-profile"><section className="v48-section">
    <SectionTitle icon="accounts" title="Comptes suivis" meta={<span className="v48-section-count"><b>{accounts.length}</b> sous votre responsabilité</span>} />
    {accounts.length ? <div className="v48-org-grid v48-self-accounts">{accounts.map((account) => <button type="button" key={account.id} style={{ '--person-tone': '#6e50c8' } as CSSProperties} onClick={() => navigate(`/app/accounts/${account.id}`)}><span>{initials(account.name)}</span><div><small>Compte suivi</small><strong>{account.name}</strong><p>{account.industry ?? account.domain ?? 'Secteur à confirmer'}</p></div><b>→</b></button>)}</div> : <EmptyState>Les comptes dont vous êtes responsable apparaîtront ici.</EmptyState>}
  </section></div>
}

function SourcesView({ profile, behavior, email }: { profile: ProfileRow; behavior: Behavior; email: string }) {
  const sources = behavior?.updated_from ?? []
  return <div className="v48-person-profile"><section className="v48-section">
    <SectionTitle icon="source" title="Sources et preuves" meta={<span className="v48-section-count">Données agrégées · aucun corps d’email conservé</span>} />
    <div className="v48-firmographic-grid v48-self-sources">
      <article><span>Email connecté</span><strong>{email}</strong><small>Identité du profil</small></article>
      <article><span>Emails analysés</span><strong>{behavior?.source_interaction_count ?? behavior?.source_message_count ?? 0}</strong><small>Productions sortantes attribuées</small></article>
      <article><span>Sources</span><strong>{sources.length ? sources.join(' + ') : 'À connecter'}</strong><small>Gmail ou Microsoft 365</small></article>
      <article><span>Dernière analyse</span><strong>{formatDate(behavior?.last_analyzed_at ?? behavior?.updated_at)}</strong><small>Mise à jour du profil</small></article>
      <article><span>Site web</span><strong>{profile.website_url ?? 'À compléter'}</strong><small>Information déclarative</small></article>
      <article><span>Version d’analyse</span><strong>{behavior?.analysis_version ? `V${behavior.analysis_version}` : 'À recalculer'}</strong><small>Contrat comportemental</small></article>
    </div>
  </section></div>
}

export default function ProfilePage({ context }: { context: PageContext }) {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<ProfileTab>('profile')
  const [state, setState] = useState<{ profile: ProfileRow; behavior: Behavior; accounts: Account[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    const [profile, behavior, accounts] = await Promise.all([getProfile(context.session.user.id), getResponsibleBehaviorProfile(context.session.user.id, context.workspaceId), listManagedAccounts(context.session.user.id)])
    setState({ profile, behavior, accounts })
  }, [context.session.user.id, context.workspaceId])
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Une erreur inattendue est survenue.')) }, [load])

  const selfDetail = useMemo(() => state ? buildSelfDetail(state.profile, state.behavior, context.workspaceId) : null, [state, context.workspaceId])
  if (error) return <div className="ra-state error"><h1>Impossible de charger votre profil</h1><p>{error}</p></div>
  if (!state || !selfDetail) return <FicheSkeleton label="Chargement du profil…" />
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
      {activeTab === 'profile' && <V48PersonProfileView data={selfDetail} userId={context.session.user.id} refresh={load} manualSyncAction={!behavior?.cognitive_profile_data || behavior.analysis_version < 3 ? <button type="button" className="cognitive-sync-action" onClick={() => navigate('/app/connectors')}>Synchroniser mes sources</button> : undefined} />}
      {activeTab === 'portfolio' && <PortfolioView accounts={accounts} navigate={navigate} />}
      {activeTab === 'sources' && <SourcesView profile={profile} behavior={behavior} email={email} />}
    </div>
  </div>
}
