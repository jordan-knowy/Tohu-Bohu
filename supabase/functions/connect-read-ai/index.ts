// Connecteur Read AI — Read AI ne s'interroge pas en OAuth : il POUSSE un rapport
// (résumé + transcript + participants avec emails) vers une URL webhook après chaque
// réunion. Ce endpoint (authentifié) génère/retourne un secret propre à l'organisation
// et l'URL webhook à coller dans Read AI (Settings → Integrations → Webhooks).
// Idempotent : renvoie toujours le même secret pour une organisation donnée.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function newSecret(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const auth = req.headers.get('Authorization')
    if (!auth) return json({ error: 'Authentification requise' }, 401)
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const { data: { user }, error: userError } = await supabase.auth.getUser(auth.replace('Bearer ', ''))
    if (userError || !user) return json({ error: 'Session invalide' }, 401)
    const { organizationId, signingKey } = await req.json().catch(() => ({}))
    if (!organizationId) return json({ error: 'organizationId requis' }, 400)
    const { data: membership } = await supabase.from('memberships').select('id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle()
    if (!membership) return json({ error: 'Accès refusé' }, 403)

    // Réutilise le secret existant s'il y en a un (idempotent), et préserve les autres
    // champs de metadata (dont la Signing Key déjà enregistrée).
    const { data: existing } = await supabase.from('connectors')
      .select('metadata').eq('organization_id', organizationId).eq('user_id', user.id).eq('provider', 'read_ai').maybeSingle()
    const existingMeta = (existing?.metadata as Record<string, unknown> | null) ?? {}
    const secret = (existingMeta.webhook_secret as string | undefined) ?? newSecret()
    // signingKey fourni ('' = retirer, texte = enregistrer) ; absent = on garde l'existant.
    const nextSigningKey = typeof signingKey === 'string'
      ? (signingKey.trim() || null)
      : ((existingMeta.signing_key as string | null | undefined) ?? null)

    const { error: upsertError } = await supabase.from('connectors').upsert({
      organization_id: organizationId, user_id: user.id, provider: 'read_ai', status: 'connected',
      scopes: [], metadata: { ...existingMeta, webhook_secret: secret, signing_key: nextSigningKey, connected_at: (existingMeta.connected_at as string | undefined) ?? new Date().toISOString() }, updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id,user_id,provider' })
    if (upsertError) return json({ error: upsertError.message }, 500)

    const webhookUrl = `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/read-ai-webhook?token=${secret}`
    return json({ webhookUrl, secret, hasSigningKey: !!nextSigningKey })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Connexion impossible' }, 500)
  }
})
