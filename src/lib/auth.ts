import type { Session, User } from '@supabase/supabase-js'
import { getSupabase } from './supabase'
import { LOGIN_PATH } from './routes'

export async function currentSession(): Promise<Session | null> {
  const { data, error } = await getSupabase().auth.getSession()
  if (error) throw error
  return data.session
}

export async function requireSession(): Promise<Session> {
  const session = await currentSession()
  if (!session) {
    window.location.replace(`${LOGIN_PATH}?next=${encodeURIComponent(window.location.pathname + window.location.search)}`)
    throw new Error('Session requise')
  }
  return session
}

export function displayName(user: User): string {
  const meta = user.user_metadata ?? {}
  return String(meta.full_name ?? meta.name ?? meta.user_name ?? user.email?.split('@')[0] ?? 'Membre Tohu')
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || 'T'
}

export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut()
  window.location.replace(LOGIN_PATH)
}
