import type { Provider } from '@supabase/supabase-js'
import '../styles/fonts.css'
import '../styles/tokens.css'
import '../styles/public.css'
import { tohuLogo } from '../components/logo'
import { getSupabase, isSupabaseConfigured, absoluteUrl } from '../lib/supabase'

const brand = document.querySelector<HTMLElement>('#brand')
const errorBox = document.querySelector<HTMLElement>('#auth-error')
if (brand) brand.innerHTML = tohuLogo()

function setError(message: string): void {
  if (errorBox) errorBox.textContent = message
}

async function routeExistingSession(): Promise<void> {
  if (!isSupabaseConfigured) return
  const { data } = await getSupabase().auth.getSession()
  if (!data.session) return
  const { data: profile } = await getSupabase().from('profiles').select('onboarding_completed').eq('id', data.session.user.id).maybeSingle()
  window.location.replace(profile?.onboarding_completed ? '/tohu-app.html' : '/onboarding.html')
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
        redirectTo: absoluteUrl('/onboarding.html'),
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
