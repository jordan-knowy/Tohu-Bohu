import type { Provider, Session } from '@supabase/supabase-js'
import '../styles/fonts.css'
import '../styles/tokens.css'
import '../styles/app.css'
import '../styles/app-fixes.css'
import '../styles/home.css'
import { tohuLogo } from '../components/logo'
import { renderHome } from './home'
import { displayName, initials, requireSession, signOut } from '../lib/auth'
import { absoluteUrl, getSupabase } from '../lib/supabase'
import {
  createAccount,
  createPerson,
  generateStrategicReading,
  getAccountDetail,
  getOrganizationId,
  getResponsibleBehaviorProfile,
  getPersonDetail,
  getProfile,
  globalSearch,
  listAccounts,
  listConnectors,
  listManagedAccounts,
  listPeople,
  saveSignalFeedback,
  setConnector,
  type Account,
  type ConnectorRow,
  type Interaction,
  type Person,
  type ProfileRow,
  type Signal,
} from './data'
import { signalTypeLabel } from './signal-labels'
import { isReadingStale, type StrategicReading } from './strategic-reading'

type ViewId = 'cerveau' | 'home' | 'acc' | 'per' | 'connecteurs' | 'profil' | 'me' | 'detail'
type DetailState = { type: 'account' | 'person'; id: string; back: ViewId }

declare global {
  interface Window { go: (view: ViewId) => void }
}

const titles: Record<Exclude<ViewId, 'detail'>, [string, string]> = {
  cerveau: ['Ask Tohu', 'Le cerveau relationnel de ton équipe'],
  home: ['Home', 'Ton espace relationnel'],
  acc: ['Comptes', 'Entreprises et organisations suivies'],
  per: ['Personnes', 'Contacts et profils relationnels'],
  connecteurs: ['Connecteurs', 'Sources connectées et précision du graphe'],
  profil: ['Mon profil', 'Ta lecture relationnelle dans Tohu'],
  me: ['Mon compte', 'Informations, préférences et abonnement'],
}

const connectorDefinitions = [
  { provider: 'google', label: 'Google Workspace', description: 'Gmail, réunions et calendrier Google.', icon: 'G', auth: 'google' as Provider, scopes: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly' },
  { provider: 'microsoft', label: 'Microsoft 365', description: 'Emails Outlook et calendrier Microsoft.', icon: 'M', auth: 'azure' as Provider, scopes: 'email openid profile offline_access Mail.Read Calendars.Read' },
  { provider: 'linkedin', label: 'LinkedIn', description: 'Identité professionnelle et mouvements de poste.', icon: 'in', auth: 'linkedin_oidc' as Provider, scopes: 'openid profile email' },
]

let session: Session
let profile: ProfileRow
let organizationId = ''
let currentView: ViewId = 'cerveau'
let detailState: DetailState | null = null
let accountCache: Account[] = []
let peopleCache: Person[] = []

function el<T extends HTMLElement = HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector)
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] ?? char)
}

function formatDate(value: string | null | undefined, fallback = 'Jamais'): string {
  if (!value) return fallback
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}

function scoreClass(score: number | null): string {
  if ((score ?? 0) >= 67) return 'high'
  if ((score ?? 0) >= 45) return 'mid'
  return 'low'
}

function statusLabel(status: string): string {
  return ({ active: 'Actif', watch: 'À surveiller', inactive: 'Inactif' } as Record<string, string>)[status] ?? status
}

function toast(message: string, type: 'default' | 'error' = 'default'): void {
  const box = el('#toasts')
  if (!box) return
  const item = document.createElement('div')
  item.className = `toast ${type === 'error' ? 'error' : ''}`
  item.textContent = message
  box.appendChild(item)
  window.setTimeout(() => item.remove(), 3800)
}

function errorMarkup(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Une erreur inattendue est survenue.'
  return `<div class="inline-error">${escapeHtml(message)}</div>`
}

function emptyMarkup(icon: string, title: string, copy: string, action = ''): string {
  return `<div class="empty-state"><span class="empty-ic">${icon}</span><b>${escapeHtml(title)}</b><p>${escapeHtml(copy)}</p>${action}</div>`
}

function setTitle(view: ViewId, detailTitle?: string): void {
  const title = el('#page-title')
  const subtitle = el('#page-subtitle')
  if (view === 'detail') {
    if (title) title.textContent = detailTitle ?? 'Fiche relationnelle'
    if (subtitle) subtitle.textContent = 'Lecture dynamique et données sourcées'
    return
  }
  const copy = titles[view]
  if (title) title.textContent = copy[0]
  if (subtitle) subtitle.textContent = copy[1]
}

async function go(view: ViewId): Promise<void> {
  currentView = view
  document.body.classList.toggle('home-cockpit-active', view === 'home')
  document.querySelectorAll<HTMLElement>('.view').forEach((node) => node.classList.toggle('active', node.id === `view-${view}`))
  document.querySelectorAll<HTMLButtonElement>('.nav-item[data-view]').forEach((node) => node.classList.toggle('active', node.dataset.view === view))
  if (view !== 'detail') setTitle(view)
  window.scrollTo({ top: 0, behavior: 'smooth' })
  const url = new URL(window.location.href)
  if (view !== 'detail') {
    url.searchParams.set('view', view)
    url.searchParams.delete('start')
    history.replaceState(null, '', url)
  }
  try {
    if (view === 'home') await loadHome()
    if (view === 'acc') await loadAccounts()
    if (view === 'per') await loadPeople()
    if (view === 'connecteurs') await loadConnectors()
    if (view === 'profil') await loadOwnProfile()
    if (view === 'me') await loadSettings()
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Impossible de charger cette vue.', 'error')
  }
}

window.go = (view) => { void go(view) }

