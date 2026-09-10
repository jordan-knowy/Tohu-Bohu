import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SLACK_SCOPES, slackApi } from '../_shared/slack.ts'
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } })
const checked = async (query: any) => { const result = await query; if (result.error) throw result.error; return result.data }
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const redirect = `${Deno.env.get('SUPABASE_URL')}/functions/v1/connect-slack`
  const app = Deno.env.get('APP_URL') ?? 'https://tohu.co'
  const clientId = Deno.env.get('SLACK_CLIENT_ID')
  const clientSecret = Deno.env.get('SLACK_CLIENT_SECRET')
  let callbackConnectorId: string | null = null
  let callbackLease: string | null = null
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url)
      const nonce = url.searchParams.get('state')
      if (!nonce || !/^[a-f0-9-]{36}$/.test(nonce)) return json({ error: 'État OAuth invalide' }, 400)
      const pending = await checked(db.from('connector_oauth_states').delete().eq('nonce', nonce).eq('provider', 'slack').gt('expires_at', new Date().toISOString()).select().maybeSingle())
      if (!pending) return json({ error: 'Autorisation expirée ou déjà utilisée' }, 400)
      if (url.searchParams.has('error')) return Response.redirect(`${app}/app/connectors?error=slack_access_denied`, 302)
      const member = await checked(db.from('memberships').select('id').eq('organization_id', pending.organization_id).eq('user_id', pending.user_id).maybeSingle())
      if (!member) return json({ error: 'Accès refusé' }, 403)
      const code = url.searchParams.get('code')
      if (!code) return json({ error: 'Code OAuth manquant' }, 400)
      if (!clientId || !clientSecret) throw new Error('Secrets Slack non configurés dans les Edge Functions')
      const response = await fetch('https://slack.com/api/oauth.v2.access', { method: 'POST', body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, code }), signal: AbortSignal.timeout(20000) })
      const token = await response.json()
      if (!response.ok || !token.ok || !token.authed_user?.access_token || !token.team?.id) throw new Error('Échange OAuth Slack refusé')
      const existing = await checked(db.from('connectors').select('id').eq('organization_id', pending.organization_id).eq('user_id', pending.user_id).eq('provider', 'slack').maybeSingle())
      if (existing) {
        const lease = crypto.randomUUID()
        if (!await checked(db.rpc('claim_connector_sync', { p_connector_id: existing.id, p_lease_id: lease }))) throw new Error('Synchronisation en cours, réessaie la connexion dans quelques minutes')
        callbackConnectorId = existing.id
        callbackLease = lease
      }
      const connector = await checked(db.from('connectors').upsert({ organization_id: pending.organization_id, user_id: pending.user_id, provider: 'slack', status: 'not_connected', scopes: (token.authed_user.scope ?? '').split(','), metadata: { team_id: token.team.id, team_name: token.team.name, slack_user_id: token.authed_user.id, share_public: true }, last_synced_at: null }, { onConflict: 'organization_id,user_id,provider' }).select('id').single())
      callbackConnectorId = connector.id
      // Remove the previous refresh token: the shared vault RPC preserves null refresh tokens.
      await checked(db.from('oauth_accounts').delete().eq('connector_id', connector.id))
      await checked(db.rpc('store_oauth_tokens_server', { p_organization_id: pending.organization_id, p_connector_id: connector.id, p_provider_account_id: token.team.id, p_access_token: token.authed_user.access_token, p_refresh_token: token.authed_user.refresh_token ?? null, p_expires_at: token.authed_user.expires_in ? new Date(Date.now() + token.authed_user.expires_in * 1000).toISOString() : null }))
      await checked(db.from('connector_sync_state').upsert({ connector_id: connector.id, state: {}, lease_until: null, lease_id: null }))
      await checked(db.from('connectors').update({ status: 'connected' }).eq('id', connector.id))
      return Response.redirect(`${app}/app/connectors?connected=slack`, 302)
    }
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    const { data: { user } } = await db.auth.getUser((req.headers.get('Authorization') ?? '').replace('Bearer ', ''))
    if (!user) return json({ error: 'Session invalide' }, 401)
    const { organizationId, action = 'start', sharePublic } = await req.json()
    const member = await checked(db.from('memberships').select('id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle())
    if (!member) return json({ error: 'Accès refusé' }, 403)
    if (action === 'disconnect' || action === 'configure') {
      const connector = await checked(db.from('connectors').select('*').eq('organization_id', organizationId).eq('user_id', user.id).eq('provider', 'slack').single())
      const lease = crypto.randomUUID()
      if (!await checked(db.rpc('claim_connector_sync', { p_connector_id: connector.id, p_lease_id: lease }))) return json({ error: 'Synchronisation en cours. Réessaie dans quelques instants.' }, 409)
      try {
        if (action === 'configure') {
          if (typeof sharePublic !== 'boolean') return json({ error: 'Configuration invalide' }, 400)
          await checked(db.from('connectors').update({ metadata: { ...connector.metadata, share_public: sharePublic } }).eq('id', connector.id))
          await checked(db.from('connector_sync_state').update({ state: {} }).eq('connector_id', connector.id))
        } else {
          const tokens = await checked(db.rpc('get_oauth_tokens_server', { p_connector_id: connector.id }))
          if (tokens?.[0]?.access_token) {
            try { await slackApi(tokens[0].access_token, 'auth.revoke') } catch { /* Local disconnect still removes all credentials. */ }
          }
          await checked(db.from('oauth_accounts').delete().eq('connector_id', connector.id))
          await checked(db.from('connectors').update({ status: 'disconnected', metadata: {}, scopes: [] }).eq('id', connector.id))
          await checked(db.from('connector_sync_state').update({ state: {} }).eq('connector_id', connector.id))
        }
      } finally { await checked(db.from('connector_sync_state').update({ lease_until: null, lease_id: null }).eq('connector_id', connector.id).eq('lease_id', lease)) }
      return json({ success: true })
    }
    if (action !== 'start') return json({ error: 'Action invalide' }, 400)
    if (!clientId || !clientSecret) return json({ error: 'SLACK_CLIENT_ID / SLACK_CLIENT_SECRET non configurés dans les secrets Edge Functions' }, 500)
    await checked(db.from('connector_oauth_states').delete().lt('expires_at', new Date().toISOString()))
    const pending = await checked(db.from('connector_oauth_states').insert({ organization_id: organizationId, user_id: user.id, provider: 'slack' }).select('nonce').single())
    return json({ url: `https://slack.com/oauth/v2/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: redirect, user_scope: SLACK_SCOPES.join(','), state: pending.nonce })}` })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Opération Slack impossible'
    if (req.method === 'GET') {
      if (callbackConnectorId) await db.from('connectors').update({ status: 'error' }).eq('id', callbackConnectorId)
      return Response.redirect(`${app}/app/connectors?error=${encodeURIComponent(message)}`, 302)
    }
    return json({ error: message }, 500)
  } finally {
    if (callbackConnectorId && callbackLease) await db.from('connector_sync_state').update({ lease_until: null, lease_id: null }).eq('connector_id', callbackConnectorId).eq('lease_id', callbackLease)
  }
})
