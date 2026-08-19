// Enrichit les photos des fiches Personne (contacts) sans avatar, par email.
// Cascade préférée : 1) Gravatar (vraie photo) → 2) logo d'entreprise (icône du
// domaine via DuckDuckGo) → 3) sinon rien (l'UI affiche les initiales). Images
// TÉLÉCHARGÉES et AUTO-HÉBERGÉES dans le bucket public `contact-avatars`.
//
// Deux modes d'appel :
//  - UTILISATEUR (bouton Connecteurs) : JWT + organizationId → l'org du membre ;
//  - CRON (automatique) : en-tête `x-cron-secret` valide → TOUTES les orgs, sans
//    contexte utilisateur. Un cron `tohu-bohu-contact-avatars` l'appelle
//    régulièrement pour que tout nouveau contact récupère sa photo sans action
//    manuelle.
//
// Anti-gaspillage : on horodate chaque tentative (`avatar_checked_at`) et on ne
// re-teste un contact resté sans photo qu'après RECHECK_DAYS — sinon le cron
// re-solliciterait sans fin les mêmes emails qui n'ont ni Gravatar ni logo.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

const AVATAR_BUCKET = 'contact-avatars'
const USER_CAP = 300
const CRON_CAP = 1000
const RUN_DEADLINE_MS = 110_000
const RECHECK_DAYS = 30
const MAX_IMAGE_BYTES = 5_000_000

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.fr', 'hotmail.com', 'hotmail.fr',
  'live.com', 'live.fr', 'msn.com', 'yahoo.com', 'yahoo.fr', 'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.fr',
  'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'laposte.net', 'bbox.fr', 'numericable.fr',
])

function corporateDomain(email: string): string | null {
  const domain = email.split('@')[1]?.trim().toLowerCase() ?? ''
  return domain && domain.includes('.') && !FREE_EMAIL_DOMAINS.has(domain) ? domain : null
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Télécharge une image et la stocke dans le bucket ; renvoie l'URL publique
// stable, ou null si la source n'a pas d'image exploitable (404, non-image…).
async function fetchAndStore(supabase: ReturnType<typeof createClient>, path: string, url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { redirect: 'follow' })
    if (!response.ok) return null
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
    if (!contentType.startsWith('image/')) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null
    const ext = contentType.includes('png') ? 'png'
      : contentType.includes('svg') ? 'svg'
      : contentType.includes('webp') ? 'webp'
      : contentType.includes('gif') ? 'gif'
      : contentType.includes('icon') ? 'ico'
      : 'jpg'
    const fullPath = `${path}.${ext}`
    const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(fullPath, bytes, { contentType, upsert: true })
    if (error) return null
    const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(fullPath)
    return data?.publicUrl || null
  } catch {
    return null
  }
}

type ContactRow = { id: string; email: string | null; organization_id: string }

async function processContacts(
  supabase: ReturnType<typeof createClient>,
  rows: ContactRow[],
  deadline: number,
): Promise<{ processed: number; gravatar: number; logos: number; none: number }> {
  const logoByKey = new Map<string, string | null>()
  let processed = 0, gravatar = 0, logos = 0, none = 0
  for (const c of rows) {
    if (Date.now() > deadline) break
    processed++
    const now = new Date().toISOString()
    const email = String(c.email ?? '').trim().toLowerCase()
    if (!email.includes('@')) { await supabase.from('contacts').update({ avatar_checked_at: now }).eq('id', c.id); none++; continue }
    const org = c.organization_id

    // 1) Gravatar (vraie photo) — d=404 → 404 s'il n'y a pas d'avatar pour cet email.
    let url = await fetchAndStore(supabase, `${org}/${c.id}`, `https://www.gravatar.com/avatar/${await sha256Hex(email)}?d=404&s=256`)
    let kind: 'gravatar' | 'logo' = 'gravatar'
    if (!url) {
      // 2) Logo/marque d'entreprise via le domaine (mutualisé par org+domaine).
      const dom = corporateDomain(email)
      if (dom) {
        const key = `${org}|${dom}`
        if (!logoByKey.has(key)) logoByKey.set(key, await fetchAndStore(supabase, `${org}/logos/${dom}`, `https://icons.duckduckgo.com/ip3/${dom}.ico`))
        url = logoByKey.get(key) ?? null
        kind = 'logo'
      }
    }
    if (url) {
      await supabase.from('contacts').update({ avatar_url: url, avatar_checked_at: now }).eq('id', c.id)
      if (kind === 'gravatar') gravatar++; else logos++
    } else {
      await supabase.from('contacts').update({ avatar_checked_at: now }).eq('id', c.id)
      none++
    }
  }
  return { processed, gravatar, logos, none }
}

