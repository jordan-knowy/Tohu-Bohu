import type { Provider, Session } from '@supabase/supabase-js'
import '../styles/fonts.css'
import '../styles/tokens.css'
import '../styles/public.css'
import { tohuLogo } from '../components/logo'
import { displayName, initials, requireSession, signOut } from '../lib/auth'
import { absoluteUrl, getSupabase } from '../lib/supabase'

type Connector = { provider: Provider; databaseProvider: 'google' | 'microsoft' | 'linkedin'; label: string; detail: string; icon: string; identity: string; scopes: string }

const connectors: Connector[] = [
  { provider: 'google', databaseProvider: 'google', label: 'Google Workspace', detail: 'Gmail et Google Calendar', icon: 'G', identity: 'google', scopes: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly' },
  { provider: 'azure', databaseProvider: 'microsoft', label: 'Microsoft 365', detail: 'Outlook et calendrier Microsoft', icon: 'M', identity: 'azure', scopes: 'email openid profile offline_access Mail.Read Calendars.Read' },
  { provider: 'linkedin_oidc' as Provider, databaseProvider: 'linkedin', label: 'LinkedIn', detail: 'Identité et mouvements de poste', icon: 'in', identity: 'linkedin_oidc', scopes: 'openid profile email' },
]

let session: Session
let currentStep = 1

const brand = document.querySelector<HTMLElement>('#brand')
if (brand) brand.innerHTML = tohuLogo()

function text(selector: string, value: string): void {
  const node = document.querySelector<HTMLElement>(selector)
  if (node) node.textContent = value
}

function setStep(step: number): void {
  currentStep = step
  document.querySelector<HTMLElement>('#step-identity')!.hidden = step !== 1
  document.querySelector<HTMLElement>('#step-connectors')!.hidden = step !== 2
  document.querySelectorAll<HTMLElement>('.onboarding-progress i').forEach((item, index) => item.classList.toggle('active', index < step))
}

function connectedIdentities(): Set<string> {
  return new Set((session.user.identities ?? []).map((identity) => identity.provider))
}

async function renderConnectors(): Promise<void> {
  const container = document.querySelector<HTMLElement>('#connector-list')
  if (!container) return
  const { data: rows } = await getSupabase().from('connectors').select('provider,status').eq('user_id', session.user.id)
  const connected = new Set((rows ?? []).filter((row) => row.status === 'connected').map((row) => row.provider))
  container.innerHTML = connectors.map((connector) => {
    const isConnected = connected.has(connector.databaseProvider)
    return `<div class="onboarding-connector"><span class="connector-ic">${connector.icon}</span><span class="connector-copy"><b>${connector.label}</b><span>${connector.detail}</span></span>${isConnected ? '<span class="connector-status">● Connecté</span>' : `<button class="btn-secondary connector-link" data-link="${connector.databaseProvider}">Autoriser</button>`}</div>`
  }).join('')
  container.querySelectorAll<HTMLButtonElement>('[data-link]').forEach((button) => button.addEventListener('click', () => linkProvider(button.dataset.link ?? '')))
}

async function linkProvider(databaseProvider: string): Promise<void> {
  text('#connector-error', '')
  const connector = connectors.find((item) => item.databaseProvider === databaseProvider)
  if (!connector) return
  const alreadyLinked = connectedIdentities().has(connector.identity)
  const options = {
    redirectTo: absoluteUrl(`/onboarding.html?step=2&connector=${connector.databaseProvider}`),
    scopes: connector.scopes,
    queryParams: databaseProvider === 'google' ? { access_type: 'offline', prompt: 'consent' } : undefined,
  }
  const { error } = alreadyLinked
    ? await getSupabase().auth.signInWithOAuth({ provider: connector.provider, options })
    : await getSupabase().auth.linkIdentity({ provider: connector.provider, options })
  if (error) text('#connector-error', error.message)
}

async function persistEmailConnection(provider: string): Promise<void> {
  if (provider !== 'google' && provider !== 'microsoft') return
  const { data: sessionData } = await getSupabase().auth.getSession()
  session = sessionData.session ?? session
  if (!session.provider_token) throw new Error('Le fournisseur n’a pas transmis de jeton email. Reconnecte le compte.')
  const { data: membership, error: membershipError } = await getSupabase().from('memberships').select('organization_id').eq('user_id', session.user.id).limit(1).maybeSingle()
  if (membershipError || !membership) throw membershipError ?? new Error('Organisation introuvable')
  const connector = connectors.find((item) => item.databaseProvider === provider)
  const { data, error } = await getSupabase().functions.invoke('connect-email-provider', { body: { organizationId: membership.organization_id, provider, accessToken: session.provider_token, refreshToken: session.provider_refresh_token ?? null, expiresIn: 3600, scopes: connector?.scopes.split(' ') ?? [] } })
  if (error || data?.error) throw error ?? new Error(data.error)
  await renderConnectors()
  text('#connector-error', 'Compte connecté. L’analyse des emails démarre en arrière-plan…')
  void getSupabase().functions.invoke('sync-email-analysis', { body: { organizationId: membership.organization_id, provider } }).then(({ data: syncData, error: syncError }) => {
    if (syncError || syncData?.error) text('#connector-error', syncError?.message ?? syncData.error)
    else text('#connector-error', `${syncData.messages ?? 0} emails synchronisés et ${syncData.peopleAnalyzed ?? 0} profil(s) personne analysé(s).`)
  })
}

async function saveIdentity(): Promise<boolean> {
  const role = document.querySelector<HTMLSelectElement>('#role')?.value ?? ''
  if (!role) {
    text('#onboarding-error', 'Choisis ton rôle pour continuer.')
    return false
  }
  const userName = displayName(session.user)
  const { error } = await getSupabase().from('profiles').upsert({
    id: session.user.id,
    full_name: userName,
    avatar_url: session.user.user_metadata.avatar_url ?? session.user.user_metadata.picture ?? null,
    role_title: role,
  })
  if (error) {
    text('#onboarding-error', error.message)
    return false
  }
  return true
}

async function finish(): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>('#finish')
  if (button) { button.disabled = true; button.innerHTML = '<span class="spinner"></span> Préparation…' }
  const { error } = await getSupabase().from('profiles').update({ onboarding_completed: true }).eq('id', session.user.id)
  if (error) {
    text('#connector-error', error.message)
    if (button) { button.disabled = false; button.textContent = 'Voir mon cerveau relationnel →' }
    return
  }
  window.location.replace('/tohu-app.html?start=cerveau')
}