function entityListMarkup(kind: 'account' | 'person', rows: Array<Account | Person>): string {
  if (!rows.length) {
    const label = kind === 'account' ? 'compte' : 'personne'
    return emptyMarkup(kind === 'account' ? '▦' : '♙', `Aucun ${label}`, `Crée ton premier ${label} pour commencer à construire la mémoire relationnelle.`, `<button class="btn-view" data-create="${kind}">+ Nouveau ${label}</button>`)
  }
  const head = `<div class="list-head"><span>${kind === 'account' ? 'Compte' : 'Personne'}</span><span>${kind === 'account' ? 'Secteur' : 'Organisation'}</span><span>Score</span><span>Statut</span><span>Dernier contact</span></div>`
  const body = rows.map((row) => {
    const isAccount = kind === 'account'
    const name = isAccount ? (row as Account).name : (row as Person).full_name
    const meta = isAccount ? ((row as Account).domain ?? 'Compte suivi') : ((row as Person).job_title ?? (row as Person).email ?? 'Contact suivi')
    const column = isAccount ? ((row as Account).industry ?? 'Non renseigné') : ((row as Person).company_name ?? 'Indépendant')
    return `<button class="entity-row" data-open-${kind}="${row.id}"><span class="entity-name"><span class="entity-avatar">${escapeHtml(initials(name))}</span><span><b>${escapeHtml(name)}</b><span>${escapeHtml(meta)}</span></span></span><span class="entity-meta">${escapeHtml(column)}</span><span class="score ${scoreClass(row.relationship_score)}">${row.relationship_score ?? '—'}</span><span><i class="status-pill ${escapeHtml(row.status)}">${escapeHtml(statusLabel(row.status))}</i></span><span class="entity-meta">${formatDate(row.last_interaction_at)}</span></button>`
  }).join('')
  return head + body
}

async function loadAccounts(): Promise<void> {
  const container = el('#accounts-list')
  if (!container) return
  container.innerHTML = '<div class="loading-state"><span class="spinner"></span></div>'
  try {
    const search = el<HTMLInputElement>('#account-search')?.value ?? ''
    const status = el<HTMLSelectElement>('#account-status')?.value ?? ''
    const sort = el<HTMLSelectElement>('#account-sort')?.value ?? 'updated_at.desc'
    accountCache = await listAccounts(search, status, sort)
    container.innerHTML = entityListMarkup('account', accountCache)
    if (!search && !status) textCount('#accounts-count', accountCache.length)
  } catch (error) {
    container.innerHTML = errorMarkup(error)
  }
}

async function loadPeople(): Promise<void> {
  const container = el('#people-list')
  if (!container) return
  container.innerHTML = '<div class="loading-state"><span class="spinner"></span></div>'
  try {
    const search = el<HTMLInputElement>('#people-search')?.value ?? ''
    const status = el<HTMLSelectElement>('#people-status')?.value ?? ''
    const sort = el<HTMLSelectElement>('#people-sort')?.value ?? 'updated_at.desc'
    peopleCache = await listPeople(search, status, sort)
    container.innerHTML = entityListMarkup('person', peopleCache)
    if (!search && !status) textCount('#people-count', peopleCache.length)
  } catch (error) {
    container.innerHTML = errorMarkup(error)
  }
}

function textCount(selector: string, count: number): void {
  const node = el(selector)
  if (node) node.textContent = String(count)
}

function signalsMarkup(signals: Signal[]): string {
  if (!signals.length) return emptyMarkup('⌁', 'Aucun signal', 'Les signaux apparaîtront ici à mesure que les connecteurs enrichissent la relation.')
  return signals.map((signal) => `<article class="signal"><div class="signal-head"><span class="sig-tag">${escapeHtml(signalTypeLabel(signal.signal_type))}</span><b>${escapeHtml(signal.title)}</b></div>${signal.summary ? `<p>${escapeHtml(signal.summary)}</p>` : ''}<div class="signal-meta">${escapeHtml(signal.source)} · ${formatDate(signal.occurred_at)}${signal.confidence !== null ? ` · confiance ${signal.confidence}%` : ''}</div><div class="signal-actions"><button class="sigfb-b" data-feedback="confirmed" data-signal="${signal.id}">✓ Confirmer</button><button class="sigfb-b" data-feedback="dismissed" data-signal="${signal.id}">✕ Infirmer</button></div></article>`).join('')
}

function interactionsMarkup(interactions: Interaction[]): string {
  if (!interactions.length) return emptyMarkup('◷', 'Aucun historique', 'Les interactions synchronisées apparaîtront ici.')
  return interactions.map((interaction) => `<article class="signal"><div class="signal-head"><span class="sig-tag">${escapeHtml(interaction.interaction_type)}</span><b>${escapeHtml(interaction.title)}</b></div>${interaction.summary ? `<p>${escapeHtml(interaction.summary)}</p>` : ''}<div class="signal-meta">${escapeHtml(interaction.source ?? 'Source manuelle')} · ${formatDate(interaction.occurred_at)}</div></article>`).join('')
}

function panelMarkup(icon: string, title: string, subtitle: string, body: string): string {
  return `<section class="panel"><header class="panel-head"><span class="panel-ic">${icon}</span><span><span class="panel-title">${escapeHtml(title)}</span><span class="panel-sub">${escapeHtml(subtitle)}</span></span></header><div class="panel-body">${body}</div></section>`
}

/**
 * Panneau « Lecture stratégique » — trois états réels :
 *  1. lecture persistée → synthèse + forces/risques/actions, fraîcheur, confiance, sources ;
 *  2. pas de lecture mais au moins un contact → génération à la demande (serveur revalide) ;
 *  3. pas assez de matière → « Lecture en construction » + CTA connecteurs.
 */