// Filtre commun : sans avatar, jamais testé OU pas re-testé depuis RECHECK_DAYS.
function applyEligibility(query: any) {
  const recheckBefore = new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString()
  return query
    .is('merged_into_contact_id', null)
    .is('avatar_url', null)
    .not('email', 'is', null)
    .or(`avatar_checked_at.is.null,avatar_checked_at.lt.${recheckBefore}`)
    .order('is_tracked', { ascending: false })
    .order('avatar_checked_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: false })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const deadline = Date.now() + RUN_DEADLINE_MS

  // ── Mode CRON : x-cron-secret valide → toutes les orgs, sans contexte user.
  const cronSecret = request.headers.get('x-cron-secret')
  if (cronSecret) {
    const { data: secretRow } = await supabase.from('app_secrets').select('value').eq('name', 'monitor_cron').maybeSingle()
    if (!secretRow?.value || cronSecret !== secretRow.value) return json({ error: 'Cron secret invalide' }, 401)
    const { data, error } = await applyEligibility(supabase.from('contacts').select('id,email,organization_id')).limit(CRON_CAP)
    if (error) return json({ error: error.message }, 500)
    const result = await processContacts(supabase, (data ?? []) as ContactRow[], deadline)
    return json({ success: true, mode: 'cron', avatars: result.gravatar + result.logos, ...result })
  }

  // ── Mode UTILISATEUR (bouton Connecteurs) : JWT + organizationId.
  const authorization = request.headers.get('Authorization')
  if (!authorization) return json({ error: 'Authentification requise' }, 401)
  const { data: { user }, error: userError } = await supabase.auth.getUser(authorization.replace('Bearer ', ''))
  if (userError || !user) return json({ error: 'Session invalide' }, 401)
  const { organizationId } = await request.json().catch(() => ({}))
  if (!organizationId) return json({ error: 'Paramètres invalides' }, 400)
  const { data: membership } = await supabase.from('memberships').select('id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle()
  if (!membership) return json({ error: 'Accès refusé' }, 403)

  let syncJobId: string | null = null
  try {
    const { data: job } = await supabase.from('sync_jobs').insert({
      organization_id: organizationId, user_id: user.id, job_type: 'contact_avatars_enrich',
      status: 'running', current_step: 'Recherche des photos de contacts', progress: 10, started_at: new Date().toISOString(), payload: {},
    }).select('id').single()
    syncJobId = job?.id ?? null

    const { data, error } = await applyEligibility(supabase.from('contacts').select('id,email,organization_id').eq('organization_id', organizationId)).limit(USER_CAP)
    if (error) throw error
    const result = await processContacts(supabase, (data ?? []) as ContactRow[], deadline)

    if (syncJobId) await supabase.from('sync_jobs').update({
      status: 'succeeded', current_step: 'Terminé', progress: 100, completed_at: new Date().toISOString(),
      payload: { avatars: result.gravatar + result.logos, ...result },
    }).eq('id', syncJobId)
    return json({ success: true, mode: 'user', avatars: result.gravatar + result.logos, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Enrichissement impossible'
    if (syncJobId) await supabase.from('sync_jobs').update({ status: 'failed', current_step: 'Échec', error_code: 'CONTACT_AVATARS_ENRICH_FAILED', error_message: message.slice(0, 500), completed_at: new Date().toISOString() }).eq('id', syncJobId)
    return json({ error: message }, 500)
  }
})
