import { useCallback, useEffect, useRef, useState } from 'react'
import type { Provider, Session } from '@supabase/supabase-js'
import { absoluteUrl, getSupabase } from '../../lib/supabase'
import { listConnectors, setConnector, type ConnectorRow } from '../../services/data'
import { useToast } from '../../person-detail/ui'

// Logos officiels (Simple Icons, MIT) — monochrome, colorés via currentColor comme les autres icônes de l'app.
const GOOGLE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/></svg>'
const MICROSOFT_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M0 0v11.408h11.408V0zm12.594 0v11.408H24V0zM0 12.594V24h11.408V12.594zm12.594 0V24H24V12.594z"/></svg>'
// Non issue de Simple Icons (indisponible en fetch direct) — pictogramme générique
// « personnes + bulle », à remplacer par le vrai logo Teams si besoin visuel exact.
const TEAMS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 10.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M13.5 21v-2.5a3.5 3.5 0 0 1 3.5-3.5h2a3.5 3.5 0 0 1 3.5 3.5V21"/><path d="M9 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/><path d="M2 20v-2a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v2"/></svg>'
const LINKEDIN_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>'
const HUBSPOT_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.164 7.93V5.084a2.198 2.198 0 001.267-1.978v-.067A2.2 2.2 0 0017.238.845h-.067a2.2 2.2 0 00-2.193 2.193v.067a2.196 2.196 0 001.252 1.973l.013.006v2.852a6.22 6.22 0 00-2.969 1.31l.012-.01-7.828-6.095A2.497 2.497 0 104.3 4.656l-.012.006 7.697 5.991a6.176 6.176 0 00-1.038 3.446c0 1.343.425 2.588 1.147 3.607l-.013-.02-2.342 2.343a1.968 1.968 0 00-.58-.095h-.002a2.033 2.033 0 102.033 2.033 1.978 1.978 0 00-.1-.595l.005.014 2.317-2.317a6.247 6.247 0 104.782-11.134l-.036-.005zm-.964 9.378a3.206 3.206 0 113.215-3.207v.002a3.206 3.206 0 01-3.207 3.207z"/></svg>'

// Deux mécanismes de connexion coexistent : les providers Supabase Auth
// (identités liées au compte, token géré par Supabase) et les connecteurs CRM
// (OAuth applicatif propre à Tohu, géré par une edge function connect-<provider>
// qui renvoie une authorizeUrl puis persiste le token côté serveur au retour).
type ConnectorDefinition =
  | { provider: string; label: string; description: string; icon: string; kind: 'supabase'; auth: Provider; scopes: string }
  | { provider: string; label: string; description: string; icon: string; kind: 'edge'; functionSlug: string }

