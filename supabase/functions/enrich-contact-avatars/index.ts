// Enrichit les photos des fiches Personne (contacts) qui n'en ont pas encore,
// par email, indépendamment de Google. Cascade préférée :
//   1) Gravatar (vraie photo de profil liée à l'email) ;
//   2) logo de l'entreprise (déduit du domaine email, hors domaines perso) ;
//   3) sinon rien → l'UI affiche les initiales.
//
// Les images sont TÉLÉCHARGÉES et AUTO-HÉBERGÉES dans le bucket public
// `contact-avatars` (fiabilité + vie privée : aucun appel tiers depuis le
// navigateur des membres). On ne remplit que les avatars manquants ; les
// contacts suivis (visibles dans la liste Personnes) sont traités en priorité.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

const AVATAR_BUCKET = 'contact-avatars'
// Borne le temps d'un run (chaque contact = 1 à 2 requêtes réseau). Les runs
// suivants poursuivent, puisqu'on ne traite que les avatars manquants.
const MAX_CONTACTS_PER_RUN = 250
const MAX_IMAGE_BYTES = 5_000_000

// Domaines d'email personnels / partagés : pas de logo d'entreprise pertinent.
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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  let syncJobId: string | null = null
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Authentification requise' }, 401)
    const { data: { user }, error: userError } = await supabase.auth.getUser(authorization.replace('Bearer ', ''))
    if (userError || !user) return json({ error: 'Session invalide' }, 401)
    const { organizationId } = await request.json().catch(() => ({}))
    if (!organizationId) return json({ error: 'Paramètres invalides' }, 400)
    const { data: membership } = await supabase.from('memberships').select('id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle()
    if (!membership) return json({ error: 'Accès refusé' }, 403)

    const { data: job } = await supabase.from('sync_jobs').insert({
      organization_id: organizationId, user_id: user.id, job_type: 'contact_avatars_enrich',
      status: 'running', current_step: 'Recherche des photos de contacts', progress: 10, started_at: new Date().toISOString(), payload: {},
    }).select('id').single()
    syncJobId = job?.id ?? null

    // Avatars manquants uniquement, contacts suivis en priorité (liste Personnes).
    const { data: contactsData, error: contactsError } = await supabase.from('contacts')
      .select('id,email,is_tracked')
      .eq('organization_id', organizationId)
      .is('merged_into_contact_id', null)
      .is('avatar_url', null)
      .not('email', 'is', null)
      .order('is_tracked', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(MAX_CONTACTS_PER_RUN)
    if (contactsError) throw contactsError
    const contacts = (contactsData ?? []) as Array<{ id: string; email: string | null }>

    const logoByDomain = new Map<string, string | null>()
    let gravatarCount = 0
    let logoCount = 0
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i]
      const email = String(contact.email ?? '').trim().toLowerCase()
      if (!email.includes('@')) continue

      // 1) Gravatar (vraie photo). d=404 → 404 s'il n'y a pas d'avatar pour cet email.
      const hash = await sha256Hex(email)
      const gravatar = await fetchAndStore(supabase, `${organizationId}/${contact.id}`, `https://www.gravatar.com/avatar/${hash}?d=404&s=256`)
      if (gravatar) {
        await supabase.from('contacts').update({ avatar_url: gravatar }).eq('id', contact.id)
        gravatarCount++
      } else {
        // 2) Logo/marque d'entreprise via le domaine email — service d'icônes
        //    DuckDuckGo : renvoie l'icône du site (200) ou 404 si le domaine est
        //    inconnu (donc jamais de placeholder générique). Mutualisé par domaine.
        const domain = corporateDomain(email)
        if (domain) {
          let logoUrl = logoByDomain.get(domain)
          if (logoUrl === undefined) {
            logoUrl = await fetchAndStore(supabase, `${organizationId}/logos/${domain}`, `https://icons.duckduckgo.com/ip3/${domain}.ico`)
            logoByDomain.set(domain, logoUrl)
          }
          if (logoUrl) {
            await supabase.from('contacts').update({ avatar_url: logoUrl }).eq('id', contact.id)
            logoCount++
          }
        }
      }

      if (syncJobId && i % 25 === 0) {
        await supabase.from('sync_jobs').update({ progress: 10 + Math.round((i / Math.max(1, contacts.length)) * 85) }).eq('id', syncJobId)
      }
    }

    const avatars = gravatarCount + logoCount
    if (syncJobId) await supabase.from('sync_jobs').update({
      status: 'succeeded', current_step: 'Terminé', progress: 100, completed_at: new Date().toISOString(),
      payload: { avatars, gravatar: gravatarCount, logos: logoCount, processed: contacts.length },
    }).eq('id', syncJobId)
    return json({ success: true, avatars, gravatar: gravatarCount, logos: logoCount, processed: contacts.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Enrichissement impossible'
    if (syncJobId) await supabase.from('sync_jobs').update({ status: 'failed', current_step: 'Échec', error_code: 'CONTACT_AVATARS_ENRICH_FAILED', error_message: message.slice(0, 500), completed_at: new Date().toISOString() }).eq('id', syncJobId)
    return json({ error: message }, 500)
  }
})
