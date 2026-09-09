import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } })
const checked = async (query: any) => { const result = await query; if (result.error) throw result.error; return result.data }
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const redirect = `${Deno.env.get('SUPABASE_URL')}/functions/v1/connect-notion`
  const app = Deno.env.get('APP_URL') ?? 'https://tohu.co'
  const clientId = Deno.env.get('NOTION_CLIENT_ID')
  const clientSecret = Deno.env.get('NOTION_CLIENT_SECRET')
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url), nonce = url.searchParams.get('state')
      if (!nonce || !/^[a-f0-9-]{36}$/.test(nonce)) return json({ error: 'État OAuth invalide' }, 400)
      const pending = await checked(db.from('connector_oauth_states').delete().eq('nonce', nonce).eq('provider', 'notion').gt('expires_at', new Date().toISOString()).select().maybeSingle())
      if (!pending) return json({ error: 'Autorisation expirée ou déjà utilisée' }, 400)
      if (url.searchParams.has('error')) return Response.redirect(`${app}/app/connectors?error=notion_access_denied`, 302)
      if (!await checked(db.from('memberships').select('id').eq('organization_id', pending.organization_id).eq('user_id', pending.user_id).maybeSingle())) return json({ error: 'Accès refusé' }, 403)
      if (!clientId || !clientSecret) throw new Error('Secrets Notion non configurés dans les Edge Functions')
      const response = await fetch('https://api.notion.com/v1/oauth/token', { method: 'POST', headers: { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, 'Content-Type': 'application/json', 'Notion-Version': '2026-03-11' }, body: JSON.stringify({ grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: redirect }), signal: AbortSignal.timeout(20000) })
      const token = await response.json()
      if (!response.ok || !token.access_token || !token.workspace_id) throw new Error(String(token.error_description ?? 'Échange OAuth Notion refusé'))
      const connector = await checked(db.from('connectors').upsert({ organization_id: pending.organization_id, user_id: pending.user_id, provider: 'notion', status: 'connected', scopes: ['read_content', 'user_information'], metadata: { workspace_id: token.workspace_id, workspace_name: token.workspace_name, owner_user_id: token.owner?.user?.id, owner_email: token.owner?.user?.person?.email }, last_synced_at: null }, { onConflict: 'organization_id,user_id,provider' }).select('id').single())
      await checked(db.from('oauth_accounts').delete().eq('connector_id', connector.id))
      await checked(db.rpc('store_oauth_tokens_server', { p_organization_id: pending.organization_id, p_connector_id: connector.id, p_provider_account_id: token.bot_id, p_access_token: token.access_token, p_refresh_token: token.refresh_token ?? null, p_expires_at: null }))
      await checked(db.from('connector_sync_state').upsert({ connector_id: connector.id, state: {} }))
      return Response.redirect(`${app}/app/connectors?connected=notion`, 302)
    }
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    const { data: { user } } = await db.auth.getUser((req.headers.get('Authorization') ?? '').replace('Bearer ', ''))
    if (!user) return json({ error: 'Session invalide' }, 401)
    const { organizationId, action = 'start' } = await req.json()
    if (!await checked(db.from('memberships').select('id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle())) return json({ error: 'Accès refusé' }, 403)
    if (action === 'disconnect') {
      const connector = await checked(db.from('connectors').select('id').eq('organization_id', organizationId).eq('user_id', user.id).eq('provider', 'notion').single())
      await checked(db.from('oauth_accounts').delete().eq('connector_id', connector.id))
      await checked(db.from('connector_sync_state').delete().eq('connector_id', connector.id))
      await checked(db.from('connectors').update({ status: 'disconnected', metadata: {}, scopes: [] }).eq('id', connector.id))
      return json({ success: true })
    }
    if (!clientId || !clientSecret) return json({ error: 'NOTION_CLIENT_ID / NOTION_CLIENT_SECRET non configurés dans les secrets Edge Functions' }, 500)
    await checked(db.from('connector_oauth_states').delete().lt('expires_at', new Date().toISOString()))
    const pending = await checked(db.from('connector_oauth_states').insert({ organization_id: organizationId, user_id: user.id, provider: 'notion' }).select('nonce').single())
    return json({ url: `https://api.notion.com/v1/oauth/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', owner: 'user', state: pending.nonce })}` })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Opération Notion impossible'
    return req.method === 'GET' ? Response.redirect(`${app}/app/connectors?error=${encodeURIComponent(message)}`, 302) : json({ error: message }, 500)
  }
})
