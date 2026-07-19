import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { initials } from '../../lib/auth'
import { getProfile, getResponsibleBehaviorProfile, listManagedAccounts, type Account, type ProfileRow } from '../../services/data'

type PageContext = { session: Session; workspaceId: string }
type Behavior = Awaited<ReturnType<typeof getResponsibleBehaviorProfile>>

function formatDate(value: string | null | undefined, fallback = 'Jamais'): string {
  if (!value) return fallback
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}

function EmptyState({ icon, title, copy }: { icon: string; title: string; copy: string }) {
  return <div className="empty-state"><span className="empty-ic">{icon}</span><b>{title}</b><p>{copy}</p></div>
}

function Panel({ icon, title, subtitle, children }: { icon: string; title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="panel">
    <header className="panel-head"><span className="panel-ic">{icon}</span><span><span className="panel-title">{title}</span><span className="panel-sub">{subtitle}</span></span></header>
    <div className="panel-body">{children}</div>
  </section>
}

/** Mon profil — port fidèle de la vue du shell historique (mêmes classes profile-*, detail-*, panel). */
export default function ProfilePage({ context }: { context: PageContext }) {
  const navigate = useNavigate()
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

  if (error) return <div className="inline-error">{error}</div>
  if (!state) return <div className="loading-state"><span className="spinner" /></div>

  const { profile, behavior, accounts } = state
  const email = context.session.user.email ?? '—'

  return <>
    <section className="profile-hero">
      {profile.avatar_url
        ? <div className="profile-avatar"><img src={profile.avatar_url} alt={`Photo de ${profile.full_name}`} /></div>
        : <div className="profile-avatar">{initials(profile.full_name)}</div>}
      <div>
        <h2>{profile.full_name}</h2>
        <p>{[profile.role_title, profile.company_name, context.session.user.email].filter(Boolean).join(' · ') || 'Responsable de compte'}</p>
      </div>
      <div className="profile-score"><b>{behavior?.global_confidence ?? '—'}</b><span>Confiance du profil</span></div>
    </section>
    <div className="detail-grid">
      <div className="detail-column">
        <Panel icon="◎" title="Profil utilisateur" subtitle="Informations du responsable connecté">
          <div className="detail-facts">
            <div className="fact"><span>Email</span><b>{email}</b></div>
            <div className="fact"><span>Rôle</span><b>{profile.role_title ?? '—'}</b></div>
            <div className="fact"><span>Organisation</span><b>{profile.company_name ?? '—'}</b></div>
            <div className="fact"><span>Site web</span><b>{profile.website_url ?? '—'}</b></div>
          </div>
        </Panel>
        <Panel icon="◎" title="Profil comportemental" subtitle="Analyse du responsable à partir de ses emails envoyés">
          {behavior?.executive_summary
            ? <p>{behavior.executive_summary}</p>
            : <EmptyState icon="◎" title="Lecture en construction" copy="Connecte Gmail ou Outlook puis synchronise les emails." />}
        </Panel>
        <Panel icon="⌁" title="Signaux personnels" subtitle={`${behavior?.behavioral_analysis_data?.length ?? 0} signal(s)`}>
          {behavior?.behavioral_analysis_data?.length
            ? behavior.behavioral_analysis_data.map((item, index) => <div className="signal" key={index}>
              <div className="signal-head"><b>{item.trait ?? 'Signal comportemental'}</b><span className="sig-tag">{item.confidence ?? '—'}%</span></div>
              <p>{item.observation ?? ''}</p>
            </div>)
            : <EmptyState icon="◎" title="Lecture en construction" copy="Connecte Gmail ou Outlook puis lance une synchronisation pour générer cette analyse." />}
        </Panel>
      </div>
      <div className="detail-column">
        <Panel icon="▦" title="Comptes suivis" subtitle={`${accounts.length} compte${accounts.length > 1 ? 's' : ''} sous responsabilité`}>
          {accounts.length
            ? <>
              {accounts.slice(0, 5).map((account) => <button type="button" className="linked-row" key={account.id} onClick={() => navigate(`/app/accounts/${account.id}`)}>
                <span className="entity-avatar">{initials(account.name)}</span>
                <span><b>{account.name}</b><small>{account.industry ?? 'Compte'}</small></span>
                <span>→</span>
              </button>)}
              {accounts.length > 5 && <button type="button" className="linked-row linked-row-more" onClick={() => navigate('/app/accounts')}>Voir plus ({accounts.length - 5} de plus)</button>}
            </>
            : <EmptyState icon="▦" title="Aucun compte attribué" copy="Les comptes des contacts dont tu es responsable apparaîtront ici." />}
        </Panel>
        <Panel icon="◷" title="Preuves agrégées" subtitle="Aucun corps d’email n’est conservé">
          {behavior
            ? <div className="detail-facts">
              <div className="fact"><span>Emails analysés</span><b>{behavior.source_message_count}</b></div>
              <div className="fact"><span>Sources</span><b>{behavior.updated_from.join(', ')}</b></div>
              <div className="fact"><span>Mode dominant</span><b>{behavior.cognitive_mode ?? '—'}</b></div>
              <div className="fact"><span>Dernière analyse</span><b>{formatDate(behavior.updated_at)}</b></div>
            </div>
            : <EmptyState icon="◷" title="Aucune preuve disponible" copy="Les preuves agrégées apparaîtront après la première synchronisation." />}
        </Panel>
      </div>
    </div>
  </>
}
