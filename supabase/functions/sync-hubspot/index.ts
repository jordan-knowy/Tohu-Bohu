// Synchronisation CRM HubSpot → Tohu (entreprises + contacts).
// POST (authentifié, JWT) : { organizationId } → tire les objets HubSpot du portail connecté
// et les fait passer par les mêmes fonctions de résolution d'identité que la synchro email,
// pour bénéficier de la même dédoublication (un contact/une entreprise HubSpot fusionne avec
// un contact/une entreprise déjà connu via email plutôt que de créer un doublon).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function cleanEmail(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

type HubspotCompany = { id: string; properties: { name?: string; domain?: string; industry?: string } }
type HubspotContact = {
  id: string
  properties: { email?: string; firstname?: string; lastname?: string; jobtitle?: string }
  associations?: { companies?: { results?: Array<{ id: string }> } }
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const clientId = Deno.env.get('HUBSPOT_CLIENT_ID')
  const clientSecret = Deno.env.get('HUBSPOT_CLIENT_SECRET')
  if (!clientId || !clientSecret) throw new Error('Secrets OAuth HubSpot manquants')
  const response = await fetch('https://api.hubapi.com/oauth/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }),
  })
  if (!response.ok) throw new Error(`Rafraîchissement HubSpot refusé (${response.status})`)
  const data = await response.json()
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? refreshToken, expiresIn: Number(data.expires_in ?? 1800) }
}

async function hubspotCompanies(token: string): Promise<HubspotCompany[]> {
  const url = 'https://api.hubapi.com/crm/v3/objects/companies?limit=100&properties=name,domain,industry'
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error(`HubSpot companies ${response.status}`)
  return ((await response.json()).results ?? []) as HubspotCompany[]
}

async function hubspotContacts(token: string): Promise<HubspotContact[]> {
  const url = 'https://api.hubapi.com/crm/v3/objects/contacts?limit=100&properties=email,firstname,lastname,jobtitle&associations=companies'
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error(`HubSpot contacts ${response.status}`)
  return ((await response.json()).results ?? []) as HubspotContact[]
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const startedAt = new Date().toISOString()
  let syncJobId: string | null = null
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Authentification requise' }, 401)
    const { data: { user }, error: userError } = await supabase.auth.getUser(authorization.replace('Bearer ', ''))
    if (userError || !user) return json({ error: 'Session invalide' }, 401)

    const { organizationId } = await request.json().catch(() => ({}))
    if (!organizationId) return json({ error: 'organizationId requis' }, 400)
    const { data: membership } = await supabase.from('memberships').select('id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle()
    if (!membership) return json({ error: 'Accès refusé' }, 403)

    const { data: connector } = await supabase.from('connectors').select('id,metadata').eq('organization_id', organizationId).eq('user_id', user.id).eq('provider', 'hubspot').maybeSingle()
    if (!connector) return json({ error: 'Connecteur HubSpot introuvable' }, 404)
    const { data: tokenRows, error: tokenError } = await supabase.rpc('get_oauth_tokens_server', { p_connector_id: connector.id })
    const oauth = tokenRows?.[0]
    if (tokenError || !oauth) return json({ error: 'Jetons OAuth absents. Reconnecte HubSpot.' }, 401)

    const { data: job } = await supabase.from('sync_jobs').insert({
      organization_id: organizationId,
      connector_id: connector.id,
      user_id: user.id,
      provider: 'hubspot',
      job_type: 'crm_sync',
      status: 'running',
      current_step: 'Connexion à HubSpot',
      progress: 10,
      started_at: startedAt,
      payload: { provider: 'hubspot' },
    }).select('id').single()
    syncJobId = job?.id ?? null

    let accessToken = oauth.access_token as string | null
    let refreshToken = oauth.refresh_token as string | null
    const expiresSoon = !oauth.expires_at || new Date(oauth.expires_at).getTime() < Date.now() + 90_000
    if ((!accessToken || expiresSoon) && refreshToken) {
      const refreshed = await refreshAccessToken(refreshToken)
      accessToken = refreshed.accessToken
      refreshToken = refreshed.refreshToken
      await supabase.rpc('store_oauth_tokens_server', { p_organization_id: organizationId, p_connector_id: connector.id, p_provider_account_id: oauth.provider_account_id, p_access_token: accessToken, p_refresh_token: refreshToken, p_expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString() })
    }
    if (!accessToken) throw new Error('Jeton HubSpot indisponible')

    if (syncJobId) await supabase.from('sync_jobs').update({ current_step: 'Lecture des entreprises HubSpot', progress: 30 }).eq('id', syncJobId)
    const companies = await hubspotCompanies(accessToken)
    const companyIdByHubspotId = new Map<string, string>()
    let companiesSynced = 0
    for (const company of companies) {
      const name = (company.properties.name ?? '').trim()
      const domain = (company.properties.domain ?? '').trim().toLowerCase() || null
      if (!name && !domain) continue
      const { data: resolved, error } = await supabase.rpc('resolve_company_identity', {
        p_organization_id: organizationId,
        p_name: name || domain || 'Entreprise HubSpot',
        p_domain: domain,
        p_industry: company.properties.industry ?? null,
        p_create_if_missing: true,
      }).maybeSingle()
      if (error || !resolved?.company_id) continue
      companyIdByHubspotId.set(company.id, resolved.company_id)
      companiesSynced++
    }

    if (syncJobId) await supabase.from('sync_jobs').update({ current_step: 'Lecture des contacts HubSpot', progress: 60 }).eq('id', syncJobId)
    const contacts = await hubspotContacts(accessToken)
    let contactsSynced = 0
    for (const contact of contacts) {
      const email = cleanEmail(contact.properties.email)
      if (!email) continue
      const fullName = [contact.properties.firstname, contact.properties.lastname].filter(Boolean).join(' ').trim() || email.split('@')[0]
      const linkedHubspotCompanyId = contact.associations?.companies?.results?.[0]?.id
      const companyId = linkedHubspotCompanyId ? companyIdByHubspotId.get(linkedHubspotCompanyId) ?? null : null
      const { error } = await supabase.rpc('resolve_contact_identity', {
        p_organization_id: organizationId,
        p_email: email,
        p_full_name: fullName,
        p_company_id: companyId,
        p_owner_user_id: user.id,
        p_role_title: contact.properties.jobtitle ?? null,
        p_source: 'hubspot',
      }).maybeSingle()
      if (error) continue
      contactsSynced++
    }

    if (syncJobId) await supabase.from('sync_jobs').update({ current_step: 'Finalisation', progress: 90 }).eq('id', syncJobId)
    await supabase.from('connectors').update({
      status: 'connected',
      last_synced_at: new Date().toISOString(),
      metadata: { ...(connector.metadata ?? {}), last_sync: { companies: companiesSynced, contacts: contactsSynced } },
      updated_at: new Date().toISOString(),
    }).eq('id', connector.id)
    if (syncJobId) await supabase.from('sync_jobs').update({ status: 'succeeded', current_step: 'Synchronisation terminée', progress: 100, completed_at: new Date().toISOString(), payload: { provider: 'hubspot', companies: companiesSynced, contacts: contactsSynced } }).eq('id', syncJobId)

    return json({ success: true, companies: companiesSynced, contacts: contactsSynced })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Synchronisation HubSpot impossible'
    if (syncJobId) await supabase.from('sync_jobs').update({ status: 'failed', current_step: 'Échec de la synchronisation', error_code: 'HUBSPOT_SYNC_FAILED', error_message: message, completed_at: new Date().toISOString() }).eq('id', syncJobId)
    return json({ error: message }, 500)
  }
})
