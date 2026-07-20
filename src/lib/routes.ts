export const LOGIN_PATH = '/connexion'
export const ONBOARDING_PATH = '/bienvenue'

export function replaceLegacyPublicPath(legacyPath: string, cleanPath: string): void {
  if (window.location.pathname.endsWith(legacyPath)) {
    window.history.replaceState(null, '', cleanPath + window.location.search + window.location.hash)
  }
}
