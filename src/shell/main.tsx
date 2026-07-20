/**
 * Shell React unifié — point d'entrée unique de l'app authentifiée (app.html).
 *
 * Ce fichier ne contient que la coquille : AppShell (sidebar, topbar, recherche
 * globale), la table des routes et le boot (session + workspace). Chaque écran
 * vit dans son dossier feature (account-list/, person-detail/, …) ou dans
 * shell/pages/ pour les vues portées depuis l'ancien shell vanilla.
 */
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import '../styles/fonts.css'
import '../styles/tokens.css'
import '../styles/app.css'
import '../styles/app-fixes.css'
import '../styles/home.css'
import '../styles/account-detail.css'
import '../styles/person-detail.css'
import '../styles/account-list.css'
import '../styles/person-list.css'
import '../styles/super-admin.css'
import '../styles/account-center.css'
import { tohuLogo } from '../components/logo'
import { displayName, initials, requireSession } from '../lib/auth'
import { getOrganizationId, getProfile, listAccounts, listPeople } from '../services/data'
import { getSupabase } from '../lib/supabase'
import { ToastProvider } from '../person-detail/ui'
import AccountsListPage from '../account-list/AccountsListPage'
import AccountDetailPage from '../account-detail/AccountDetailPage'
import PersonListPage from '../person-list/PersonListPage'
import PersonDetailPage from '../person-detail/PersonDetailPage'
import GlobalSearch from './GlobalSearch'
import AskPage from './pages/AskPage'
import HomePage from './pages/HomePage'
import ConnectorsPage from './pages/ConnectorsPage'
import ProfilePage from './pages/ProfilePage'
import AccountSettingsPage from './pages/AccountSettingsPage'
import SuperAdminPage from '../super-admin/SuperAdminPage'

type AppContext = { session: Session; workspaceId: string }

const HomeNavIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 11.5 12 4l8 7.5" /><path d="M6 10v9.5h5V14h2v5.5h5V10" /></svg>
const AccountsNavIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="6" y="3" width="12" height="18" rx="1" /><path d="M3 21h18" /><path d="M9.5 7.5h1M13.5 7.5h1M9.5 11.5h1M13.5 11.5h1" /><path d="M10.5 21v-4.5a1.5 1.5 0 0 1 1.5-1.5 1.5 1.5 0 0 1 1.5 1.5V21" /></svg>
const PeopleNavIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3.5 20c0-3.6 2.5-6 5.5-6s5.5 2.4 5.5 6" /><circle cx="17" cy="9" r="2.3" /><path d="M15.8 14.3c2.4.5 4.2 2.6 4.2 5.7" /></svg>
const ConnectorsNavIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 2.5v5M15 2.5v5" /><path d="M6 7.5h12V11a6 6 0 0 1-12 0V7.5Z" /><path d="M12 17v4.5" /></svg>
const ProfileNavIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4.5 20c0-4.1 3.4-7 7.5-7s7.5 2.9 7.5 7" /></svg>

const PAGE_TITLES: Array<{ test: (path: string) => boolean; title: string; subtitle: string }> = [
  { test: (path) => path === '/app/ask', title: 'Ask Bohu', subtitle: 'Le cerveau relationnel de ton équipe' },
  { test: (path) => path === '/app/home', title: 'Home', subtitle: 'Ton espace relationnel' },
  { test: (path) => path === '/app/accounts', title: 'Comptes', subtitle: 'Portefeuille de comptes suivi par ton équipe' },
  { test: (path) => path === '/app/people', title: 'Personnes', subtitle: 'Contacts enregistrés' },
  { test: (path) => path.startsWith('/app/people/'), title: 'Fiche Personne', subtitle: 'Cockpit relationnel sourcé' },
  { test: (path) => path === '/app/connectors', title: 'Connecteurs', subtitle: 'Sources connectées et précision du graphe' },
  { test: (path) => path === '/app/profile', title: 'Mon profil', subtitle: 'Ta lecture relationnelle dans Tohu' },
  { test: (path) => path === '/app/account', title: 'Mon compte', subtitle: 'Abonnement, équipe, canaux et facturation' },
]

// Vues portées depuis le shell historique : elles gardent leur conteneur .content
// (largeur/padding d'origine) là où les vues React natives utilisent .ra-content.
const LEGACY_CONTENT_PATHS = new Set(['/app/ask', '/app/home', '/app/connectors', '/app/profile', '/app/account'])

function activeNav(path: string): string {
  if (path === '/app/ask') return 'cerveau'
  if (path === '/app/home') return 'home'
  if (path.startsWith('/app/accounts')) return 'acc'
  if (path.startsWith('/app/people')) return 'per'
  if (path === '/app/connectors') return 'connecteurs'
  if (path === '/app/profile') return 'profil'
  if (path === '/app/account') return 'me'
  return ''
}

