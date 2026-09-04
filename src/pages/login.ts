import type { Provider } from '@supabase/supabase-js'
import '../styles/fonts.css'
import '../styles/tokens.css'
import '../styles/public.css'
import { tohuLogo } from '../components/logo'
import { getSupabase, isSupabaseConfigured, absoluteUrl } from '../lib/supabase'
import { LOGIN_PATH, ONBOARDING_PATH, replaceLegacyPublicPath } from '../lib/routes'

replaceLegacyPublicPath('/login.html', LOGIN_PATH)
const brand = document.querySelector<HTMLElement>('#brand')
const errorBox = document.querySelector<HTMLElement>('#auth-error')
if (brand) brand.innerHTML = tohuLogo()

function setError(message: string): void {
  if (errorBox) errorBox.textContent = message
}

// Lien d'invitation d'équipe (voir supabase/functions/invite-team-member) : porte
// l'identité de l'invitant directement dans l'URL plutôt que via un lien magique
// Supabase — Tohu n'a que du SSO (Google/Microsoft/LinkedIn), donc la personne se
// connecte normalement ici, avec juste ce message contextuel en plus.
const inviteParams = new URLSearchParams(window.location.search)
const invitedBy = inviteParams.get('invited_by')
const invitedOrg = inviteParams.get('org')
if (invitedBy) {
  const eyebrow = document.querySelector('#auth-eyebrow')
  const title = document.querySelector('#auth-title')
  const intro = document.querySelector('#auth-intro')
  const help = document.querySelector('#auth-help')
  if (eyebrow) eyebrow.textContent = 'Invitation'
  if (title) title.textContent = `${invitedBy} t’ajoute à son équipe`
  if (intro) intro.textContent = invitedOrg
    ? `Connecte-toi pour rejoindre ${invitedOrg} sur Tohu.`
    : 'Connecte-toi pour rejoindre son équipe sur Tohu.'
  if (help) help.remove()
}

async function routeExistingSession(): Promise<void> {
  if (!isSupabaseConfigured) return
  const { data } = await getSupabase().auth.getSession()
  if (!data.session) return
  const { data: profile } = await getSupabase().from('profiles').select('onboarding_completed').eq('id', data.session.user.id).maybeSingle()
  window.location.replace(profile?.onboarding_completed ? '/app/home' : ONBOARDING_PATH)
}

async function login(provider: Provider): Promise<void> {
  if (!isSupabaseConfigured) {
    setError('Supabase n’est pas encore configuré dans le fichier .env.')
    return
  }
  const button = document.querySelector<HTMLButtonElement>(`[data-provider="${provider}"]`)
  button?.classList.add('loading')
  setError('')
  try {
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: absoluteUrl(ONBOARDING_PATH),
        scopes: provider === 'azure' ? 'email openid profile offline_access' : undefined,
      },
    })
    if (error) throw error
  } catch (error) {
    button?.classList.remove('loading')
    setError(error instanceof Error ? error.message : 'La connexion a échoué.')
  }
}

document.querySelectorAll<HTMLButtonElement>('[data-provider]').forEach((button) => {
  button.addEventListener('click', () => login(button.dataset.provider as Provider))
})

routeExistingSession().catch((error) => setError(error instanceof Error ? error.message : 'Impossible de vérifier la session.'))
