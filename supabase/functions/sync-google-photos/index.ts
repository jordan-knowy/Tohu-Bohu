// Récupère les photos de profil des contacts via l'API Google People
// (people/me/connections, scope contacts.readonly) et les associe aux fiches Tohu
// PAR EMAIL. On ne remplit que les avatars manquants (jamais d'écrasement d'un
// avatar déjà défini), et on ignore les photos par défaut (silhouette générique).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
  if (!clientId || !clientSecret) throw new Error('Secrets OAuth google manquants')
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  })
  if (!response.ok) throw new Error(`Rafraîchissement google refusé (${response.status})`)
  const data = await response.json()
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? refreshToken, expiresIn: Number(data.expires_in ?? 3600) }
}

async function peopleGet(token: string, url: string): Promise<any | null> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) {
    // Compte perso, API People non activée ou scope absent : pas fatal.
    if (response.status === 403 || response.status === 404) return null
    throw new Error(`Google People API ${response.status}`)
  }
  return response.json()
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const startedAt = new Date().toISOString()
  let syncJobId: string | null = null
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Authentification requise' }, 401)
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const { data: { user }, error: userError } = await supabase.auth.getUser(authorization.replace('Bearer ', ''))
    if (userError || !user) return json({ error: 'Session invalide' }, 401)
    const { organizationId } = await request.json().catch(() => ({}))
    if (!organizationId) return json({ error: 'Paramètres invalides' }, 400)
    const { data: membership } = await supabase.from('memberships').select('id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle()
    if (!membership) return json({ error: 'Accès refusé' }, 403)
    const { data: connector } = await supabase.from('connectors').select('id,metadata').eq('organization_id', organizationId).eq('user_id', user.id).eq('provider', 'google').maybeSingle()
    if (!connector) return json({ error: 'Connecteur Google introuvable.' }, 404)
    const { data: tokenRows, error: tokenError } = await supabase.rpc('get_oauth_tokens_server', { p_connector_id: connector.id })
    const oauth = tokenRows?.[0]
    if (tokenError || !oauth) return json({ error: 'Jetons OAuth absents. Reconnecte Google Workspace.' }, 401)

    const { data: job } = await supabase.from('sync_jobs').insert({
      organization_id: organizationId, connector_id: connector.id, user_id: user.id, provider: 'google',
      job_type: 'google_photos_sync', status: 'running', current_step: 'Lecture des contacts Google', progress: 20, started_at: startedAt, payload: {},
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
    if (!accessToken) throw new Error('Jeton OAuth indisponible')

    // Contacts sans avatar, indexés par email (on ne remplit que les manquants).
    const { data: contactsData } = await supabase.from('contacts')
      .select('id,email').eq('organization_id', organizationId).is('merged_into_contact_id', null)
      .is('avatar_url', null).not('email', 'is', null)
    const contactByEmail = new Map<string, string>()
    for (const contact of (contactsData ?? []) as any[]) {
      const email = String(contact.email ?? '').trim().toLowerCase()
      if (email) contactByEmail.set(email, contact.id)
    }

    // Photo Google par email (on ignore les photos "default" = silhouette générique).
    const photoByEmail = new Map<string, string>()
    let pageToken: string | null = null
    do {
      const url = `https://people.googleapis.com/v1/people/me/connections?personFields=emailAddresses,photos&pageSize=1000&sortOrder=LAST_MODIFIED_DESCENDING${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
      const page = await peopleGet(accessToken, url)
      if (!page) break
      for (const person of (page.connections ?? []) as any[]) {
        const photo = (person.photos ?? []).find((item: any) => item?.url && !item?.default)?.url
        if (!photo) continue
        for (const emailEntry of (person.emailAddresses ?? []) as any[]) {
          const email = String(emailEntry?.value ?? '').trim().toLowerCase()
          if (email && !photoByEmail.has(email)) photoByEmail.set(email, photo)
        }
      }
      pageToken = page.nextPageToken ?? null
    } while (pageToken)

    let photosMatched = 0
    for (const [email, contactId] of contactByEmail) {
      const photo = photoByEmail.get(email)
      if (!photo) continue
      // =s256 : force une taille d'avatar nette et homogène.
      const sized = photo.replace(/=s\d+(-c)?$/, '') + '=s256-c'
      const { error: updateError } = await supabase.from('contacts').update({ avatar_url: sized }).eq('id', contactId)
      if (!updateError) photosMatched++
    }

    if (syncJobId) await supabase.from('sync_jobs').update({ current_step: 'Synchronisation terminée', progress: 100, status: 'succeeded', completed_at: new Date().toISOString(), payload: { photos: photosMatched } }).eq('id', syncJobId)
    return json({ success: true, photos: photosMatched })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Synchronisation impossible'
    if (syncJobId) {
      const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
      await supabase.from('sync_jobs').update({ status: 'failed', current_step: 'Échec de la synchronisation', error_code: 'GOOGLE_PHOTOS_SYNC_FAILED', error_message: message, completed_at: new Date().toISOString() }).eq('id', syncJobId)
    }
    return json({ error: message }, 500)
  }
})