function AppShell({ context }: { context: AppContext }) {
  const location = useLocation()
  const navigate = useNavigate()
  const active = activeNav(location.pathname)
  const page = PAGE_TITLES.find((entry) => entry.test(location.pathname)) ?? { title: 'Fiche Compte', subtitle: 'Cockpit relationnel sourcé' }
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('tohu-sidebar-collapsed') === 'true')
  const [counts, setCounts] = useState({ accounts: 0, people: 0 })
  const [footer, setFooter] = useState({ name: displayName(context.session.user), plan: 'Tohu', avatarUrl: null as string | null })
  const [avatarError, setAvatarError] = useState(false)

  useEffect(() => {
    document.body.classList.add('app-page')
    return () => document.body.classList.remove('app-page')
  }, [])

  useEffect(() => {
    const loadFooter = () => void Promise.all([
      listAccounts(),
      listPeople(),
      getProfile(context.session.user.id),
      getSupabase().from('subscriptions').select('plan_id').eq('organization_id', context.workspaceId).maybeSingle(),
    ]).then(([accounts, people, profile, subscription]) => {
      setCounts({ accounts: accounts.length, people: people.length })
      setFooter({
        name: profile.full_name || displayName(context.session.user),
        plan: subscription.data?.plan_id ? `Tohu ${subscription.data.plan_id}` : 'Tohu',
        avatarUrl: profile.avatar_url,
      })
      setAvatarError(false)
    })
    loadFooter()
    window.addEventListener('tohu:profile-updated', loadFooter)
    window.addEventListener('tohu:workspace-updated', loadFooter)
    return () => {
      window.removeEventListener('tohu:profile-updated', loadFooter)
      window.removeEventListener('tohu:workspace-updated', loadFooter)
    }
  }, [context.session.user, context.workspaceId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); navigate('/app/ask') }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navigate])

  const toggleCollapse = () => setCollapsed((value) => {
    const next = !value
    localStorage.setItem('tohu-sidebar-collapsed', String(next))
    return next
  })

  const item = (view: string) => `nav-item${active === view ? ' active' : ''}`

  return <div className="ra-shell">
    <aside className={`sb${collapsed ? ' collapsed' : ''}`} id="sidebar">
      <div className="sb-logo" dangerouslySetInnerHTML={{ __html: tohuLogo() }} />
      <button type="button" className="sb-collapse" aria-label="Réduire la navigation" onClick={toggleCollapse}>‹</button>
      <nav className="sb-nav" aria-label="Navigation principale">
        <Link className={item('cerveau')} to="/app/ask"><span className="nav-ic kbrand">T</span><span className="nav-label">Ask Bohu</span></Link>
        <Link className={item('home')} to="/app/home"><span className="nav-ic">{HomeNavIcon}</span><span className="nav-label">Home</span></Link>
        <Link className={item('acc')} to="/app/accounts"><span className="nav-ic">{AccountsNavIcon}</span><span className="nav-label">Comptes</span><span className="nav-count">{counts.accounts}</span></Link>
        <Link className={item('per')} to="/app/people"><span className="nav-ic">{PeopleNavIcon}</span><span className="nav-label">Personnes</span><span className="nav-count">{counts.people}</span></Link>
        <span className="sb-spacer" /><span className="sb-divider" />
        <Link className={item('connecteurs')} to="/app/connectors"><span className="nav-ic">{ConnectorsNavIcon}</span><span className="nav-label">Connecteurs</span></Link>
        <Link className={item('profil')} to="/app/profile"><span className="nav-ic">{ProfileNavIcon}</span><span className="nav-label">Mon profil</span></Link>
      </nav>
      <Link className={`sb-user ${item('me')}`} to="/app/account">
        <span className="sb-avatar">{footer.avatarUrl && !avatarError ? <img src={footer.avatarUrl} alt="" onError={() => setAvatarError(true)} /> : initials(footer.name)}</span>
        <span className="nav-label"><b>{footer.name}</b><small>{footer.plan}</small></span>
      </Link>
    </aside>
    <div className="app-main">
      <header className="topbar">
        <div><h1 id="page-title">{page.title}</h1><p id="page-subtitle">{page.subtitle}</p></div>
        <GlobalSearch />
      </header>
      <main className={LEGACY_CONTENT_PATHS.has(location.pathname) ? 'content' : 'ra-content'}><Outlet context={context} /></main>
    </div>
  </div>
}

function PlaceholderPage() {
  const navigate = useNavigate()
  return <div className="ra-state"><h1>Vue contextualisée</h1><p>Cette destination conserve le contexte Compte dans l’URL. Son écran complet appartient au lot suivant.</p><button onClick={() => navigate(-1)}>Retour</button></div>
}

async function boot() {
  const session = await requireSession()
  // Une invitation devient un siège actif uniquement au premier accès authentifié.
  try {
    await getSupabase().rpc('accept_my_organization_invitations')
  } catch {
    // Compatibilité pendant le déploiement progressif de la migration.
  }
  const workspaceId = await getOrganizationId()
  const context = { session, workspaceId }
  createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><Routes>
    <Route path="/super-admin" element={<SuperAdminPage />} />
    <Route element={<AppShell context={context} />}>
      <Route index element={<Navigate to="/app/home" replace />} />
      <Route path="/app/home" element={<ToastProvider><HomePage context={context} /></ToastProvider>} />
      <Route path="/app/ask" element={<AskPage />} />
      <Route path="/app/accounts" element={<AccountsListPage context={{ workspaceId: context.workspaceId, userId: context.session.user.id }} />} />
      <Route path="/app/accounts/:accountId" element={<AccountDetailPage context={context} />} />
      <Route path="/app/people" element={<PersonListPage context={{ workspaceId: context.workspaceId, userId: context.session.user.id }} />} />
      <Route path="/app/people/:personId" element={<PersonDetailPage context={{ workspaceId: context.workspaceId, userId: context.session.user.id }} />} />
      <Route path="/app/connectors" element={<ToastProvider><ConnectorsPage context={context} /></ToastProvider>} />
      <Route path="/app/profile" element={<ProfilePage context={context} />} />
      <Route path="/app/account" element={<ToastProvider><AccountSettingsPage context={context} /></ToastProvider>} />
      <Route path="/app/signals" element={<PlaceholderPage />} />
    </Route>
  </Routes></BrowserRouter></StrictMode>)
}

void boot().catch((error) => {
  createRoot(document.getElementById('root')!).render(<div className="ra-state error"><h1>Tohu ne peut pas démarrer</h1><p>{error instanceof Error ? error.message : 'Erreur inattendue'}</p></div>)
})