function strategicReadingBody(reading: StrategicReading | null, hasContacts: boolean, insufficient: string[] | null = null): string {
  if (reading) {
    const list = (items: string[], tone: string): string => items.length ? `<ul class="sread-list ${tone}">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''
    const counts = reading.sourceCounts
    const sources = [
      counts.contacts ? `${counts.contacts} contact${counts.contacts > 1 ? 's' : ''}` : null,
      counts.signals ? `${counts.signals} signal${counts.signals > 1 ? 'aux' : ''}` : null,
      counts.interactions ? `${counts.interactions} réunion${counts.interactions > 1 ? 's' : ''}` : null,
      counts.messages ? `${counts.messages} échange${counts.messages > 1 ? 's' : ''}` : null,
    ].filter(Boolean).join(', ')
    const stale = isReadingStale(reading.generatedAt, new Date())
    return `<p class="sread-synthese">${escapeHtml(reading.synthese)}</p>
      ${reading.forces.length ? `<div class="sread-h ok">Points d'appui</div>${list(reading.forces, 'ok')}` : ''}
      ${reading.risques.length ? `<div class="sread-h no">Points de vigilance</div>${list(reading.risques, 'no')}` : ''}
      ${reading.prochainesActions.length ? `<div class="sread-h next">Prochaines actions</div>${list(reading.prochainesActions, 'next')}` : ''}
      <div class="sread-meta">Générée le ${formatDate(reading.generatedAt)}${reading.confidence !== null ? ` · confiance ${reading.confidence}%` : ''}${sources ? ` · à partir de ${escapeHtml(sources)}` : ''}${stale ? ' · <b>à actualiser</b>' : ''}</div>
      <div class="sread-actions"><button class="btn-secondary sread-btn" data-strategic-generate>↻ Actualiser la lecture</button></div>
      <p class="error-text" data-strategic-error></p>`
  }
  if (hasContacts && !insufficient) {
    return `<div class="empty-state"><span class="empty-ic">✦</span><b>Aucune lecture générée</b><p>Tohu peut synthétiser l’état de la relation à partir des contacts, signaux, réunions et échanges de ce compte.</p><button class="btn-view" data-strategic-generate>✦ Générer la lecture stratégique</button><p class="error-text" data-strategic-error></p></div>`
  }
  const missing = insufficient?.length ? `<div class="sread-missing">${insufficient.map((item) => `<span>· ${escapeHtml(item)}</span>`).join('')}</div>` : ''
  return `<div class="empty-state"><span class="empty-ic">✦</span><b>Lecture en construction</b><p>Ajoute des interactions et connecte tes sources pour enrichir cette synthèse.</p>${missing}<button class="btn-secondary" data-strategic-connectors>Connecter une source</button></div>`
}

function bindStrategicPanel(container: HTMLElement, accountId: string, hasContacts: boolean): void {
  container.querySelector('[data-strategic-connectors]')?.addEventListener('click', () => void go('connecteurs'))
  const button = container.querySelector<HTMLButtonElement>('[data-strategic-generate]')
  if (!button) return
  button.addEventListener('click', () => {
    button.disabled = true
    const label = button.innerHTML
    button.innerHTML = '<span class="spinner"></span> Génération en cours…'
    void generateStrategicReading(accountId).then(({ reading, insufficient }) => {
      const body = container.querySelector('#strategic-body')
      if (!body) return
      body.innerHTML = strategicReadingBody(reading, hasContacts, insufficient)
      bindStrategicPanel(container, accountId, hasContacts)
      if (reading) toast('Lecture stratégique mise à jour.')
      else toast('Pas encore assez de matière pour une synthèse fiable.', 'error')
    }).catch((error) => {
      button.disabled = false
      button.innerHTML = label
      const errorBox = container.querySelector('[data-strategic-error]')
      if (errorBox) errorBox.textContent = error instanceof Error ? error.message : 'Génération impossible.'
    })
  })
}

async function openAccount(id: string, back: ViewId = currentView): Promise<void> {
  void back
  window.location.assign(`/app/accounts/${encodeURIComponent(id)}`)
  return
  /*
  detailState = { type: 'account', id, back: back === 'detail' ? 'acc' : back }
  const container = el('#detail-content')
  if (!container) return
  await go('detail')
  container.innerHTML = '<div class="loading-state"><span class="spinner"></span></div>'
  try {
    const { account, people, signals, interactions, reading } = await getAccountDetail(id)
    setTitle('detail', account.name)
    const contacts = people.length ? people.map((person) => `<button class="linked-row" data-open-person="${person.id}"><span class="entity-avatar">${escapeHtml(initials(person.full_name))}</span><span><b>${escapeHtml(person.full_name)}</b><small>${escapeHtml(person.job_title ?? person.email ?? 'Contact')}</small></span><span>→</span></button>`).join('') : emptyMarkup('♙', 'Aucun contact lié', 'Associe une personne à ce compte depuis la base.')
    const hasContacts = people.length > 0
    const strategicPanel = panelMarkup('✦', 'Lecture stratégique', 'Synthèse relationnelle du compte', `<div id="strategic-body">${strategicReadingBody(reading, hasContacts)}</div>${account.notes ? `<p class="sread-note"><b>Note interne :</b> ${escapeHtml(account.notes)}</p>` : ''}`)
    container.innerHTML = `<section class="detail-hero"><div class="detail-avatar">${escapeHtml(initials(account.name))}</div><div class="detail-identity"><h2>${escapeHtml(account.name)}</h2><p>${escapeHtml([account.industry, account.location, account.domain].filter(Boolean).join(' · ') || 'Compte suivi')}</p><div class="detail-tags"><span class="status-pill">${escapeHtml(statusLabel(account.status))}</span><span class="status-pill">Confiance ${account.confidence_score ?? '—'}%</span></div></div><div class="detail-score"><b>${account.relationship_score ?? '—'}</b><span>Score relationnel</span></div></section><div class="detail-grid"><div class="detail-column">${strategicPanel}${panelMarkup('⌁', 'Signaux', `${signals.length} signal${signals.length > 1 ? 'aux' : ''} détecté${signals.length > 1 ? 's' : ''}`, signalsMarkup(signals))}</div><div class="detail-column">${panelMarkup('▦', 'Repères', 'Données structurées', `<div class="detail-facts"><div class="fact"><span>Statut</span><b>${escapeHtml(statusLabel(account.status))}</b></div><div class="fact"><span>Confiance</span><b>${account.confidence_score ?? '—'}%</b></div><div class="fact"><span>Dernier contact</span><b>${formatDate(account.last_interaction_at)}</b></div><div class="fact"><span>Domaine</span><b>${escapeHtml(account.domain ?? '—')}</b></div></div>`)}${panelMarkup('♙', 'Contacts liés', `${people.length} personne${people.length > 1 ? 's' : ''}`, contacts)}${panelMarkup('◷', 'Preuves & historique', 'Interactions qui soutiennent cette lecture', interactionsMarkup(interactions))}</div></div>`
    bindStrategicPanel(container, id, hasContacts)
  } catch (error) {
    container.innerHTML = errorMarkup(error)
  }
  */
}

async function openPerson(id: string, _back: ViewId = currentView): Promise<void> {
  // La fiche Personne fonctionnelle vit dans le shell React (/app/people/:personId).
  window.location.href = `/app/people/${id}`
}

function openAskSimulation(prompt: string): void {
  void go('cerveau').then(() => {
    const input = el<HTMLTextAreaElement>('#ask-input')
    if (!input) return
    input.value = prompt
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  })
}

async function loadHome(): Promise<void> {
  const container = el('#home-content')
  if (!container) return
  await renderHome({
    container,
    session,
    profile,
    organizationId,
    toast,
    goView: (view) => { void go(view) },
    askSimulation: openAskSimulation,
    onCounts: (accounts, people) => { textCount('#accounts-count', accounts); textCount('#people-count', people) },
  })
}

function identityProvider(connector: string): string {
  return connector === 'google' ? 'google' : connector === 'microsoft' ? 'azure' : 'linkedin_oidc'
}

async function syncEmailProvider(provider: string): Promise<void> {
  if (provider !== 'google' && provider !== 'microsoft') return
  toast(`Synchronisation ${provider === 'google' ? 'Google Workspace' : 'Microsoft 365'} lancée…`)
  const { data, error } = await getSupabase().functions.invoke('sync-email-analysis', { body: { organizationId, provider } })
  if (error || data?.error) throw error ?? new Error(data.error)
  await loadConnectors()
  if (currentView === 'profil') await loadOwnProfile()
  if (currentView === 'per') await loadPeople()
  toast(`${data.messages ?? 0} emails synchronisés · ${data.peopleAnalyzed ?? 0} profil(s) personne mis à jour.`)
}

async function persistEmailProvider(provider: string): Promise<void> {
  if (provider !== 'google' && provider !== 'microsoft') {
    await setConnector(session.user.id, provider, 'connected')
    return
  }
  const { data: sessionData } = await getSupabase().auth.getSession()
  session = sessionData.session ?? session
  if (!session.provider_token) throw new Error('Jeton fournisseur absent. Reconnecte ce compte pour autoriser la lecture des emails.')
  const definition = connectorDefinitions.find((item) => item.provider === provider)
  const { data, error } = await getSupabase().functions.invoke('connect-email-provider', {
    body: {
      organizationId,
      provider,
      accessToken: session.provider_token,
      refreshToken: session.provider_refresh_token ?? null,
      expiresIn: 3600,
      scopes: definition?.scopes.split(' ') ?? [],
    },
  })
  if (error || data?.error) throw error ?? new Error(data.error)
}

async function reconcileConnectorReturn(): Promise<void> {
  const params = new URLSearchParams(window.location.search)
  const connector = params.get('connector')
  if (!connector) return
  const identity = (session.user.identities ?? []).some((item) => item.provider === identityProvider(connector))
  if (identity) {
    await persistEmailProvider(connector)
    toast(`${connectorDefinitions.find((item) => item.provider === connector)?.label ?? 'Source'} connecté.`)
    if (connector === 'google' || connector === 'microsoft') {
      void syncEmailProvider(connector).catch((error) => toast(error instanceof Error ? error.message : 'Synchronisation impossible.', 'error'))
    }
  }
  params.delete('connector')
  params.set('view', 'connecteurs')
  history.replaceState(null, '', `${window.location.pathname}?${params}`)
}

async function loadConnectors(): Promise<void> {
  const container = el('#connectors-content')
  if (!container) return
  container.innerHTML = '<div class="loading-state"><span class="spinner"></span></div>'
  try {
    const rows = await listConnectors()
    const states = new Map(rows.map((row) => [row.provider, row]))
    const connected = connectorDefinitions.filter((definition) => states.get(definition.provider)?.status === 'connected').length
    const cards = connectorDefinitions.map((definition) => {
      const row = states.get(definition.provider)
      const isConnected = row?.status === 'connected'
      const status = isConnected ? `● Connecté${row?.last_synced_at ? ` · synchro ${formatDate(row.last_synced_at)}` : ''}` : row?.status === 'error' ? '● Erreur de connexion' : '○ Non connecté'
      const syncButton = isConnected && definition.provider !== 'linkedin' ? `<button class="btn-secondary" data-connector="${definition.provider}" data-action="sync">Synchroniser</button>` : ''
      return `<article class="connector-card panel"><span class="connector-icon">${definition.icon}</span><div><h3>${definition.label}</h3><p>${definition.description}</p><span class="connector-status ${isConnected ? '' : 'off'}">${status}</span>${row?.last_error ? `<p class="error-text">${escapeHtml(row.last_error)}</p>` : ''}</div><div class="connector-actions">${syncButton}<button class="${isConnected ? 'btn-danger' : 'btn-secondary'}" data-connector="${definition.provider}" data-action="${isConnected ? 'disconnect' : 'connect'}">${isConnected ? 'Déconnecter' : 'Connecter'}</button></div></article>`
    }).join('')
    container.innerHTML = `<section class="connector-summary"><div class="connector-ring" style="--progress:${connected / connectorDefinitions.length * 100}%"><b>${connected}/${connectorDefinitions.length}</b></div><div><h2>Activation de ton OS relationnel</h2><p>Chaque source améliore la couverture et la fraîcheur de la mémoire d’équipe.</p></div></section><div class="connector-list">${cards}</div>`
  } catch (error) {
    container.innerHTML = errorMarkup(error)
  }
}

async function connectProvider(provider: string): Promise<void> {
  const definition = connectorDefinitions.find((item) => item.provider === provider)
  if (!definition) return
  const alreadyLinked = (session.user.identities ?? []).some((identity) => identity.provider === identityProvider(provider))
  await setConnector(session.user.id, provider, 'not_connected')
  const options = {
    redirectTo: absoluteUrl(`/tohu-app.html?start=connecteurs&connector=${encodeURIComponent(provider)}`),
    scopes: definition.scopes,
    queryParams: provider === 'google' ? { access_type: 'offline', prompt: 'consent' } : undefined,
  }
  const { error } = alreadyLinked
    ? await getSupabase().auth.signInWithOAuth({ provider: definition.auth, options })
    : await getSupabase().auth.linkIdentity({ provider: definition.auth, options })
  if (error) {
    await setConnector(session.user.id, provider, 'error')
    throw error
  }
}

async function disconnectProvider(provider: string): Promise<void> {
  if (provider === 'google' || provider === 'microsoft') {
    const { data, error } = await getSupabase().functions.invoke('connect-email-provider', { body: { organizationId, provider, action: 'disconnect' } })
    if (error || data?.error) throw error ?? new Error(data.error)
  } else {
    await setConnector(session.user.id, provider, 'disconnected')
  }
  await loadConnectors()
  toast('Connexion retirée de Tohu. Une révocation peut aussi être nécessaire chez le fournisseur.')
}

async function loadOwnProfile(): Promise<void> {
  const container = el('#profile-content')
  if (!container) return
  container.innerHTML = '<div class="loading-state"><span class="spinner"></span></div>'
  try {
    const [behavior, accounts] = await Promise.all([
      getResponsibleBehaviorProfile(session.user.id, organizationId),
      listManagedAccounts(session.user.id),
    ])
    const avatar = profile.avatar_url
      ? `<div class="profile-avatar"><img src="${escapeHtml(profile.avatar_url)}" alt="Photo de ${escapeHtml(profile.full_name)}" /></div>`
      : `<div class="profile-avatar">${escapeHtml(initials(profile.full_name))}</div>`
    const identity = `<div class="detail-facts"><div class="fact"><span>Email</span><b>${escapeHtml(session.user.email ?? '—')}</b></div><div class="fact"><span>Rôle</span><b>${escapeHtml(profile.role_title ?? '—')}</b></div><div class="fact"><span>Organisation</span><b>${escapeHtml(profile.company_name ?? '—')}</b></div><div class="fact"><span>Site web</span><b>${escapeHtml(profile.website_url ?? '—')}</b></div></div>`
    const traits = behavior?.behavioral_analysis_data?.length ? behavior.behavioral_analysis_data.map((item) => `<div class="signal"><div class="signal-head"><b>${escapeHtml(item.trait ?? 'Signal comportemental')}</b><span class="sig-tag">${item.confidence ?? '—'}%</span></div><p>${escapeHtml(item.observation ?? '')}</p></div>`).join('') : emptyMarkup('◎', 'Lecture en construction', 'Connecte Gmail ou Outlook puis lance une synchronisation pour générer cette analyse.')
    const evidence = behavior ? `<div class="detail-facts"><div class="fact"><span>Emails analysés</span><b>${behavior.source_message_count}</b></div><div class="fact"><span>Sources</span><b>${escapeHtml(behavior.updated_from.join(', '))}</b></div><div class="fact"><span>Mode dominant</span><b>${escapeHtml(behavior.cognitive_mode ?? '—')}</b></div><div class="fact"><span>Dernière analyse</span><b>${formatDate(behavior.updated_at)}</b></div></div>` : emptyMarkup('◷', 'Aucune preuve disponible', 'Les preuves agrégées apparaîtront après la première synchronisation.')
    container.innerHTML = `<section class="profile-hero">${avatar}<div><h2>${escapeHtml(profile.full_name)}</h2><p>${escapeHtml([profile.role_title, profile.company_name, session.user.email].filter(Boolean).join(' · ') || 'Responsable de compte')}</p></div><div class="profile-score"><b>${behavior?.global_confidence ?? '—'}</b><span>Confiance du profil</span></div></section><div class="detail-grid"><div class="detail-column">${panelMarkup('◎', 'Profil utilisateur', 'Informations du responsable connecté', identity)}${panelMarkup('◎', 'Profil comportemental', 'Analyse du responsable à partir de ses emails envoyés', behavior?.executive_summary ? `<p>${escapeHtml(behavior.executive_summary)}</p>` : emptyMarkup('◎', 'Lecture en construction', 'Connecte Gmail ou Outlook puis synchronise les emails.'))}${panelMarkup('⌁', 'Signaux personnels', `${behavior?.behavioral_analysis_data?.length ?? 0} signal(s)`, traits)}</div><div class="detail-column">${panelMarkup('▦', 'Comptes suivis', `${accounts.length} compte${accounts.length > 1 ? 's' : ''} sous responsabilité`, accounts.length ? accounts.map((account) => `<button class="linked-row" data-open-account="${account.id}"><span class="entity-avatar">${escapeHtml(initials(account.name))}</span><span><b>${escapeHtml(account.name)}</b><small>${escapeHtml(account.industry ?? 'Compte')}</small></span><span>→</span></button>`).join('') : emptyMarkup('▦', 'Aucun compte attribué', 'Les comptes des contacts dont tu es responsable apparaîtront ici.'))}${panelMarkup('◷', 'Preuves agrégées', 'Aucun corps d’email n’est conservé', evidence)}</div></div>`
  } catch (error) {
    container.innerHTML = errorMarkup(error)
  }
}

async function loadSettings(): Promise<void> {
  const container = el('#settings-content')
  if (!container) return
  container.innerHTML = '<div class="loading-state"><span class="spinner"></span></div>'
  try {
    const client = getSupabase()
    const [preferencesResult, subscriptionResult] = await Promise.all([
      client.from('notification_preferences').select('*').eq('user_id', session.user.id).eq('organization_id', organizationId).maybeSingle(),
      client.from('subscriptions').select('*').eq('organization_id', organizationId).maybeSingle(),
    ])
    if (preferencesResult.error) throw preferencesResult.error
    if (subscriptionResult.error) throw subscriptionResult.error
    const preferences = preferencesResult.data ?? { email_enabled: true, push_enabled: true, daily_digest_enabled: true }
    const plan = subscriptionResult.data?.plan_id ?? 'free'
    const subscriptionStatus = subscriptionResult.data?.status ?? 'active'
    container.innerHTML = `<div class="settings-grid"><section class="panel"><header class="panel-head"><span class="panel-ic">◎</span><span><span class="panel-title">Informations du compte</span><span class="panel-sub">Modifiables et persistées dans Supabase</span></span></header><form class="panel-body settings-form" id="profile-settings-form"><div class="field"><label for="settings-name">Nom complet</label><input class="input" id="settings-name" name="full_name" value="${escapeHtml(profile.full_name)}" required /></div><div class="field"><label for="settings-email">Email</label><input class="input" id="settings-email" value="${escapeHtml(session.user.email ?? '')}" disabled /></div><div class="field"><label for="settings-avatar">URL de l’avatar</label><input class="input" id="settings-avatar" name="avatar_url" value="${escapeHtml(profile.avatar_url ?? '')}" placeholder="https://…" /></div><button class="btn-view" type="submit">Enregistrer</button></form></section><section class="panel"><header class="panel-head"><span class="panel-ic">⌁</span><span><span class="panel-title">Notifications</span><span class="panel-sub">Choisis les alertes utiles</span></span></header><div class="panel-body" id="preferences"><div class="switch-row"><span><b>Notifications email</b><small>Alertes importantes</small></span><button class="switch ${preferences.email_enabled ? 'on' : ''}" data-pref="email_enabled"><i></i></button></div><div class="switch-row"><span><b>Notifications push</b><small>Nouveaux signaux importants</small></span><button class="switch ${preferences.push_enabled ? 'on' : ''}" data-pref="push_enabled"><i></i></button></div><div class="switch-row"><span><b>Digest quotidien</b><small>Résumé à l’heure configurée</small></span><button class="switch ${preferences.daily_digest_enabled ? 'on' : ''}" data-pref="daily_digest_enabled"><i></i></button></div></div></section><section class="panel plan-card"><header class="panel-head"><span><span class="panel-title">Abonnement</span><span class="panel-sub">Plan de l’organisation</span></span></header><div class="panel-body"><div class="plan-name">Tohu ${escapeHtml(plan)}</div><p class="plan-copy">Statut : ${escapeHtml(subscriptionStatus)}. La facturation n’est pas encore gérée depuis cette interface.</p></div></section><section class="panel"><header class="panel-head"><span><span class="panel-title">Session</span><span class="panel-sub">Sécurité de ton compte</span></span></header><div class="panel-body"><button class="btn-secondary" id="signout">Se déconnecter</button></div></section><section class="panel danger-zone wide"><header class="panel-head"><span><span class="panel-title">Zone sensible</span><span class="panel-sub">Actions irréversibles</span></span></header><div class="panel-body"><p>La suppression complète nécessite une fonction serveur qui efface Auth et toutes les données associées.</p><button class="btn-danger" disabled title="À brancher sur une Edge Function administrateur">Supprimer mon compte — bientôt disponible</button></div></section></div>`
  } catch (error) {
    container.innerHTML = errorMarkup(error)
  }
}

async function saveProfileSettings(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form)
  const values = { full_name: String(data.get('full_name') ?? '').trim(), avatar_url: String(data.get('avatar_url') ?? '').trim() || null }
  const { data: saved, error } = await getSupabase().from('profiles').update(values).eq('id', session.user.id).select().single()
  if (error) throw error
  profile = { ...profile, ...saved, email: null, role: saved.role_title ?? profile.role, role_title: saved.role_title ?? profile.role_title }
  el('#sb-name')!.textContent = profile.full_name
  el('#sb-avatar')!.textContent = initials(profile.full_name)
  toast('Informations enregistrées.')
}

async function togglePreference(button: HTMLButtonElement): Promise<void> {
  const key = button.dataset.pref
  if (!key) return
  const enabled = !button.classList.contains('on')
  const { error } = await getSupabase().from('notification_preferences').update({ [key]: enabled }).eq('organization_id', organizationId).eq('user_id', session.user.id)
  if (error) throw error
  button.classList.toggle('on', enabled)
  toast('Préférence enregistrée.')
}

function openCreateModal(kind: 'account' | 'person'): void {
  const modal = el('#modal')
  const title = el('#modal-title')
  const subtitle = el('#modal-subtitle')
  const form = el<HTMLFormElement>('#modal-form')
  if (!modal || !title || !subtitle || !form) return
  title.textContent = kind === 'account' ? 'Nouveau compte' : 'Nouvelle personne'
  subtitle.textContent = 'Les informations seront enregistrées dans Supabase.'
  form.dataset.kind = kind
  form.innerHTML = kind === 'account'
    ? `<div class="field"><label for="create-name">Nom du compte</label><input class="input" id="create-name" name="name" required /></div><div class="field"><label for="create-domain">Domaine</label><input class="input" id="create-domain" name="domain" placeholder="entreprise.fr" /></div><div class="field"><label for="create-industry">Secteur</label><input class="input" id="create-industry" name="industry" /></div><div class="field"><label for="create-location">Localisation</label><input class="input" id="create-location" name="location" /></div><div class="field"><label for="create-status">Statut</label><select class="select" id="create-status" name="status"><option value="active">Actif</option><option value="watch">À surveiller</option><option value="inactive">Inactif</option></select></div><div class="field"><label for="create-notes">Notes</label><textarea class="textarea" id="create-notes" name="notes"></textarea></div><p class="error-text" id="modal-error"></p><div class="modal-actions"><button type="button" class="btn-secondary" data-close-modal>Annuler</button><button class="btn-view" type="submit">Créer le compte</button></div>`
    : `<div class="field"><label for="create-name">Nom complet</label><input class="input" id="create-name" name="full_name" required /></div><div class="field"><label for="create-email">Email</label><input class="input" type="email" id="create-email" name="email" /></div><div class="field"><label for="create-job">Fonction</label><input class="input" id="create-job" name="job_title" /></div><div class="field"><label for="create-company">Organisation</label><input class="input" id="create-company" name="company_name" /></div><div class="field"><label for="create-status">Statut</label><select class="select" id="create-status" name="status"><option value="active">Actif</option><option value="watch">À surveiller</option><option value="inactive">Inactif</option></select></div><div class="field"><label for="create-notes">Notes</label><textarea class="textarea" id="create-notes" name="notes"></textarea></div><p class="error-text" id="modal-error"></p><div class="modal-actions"><button type="button" class="btn-secondary" data-close-modal>Annuler</button><button class="btn-view" type="submit">Créer la personne</button></div>`
  modal.hidden = false
  form.querySelector<HTMLInputElement>('input')?.focus()
}

function closeModal(): void {
  const modal = el('#modal')
  if (modal) modal.hidden = true
}

async function submitCreateForm(form: HTMLFormElement): Promise<void> {
  const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')
  if (submit) { submit.disabled = true; submit.innerHTML = '<span class="spinner"></span> Enregistrement…' }
  try {
    if (form.dataset.kind === 'account') {
      const account = await createAccount({ name: data.name?.trim() ?? '', domain: data.domain?.trim() || null, industry: data.industry?.trim() || null, location: data.location?.trim() || null, status: (data.status || 'active') as Account['status'], notes: data.notes?.trim() || null })
      closeModal()
      await loadAccounts()
      toast('Compte créé.')
      await openAccount(account.id, 'acc')
    } else {
      const person = await createPerson({ full_name: data.full_name?.trim() ?? '', email: data.email?.trim() || null, job_title: data.job_title?.trim() || null, company_name: data.company_name?.trim() || null, status: (data.status || 'active') as Person['status'], notes: data.notes?.trim() || null })
      closeModal()
      await loadPeople()
      toast('Personne créée.')
      await openPerson(person.id, 'per')
    }
  } catch (error) {
    const errorBox = el('#modal-error')
    if (errorBox) errorBox.textContent = error instanceof Error ? error.message : 'Impossible d’enregistrer.'
  } finally {
    if (submit) { submit.disabled = false; submit.textContent = form.dataset.kind === 'account' ? 'Créer le compte' : 'Créer la personne' }
  }
}

async function askTohu(message: string): Promise<void> {
  const thread = el('#ask-thread')
  const suggestions = el('#ask-suggestions')
  if (!thread) return
  suggestions?.setAttribute('hidden', '')
  thread.insertAdjacentHTML('beforeend', `<div class="message user">${escapeHtml(message)}</div><div class="message assistant pending"><span class="spinner"></span></div>`)
  const pending = thread.querySelector<HTMLElement>('.pending:last-child')
  thread.scrollTop = thread.scrollHeight
  try {
    const history = [...thread.querySelectorAll<HTMLElement>('.message:not(.pending)')].slice(-8).map((node) => ({ role: node.classList.contains('user') ? 'user' : 'assistant', content: node.textContent ?? '' }))
    const { data, error } = await getSupabase().functions.invoke('ask-tohu-proxy', { body: { message, history } })
    if (error) throw error
    const answer = String(data?.answer ?? 'Je n’ai pas pu produire de réponse à partir des données disponibles.')
    if (pending) { pending.classList.remove('pending'); pending.textContent = answer }
  } catch (error) {
    if (pending) { pending.classList.remove('pending'); pending.textContent = error instanceof Error ? `Impossible de répondre : ${error.message}` : 'Impossible de répondre pour le moment.' }
  }
  thread.scrollTop = thread.scrollHeight
}

function debounce<T extends (...args: never[]) => void>(fn: T, wait: number): (...args: Parameters<T>) => void {
  let timer = 0
  return (...args: Parameters<T>) => { window.clearTimeout(timer); timer = window.setTimeout(() => fn(...args), wait) }
}

const debouncedAccounts = debounce(() => { void loadAccounts() }, 260)
const debouncedPeople = debounce(() => { void loadPeople() }, 260)
const debouncedGlobalSearch = debounce(async () => {
  const input = el<HTMLInputElement>('#global-search')
  const results = el('#search-results')
  if (!input || !results) return
  try {
    const rows = await globalSearch(input.value)
    if (!rows.length) { results.hidden = true; results.innerHTML = ''; return }
    results.innerHTML = rows.map((row) => `<button class="search-result" data-open-${row.type}="${row.id}"><b>${escapeHtml(row.name)}</b><span>${escapeHtml(row.meta)}</span></button>`).join('')
    results.hidden = false
  } catch {
    results.hidden = true
  }
}, 220)

function bindEvents(): void {
  document.querySelectorAll<HTMLButtonElement>('.nav-item[data-view]').forEach((button) => button.addEventListener('click', () => void go(button.dataset.view as ViewId)))
  el('#collapse')?.addEventListener('click', () => {
    el('#sidebar')?.classList.toggle('collapsed')
    localStorage.setItem('tohu-sidebar-collapsed', String(el('#sidebar')?.classList.contains('collapsed')))
  })
  el('#account-search')?.addEventListener('input', debouncedAccounts)
  el('#account-status')?.addEventListener('change', () => void loadAccounts())
  el('#account-sort')?.addEventListener('change', () => void loadAccounts())
  el('#people-search')?.addEventListener('input', debouncedPeople)
  el('#people-status')?.addEventListener('change', () => void loadPeople())
  el('#people-sort')?.addEventListener('change', () => void loadPeople())
  el('#global-search')?.addEventListener('input', debouncedGlobalSearch)
  el('#detail-back')?.addEventListener('click', () => void go(detailState?.back ?? 'home'))
  el('#modal-close')?.addEventListener('click', closeModal)
  el('#modal')?.addEventListener('click', (event) => { if (event.target === el('#modal')) closeModal() })
  el<HTMLFormElement>('#modal-form')?.addEventListener('submit', (event) => { event.preventDefault(); void submitCreateForm(event.currentTarget as HTMLFormElement) })
  el<HTMLFormElement>('#ask-form')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const input = el<HTMLTextAreaElement>('#ask-input')
    const message = input?.value.trim() ?? ''
    if (!message) return
    if (input) input.value = ''
    void askTohu(message)
  })
  el('#ask-suggestions')?.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button')
    if (!button) return
    void askTohu(button.textContent?.trim() ?? '')
  })
  document.addEventListener('click', (event) => {
    const target = event.target as Element
    const account = target.closest<HTMLElement>('[data-open-account]')
    const person = target.closest<HTMLElement>('[data-open-person]')
    const create = target.closest<HTMLElement>('[data-create]')
    const close = target.closest<HTMLElement>('[data-close-modal]')
    const connector = target.closest<HTMLButtonElement>('[data-connector]')
    const feedback = target.closest<HTMLButtonElement>('[data-feedback]')
    const preference = target.closest<HTMLButtonElement>('[data-pref]')
    if (account?.dataset.openAccount) { el('#search-results')!.hidden = true; void openAccount(account.dataset.openAccount) }
    if (person?.dataset.openPerson) { el('#search-results')!.hidden = true; void openPerson(person.dataset.openPerson) }
    if (create?.dataset.create === 'account' || create?.dataset.create === 'person') openCreateModal(create.dataset.create)
    if (close) closeModal()
    if (connector?.dataset.connector) {
      const task = connector.dataset.action === 'disconnect'
        ? disconnectProvider(connector.dataset.connector)
        : connector.dataset.action === 'sync'
          ? syncEmailProvider(connector.dataset.connector)
          : connectProvider(connector.dataset.connector)
      void task.catch((error) => toast(error instanceof Error ? error.message : 'Action impossible.', 'error'))
    }
    if (feedback?.dataset.signal && feedback.dataset.feedback) {
      void saveSignalFeedback(feedback.dataset.signal, session.user.id, feedback.dataset.feedback as 'confirmed' | 'dismissed').then(() => {
        feedback.parentElement?.querySelectorAll('.sigfb-b').forEach((button) => button.classList.remove('active'))
        feedback.classList.add('active')
        toast('Merci, ton retour améliore la mémoire relationnelle.')
      }).catch((error) => toast(error instanceof Error ? error.message : 'Feedback non enregistré.', 'error'))
    }
    if (preference) void togglePreference(preference).catch((error) => toast(error instanceof Error ? error.message : 'Préférence non enregistrée.', 'error'))
  })
  document.addEventListener('submit', (event) => {
    if ((event.target as HTMLElement).id !== 'profile-settings-form') return
    event.preventDefault()
    void saveProfileSettings(event.target as HTMLFormElement).catch((error) => toast(error instanceof Error ? error.message : 'Impossible d’enregistrer.', 'error'))
  })
  document.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).id === 'signout') void signOut()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { closeModal(); const results = el('#search-results'); if (results) results.hidden = true }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); void go('cerveau'); el<HTMLTextAreaElement>('#ask-input')?.focus() }
  })
}

async function boot(): Promise<void> {
  el('#boot-logo')!.innerHTML = tohuLogo()
  session = await requireSession()
  profile = await getProfile(session.user.id)
  if (!profile.onboarding_completed) {
    window.location.replace('/onboarding.html')
    return
  }
  organizationId = await getOrganizationId()
  const { data: subscription } = await getSupabase().from('subscriptions').select('plan_id').eq('organization_id', organizationId).maybeSingle()
  el('#brand')!.innerHTML = tohuLogo()
  el('#sb-name')!.textContent = profile.full_name || displayName(session.user)
  el('#sb-avatar')!.textContent = initials(profile.full_name || displayName(session.user))
  el('#sb-plan')!.textContent = subscription?.plan_id ? `Tohu ${subscription.plan_id}` : 'Tohu'
  if (localStorage.getItem('tohu-sidebar-collapsed') === 'true') el('#sidebar')?.classList.add('collapsed')
  bindEvents()
  await reconcileConnectorReturn()
  el('#boot-screen')?.remove()
  const shell = el('#app-shell')
  if (shell) shell.hidden = false
  document.body.classList.remove('app-loading')
  const params = new URLSearchParams(window.location.search)
  const requested = (params.get('start') ?? params.get('view') ?? 'home') as ViewId
  const view: ViewId = ['cerveau', 'home', 'acc', 'per', 'connecteurs', 'profil', 'me'].includes(requested) ? requested : 'home'
  await go(view)
  if (params.get('mode') === 'simulation') openAskSimulation('Mode simulation — je veux préparer un échange. Situation : ')
  void Promise.all([listAccounts(), listPeople()]).then(([accounts, people]) => {
    accountCache = accounts; peopleCache = people; textCount('#accounts-count', accounts.length); textCount('#people-count', people.length)
  })
}

boot().catch((error) => {
  const screen = el('#boot-screen')
  if (screen) screen.innerHTML = `<div id="boot-logo"></div>${errorMarkup(error)}<a class="btn-secondary" href="/login.html">Retour à la connexion</a>`
  const logo = el('#boot-logo')
  if (logo) logo.innerHTML = tohuLogo()
})
