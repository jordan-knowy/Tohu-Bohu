/**
 * Redirecteur legacy — /tohu-app.html?view=… → routes du shell React unifié.
 *
 * Ce fichier existe pour préserver les URLs historiques encore référencées à
 * l'extérieur de l'app : redirections OAuth Supabase (redirectTo whitelistés en
 * /tohu-app.html?start=connecteurs&connector=…), favoris navigateur, emails.
 * Les paramètres non liés à la navigation (connector, mode, …) sont conservés.
 */
const VIEW_ROUTES: Record<string, string> = {
  cerveau: '/app/ask',
  home: '/app/home',
  acc: '/app/accounts',
  per: '/app/people',
  connecteurs: '/app/connectors',
  profil: '/app/profile',
  me: '/app/account',
}

const url = new URL(window.location.href)
const view = url.searchParams.get('start') ?? url.searchParams.get('view') ?? 'home'
url.searchParams.delete('start')
url.searchParams.delete('view')
const query = url.searchParams.toString()
window.location.replace((VIEW_ROUTES[view] ?? '/app/home') + (query ? `?${query}` : ''))
