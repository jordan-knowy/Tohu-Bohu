import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

async function providerAccount(provider: string, accessToken: string): Promise<{ id: string; email: string | null }> {
  const url = provider === 'google'
    ? 'https://openidconnect.googleapis.com/v1/userinfo'
    : 'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName'
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) throw new Error(`Jeton ${provider} refusé (${response.status})`)
  const data = await response.json()
  return provider === 'google'
    ? { id: String(data.sub), email: data.email ?? null }
    : { id: String(data.id), email: data.mail ?? data.userPrincipalName ?? null }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Authentification requise' }, 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
    const jwt = authorization.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt)
    if (userError || !user) return json({ error: 'Session invalide' }, 401)

    const body = await request.json().catch(() => ({}))
    const { organizationId, provider, accessToken, refreshToken, expiresIn = 3600, action = 'connect', scopes = [] } = body
    if (!organizationId || !['google', 'microsoft'].includes(provider)) return json({ error: 'Organisation ou fournisseur invalide' }, 400)

    const { data: membership } = await supabase.from('memberships').select('id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle()
    if (!membership) return json({ error: 'Accès refusé à cette organisation' }, 403)

    const { data: connector, error: connectorError } = await supabase.from('connectors').upsert({
      organization_id: organizationId,
      user_id: user.id,
      provider,
      status: action === 'disconnect' ? 'disconnected' : 'connected',
      scopes: Array.isArray(scopes) ? scopes : [],
      metadata: action === 'disconnect' ? {} : { connected_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id,user_id,provider' }).select('id').single()
    if (connectorError || !connector) throw connectorError ?? new Error('Connecteur introuvable')

    if (action === 'disconnect') {
      await supabase.from('oauth_accounts').delete().eq('connector_id', connector.id)
      return json({ success: true, status: 'disconnected' })
    }
    if (!accessToken) return json({ error: 'Jeton fournisseur manquant. Reconnecte le compte.' }, 400)

    const account = await providerAccount(provider, accessToken)
    const { error: oauthError } = await supabase.rpc('store_oauth_tokens_server', {
      p_organization_id: organizationId,
      p_connector_id: connector.id,
      p_provider_account_id: account.id,
      p_access_token: accessToken,
      p_refresh_token: refreshToken ?? null,
      p_expires_at: new Date(Date.now() + Math.max(60, Number(expiresIn)) * 1000).toISOString(),
    })
    if (oauthError) throw oauthError

    await supabase.from('connectors').update({
      metadata: { account_email: account.email, provider_account_id: account.id, connected_at: new Date().toISOString() },
    }).eq('id', connector.id)

    return json({ success: true, connectorId: connector.id, provider, accountEmail: account.email })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Connexion impossible' }, 500)
  }
})