async function boot(): Promise<void> {
  session = await requireSession()
  const name = displayName(session.user)
  text('#welcome', `Bienvenue, ${name.split(' ')[0] ?? name}`)
  text('#identity-email', session.user.email ?? '')
  text('#avatar', initials(name))
  const { data: profile } = await getSupabase().from('profiles').select('role_title,onboarding_completed').eq('id', session.user.id).maybeSingle()
  if (profile?.onboarding_completed) {
    window.location.replace('/tohu-app.html')
    return
  }
  const role = document.querySelector<HTMLSelectElement>('#role')
  if (role && profile?.role_title) role.value = profile.role_title
  setStep(new URLSearchParams(window.location.search).get('step') === '2' ? 2 : 1)
  await renderConnectors()
  const returnedConnector = new URLSearchParams(window.location.search).get('connector')
  if (returnedConnector) await persistEmailConnection(returnedConnector)
}

document.querySelector('#next')?.addEventListener('click', async () => { if (await saveIdentity()) setStep(2) })
document.querySelector('#previous')?.addEventListener('click', () => setStep(1))
document.querySelector('#finish')?.addEventListener('click', finish)
document.querySelector('#skip')?.addEventListener('click', finish)
document.querySelector('#logout')?.addEventListener('click', signOut)

boot().catch((error) => text(currentStep === 1 ? '#onboarding-error' : '#connector-error', error instanceof Error ? error.message : 'Impossible de charger l’onboarding.'))