export const connectorDefinitions: ConnectorDefinition[] = [
  { provider: 'google', label: 'Google Workspace', description: 'Gmail, réunions et calendrier Google.', icon: GOOGLE_ICON, kind: 'supabase', auth: 'google' as Provider, scopes: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/meetings.space.readonly' },
  { provider: 'microsoft', label: 'Microsoft 365', description: 'Emails Outlook et calendrier Microsoft.', icon: MICROSOFT_ICON, kind: 'supabase', auth: 'azure' as Provider, scopes: 'email openid profile offline_access User.Read Mail.Read Calendars.Read' },
  { provider: 'linkedin', label: 'LinkedIn', description: 'Identité professionnelle et mouvements de poste.', icon: LINKEDIN_ICON, kind: 'supabase', auth: 'linkedin_oidc' as Provider, scopes: 'openid profile email' },
  { provider: 'hubspot', label: 'HubSpot', description: 'Contacts et entreprises synchronisés depuis HubSpot.', icon: HUBSPOT_ICON, kind: 'edge', functionSlug: 'connect-hubspot' },
  { provider: 'teams', label: 'Microsoft Teams', description: 'Réunions et transcripts Teams — nécessite qu’un admin Microsoft 365 de votre organisation clique ci-dessous et valide le consentement.', icon: TEAMS_ICON, kind: 'edge', functionSlug: 'connect-teams' },
]

function identityProvider(connector: string): string {
  return connector === 'google' ? 'google' : connector === 'microsoft' ? 'azure' : 'linkedin_oidc'
}

function formatDate(value: string | null | undefined, fallback = 'Jamais'): string {
  if (!value) return fallback
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}

/** FunctionsHttpError.message est générique (« Edge Function returned a non-2xx status
 *  code ») ; le vrai détail est dans error.context (la Response brute de l'edge function). */
async function invokeError(error: unknown, fallback: string): Promise<Error> {
  const detail = await (error as { context?: Response })?.context?.clone?.().json?.().catch(() => null)
  if (detail?.error) return new Error(String(detail.error))
  return error instanceof Error && !error.message.includes('non-2xx') ? error : new Error(fallback)
}

type PageContext = { session: Session; workspaceId: string }

/** Connecteurs — port fidèle de la vue du shell historique (mêmes classes connector-*). */
export default function ConnectorsPage({ context }: { context: PageContext }) {
  const toast = useToast()
  const [rows, setRows] = useState<ConnectorRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reconciled = useRef(false)
  const organizationId = context.workspaceId

  const refresh = useCallback(async () => {
    try { setError(null); setRows(await listConnectors()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Une erreur inattendue est survenue.') }
  }, [])

  const syncEmailProvider = useCallback(async (provider: string) => {
    if (provider !== 'google' && provider !== 'microsoft') return
    toast(`Synchronisation ${provider === 'google' ? 'Google Workspace' : 'Microsoft 365'} lancée…`)
    const emailSync = getSupabase().functions.invoke('sync-email-analysis', { body: { organizationId, provider } })
    // Google Meet est synchronisé dans la foulée du même bouton plutôt que d'ajouter
    // une tuile séparée — un échec de ce côté ne doit pas faire échouer la synchro email.
    const meetSync = provider === 'google'
      ? getSupabase().functions.invoke('sync-google-meet', { body: { organizationId } }).catch(() => ({ data: null, error: null }))
      : Promise.resolve({ data: null, error: null })
    const [{ data, error }, { data: meetData }] = await Promise.all([emailSync, meetSync])
    if (error || data?.error) throw data?.error ? new Error(data.error) : await invokeError(error, 'Synchronisation impossible.')
    await refresh()
    const meetSuffix = meetData && !meetData.error && meetData.meetings > 0 ? ` · ${meetData.meetings} réunion(s) Google Meet` : ''
    toast(`${data.messages ?? 0} emails synchronisés · ${data.peopleAnalyzed ?? 0} profil(s) personne mis à jour${meetSuffix}.`)
  }, [organizationId, refresh, toast])

  const syncHubspot = useCallback(async () => {
    toast('Synchronisation HubSpot lancée…')
    const { data, error } = await getSupabase().functions.invoke('sync-hubspot', { body: { organizationId } })
    if (error || data?.error) throw data?.error ? new Error(data.error) : await invokeError(error, 'Synchronisation impossible.')
    await refresh()
    toast(`${data.companies ?? 0} entreprise(s) et ${data.contacts ?? 0} contact(s) synchronisés depuis HubSpot.`)
  }, [organizationId, refresh, toast])

  const syncTeams = useCallback(async () => {
    toast('Synchronisation Microsoft Teams lancée…')
    const { data, error } = await getSupabase().functions.invoke('sync-teams-meetings', { body: { organizationId } })
    if (error || data?.error) throw data?.error ? new Error(data.error) : await invokeError(error, 'Synchronisation impossible.')
    await refresh()
    toast(`${data.meetings ?? 0} réunion(s) Teams synchronisée(s) · ${data.transcripts ?? 0} transcript(s).`)
  }, [organizationId, refresh, toast])

  const persistEmailProvider = useCallback(async (provider: string) => {
    if (provider !== 'google' && provider !== 'microsoft') {
      await setConnector(context.session.user.id, provider, 'connected')
      return
    }
    const { data: sessionData } = await getSupabase().auth.getSession()
    const session = sessionData.session ?? context.session
    if (!session.provider_token) throw new Error('Jeton fournisseur absent. Reconnecte ce compte pour autoriser la lecture des emails.')
    const definition = connectorDefinitions.find((item) => item.provider === provider)
    const { data, error } = await getSupabase().functions.invoke('connect-email-provider', {
      body: {
        organizationId,
        provider,
        accessToken: session.provider_token,
        refreshToken: session.provider_refresh_token ?? null,
        expiresIn: 3600,
        scopes: definition?.kind === 'supabase' ? definition.scopes.split(' ') : [],
      },
    })
    if (error || data?.error) throw data?.error ? new Error(data.error) : await invokeError(error, 'Connexion impossible.')
  }, [context.session, organizationId])

  // Retour d’OAuth : ?connector= sur la route propre /app/connectors.
  // ou ?connected=/?error= (connecteurs CRM — token déjà persisté côté serveur).
  useEffect(() => {
    if (reconciled.current) return
    reconciled.current = true
    const params = new URLSearchParams(window.location.search)
    const run = async () => {
      const connected = params.get('connected')
      const oauthError = params.get('error')
      if (connected) toast(`${connectorDefinitions.find((item) => item.provider === connected)?.label ?? 'Source'} connecté.`)
      if (oauthError) toast('Connexion impossible : ' + oauthError.replace(/_/g, ' '), 'error')
      const connector = params.get('connector')
      if (connector) {
        const { data } = await getSupabase().auth.getSession()
        const session = data.session ?? context.session
        const identity = (session.user.identities ?? []).some((item) => item.provider === identityProvider(connector))
        if (identity) {
          await persistEmailProvider(connector)
          toast(`${connectorDefinitions.find((item) => item.provider === connector)?.label ?? 'Source'} connecté.`)
          if (connector === 'google' || connector === 'microsoft') {
            void syncEmailProvider(connector).catch((reason) => toast(reason instanceof Error ? reason.message : 'Synchronisation impossible.', 'error'))
          }
        }
      }
      if (connected || oauthError || params.get('connector')) history.replaceState(null, '', '/app/connectors')
      await refresh()
    }
    void run().catch((reason) => { toast(reason instanceof Error ? reason.message : 'Action impossible.', 'error'); void refresh() })
  }, [context.session, persistEmailProvider, refresh, syncEmailProvider, toast])

  const connectProvider = async (provider: string) => {
    const definition = connectorDefinitions.find((item) => item.provider === provider)
    if (!definition) return
    if (definition.kind === 'edge') {
      const { data, error } = await getSupabase().functions.invoke(definition.functionSlug, { body: { organizationId } })
      if (error || !data?.url) throw await invokeError(error, `Connexion ${definition.label} indisponible.`)
      window.location.href = data.url
      return
    }
    const alreadyLinked = (context.session.user.identities ?? []).some((identity) => identity.provider === identityProvider(provider))
    await setConnector(context.session.user.id, provider, 'not_connected')
    const options = {
      redirectTo: absoluteUrl(`/app/connectors?connector=${encodeURIComponent(provider)}`),
      scopes: definition.scopes,
      // Google : consentement forcé pour obtenir un refresh_token. Microsoft : sans
      // select_account, Azure réutilise silencieusement la session Microsoft active
      // du navigateur au lieu de laisser choisir le compte (perso vs pro).
      queryParams: (provider === 'google'
        ? { access_type: 'offline', prompt: 'consent' }
        : provider === 'microsoft' ? { prompt: 'select_account' } : undefined) as Record<string, string> | undefined,
    }
    const { error: authError } = alreadyLinked
      ? await getSupabase().auth.signInWithOAuth({ provider: definition.auth, options })
      : await getSupabase().auth.linkIdentity({ provider: definition.auth, options })
    if (authError) {
      await setConnector(context.session.user.id, provider, 'error')
      throw authError
    }
  }

  const disconnectProvider = async (provider: string) => {
    if (provider === 'google' || provider === 'microsoft') {
      const { data, error } = await getSupabase().functions.invoke('connect-email-provider', { body: { organizationId, provider, action: 'disconnect' } })
      if (error || data?.error) throw data?.error ? new Error(data.error) : await invokeError(error, 'Déconnexion impossible.')
    } else {
      await setConnector(context.session.user.id, provider, 'disconnected')
    }
    await refresh()
    toast('Connexion retirée de Tohu. Une révocation peut aussi être nécessaire chez le fournisseur.')
  }

  const act = (action: () => Promise<void>) => { void action().catch((reason) => toast(reason instanceof Error ? reason.message : 'Action impossible.', 'error')) }

  if (error) return <div className="inline-error">{error}</div>
  if (!rows) return <div className="loading-state"><span className="spinner" /></div>

  const states = new Map(rows.map((row) => [row.provider, row]))
  const connected = connectorDefinitions.filter((definition) => states.get(definition.provider)?.status === 'connected').length

  return <>
    <section className="connector-summary">
      <div className="connector-ring" style={{ ['--progress' as string]: `${connected / connectorDefinitions.length * 100}%` }}><b>{connected}/{connectorDefinitions.length}</b></div>
      <div><h2>Activation de ton OS relationnel</h2><p>Chaque source améliore la couverture et la fraîcheur de la mémoire d’équipe.</p></div>
    </section>
    <div className="connector-list">
      {connectorDefinitions.map((definition) => {
        const row = states.get(definition.provider)
        const isConnected = row?.status === 'connected'
        const status = isConnected
          ? `● Connecté${row?.last_synced_at ? ` · synchro ${formatDate(row.last_synced_at)}` : ''}`
          : row?.status === 'error' ? '● Erreur de connexion' : '○ Non connecté'
        return <article className="connector-card panel" key={definition.provider}>
          <span className="connector-icon" dangerouslySetInnerHTML={{ __html: definition.icon }} />
          <div>
            <h3>{definition.label}</h3>
            <p>{definition.description}</p>
            <span className={`connector-status ${isConnected ? '' : 'off'}`}>{status}</span>
            {row?.last_error && <p className="error-text">{row.last_error}</p>}
          </div>
          <div className="connector-actions">
            {isConnected && definition.kind === 'supabase' && definition.provider !== 'linkedin' && <button type="button" className="btn-secondary" onClick={() => act(() => syncEmailProvider(definition.provider))}>Synchroniser</button>}
            {isConnected && definition.kind === 'edge' && definition.provider === 'hubspot' && <button type="button" className="btn-secondary" onClick={() => act(syncHubspot)}>Synchroniser</button>}
            {isConnected && definition.kind === 'edge' && definition.provider === 'teams' && <button type="button" className="btn-secondary" onClick={() => act(syncTeams)}>Synchroniser</button>}
            <button type="button" className={isConnected ? 'btn-danger' : 'btn-secondary'} onClick={() => act(() => isConnected ? disconnectProvider(definition.provider) : connectProvider(definition.provider))}>{isConnected ? 'Déconnecter' : 'Connecter'}</button>
          </div>
        </article>
      })}
    </div>
  </>
}
