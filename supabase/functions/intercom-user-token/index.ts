// Identité sécurisée Intercom : le navigateur fournit uniquement son JWT
// Supabase. L'API vérifie la session puis signe elle-même un jeton Intercom
// court, sans jamais exposer INTERCOM_API_SECRET au client.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import jwt from 'npm:jsonwebtoken@9.0.2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, private',
    },
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization?.startsWith('Bearer ')) return json({ error: 'Authentification requise' }, 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
    const { data: { user }, error } = await supabase.auth.getUser(authorization.slice('Bearer '.length))
    if (error || !user) return json({ error: 'Session invalide' }, 401)

    const secret = Deno.env.get('INTERCOM_API_SECRET')
    if (!secret) throw new Error('INTERCOM_API_SECRET manquant')

    const metadata = user.user_metadata ?? {}
    const name = String(metadata.full_name ?? metadata.name ?? metadata.user_name ?? '').trim()
    const token = jwt.sign({
      user_id: user.id,
      email: user.email,
      ...(name ? { name } : {}),
    }, secret, {
      algorithm: 'HS256',
      expiresIn: '1h',
    })

    return json({ token, expires_in: 3600 })
  } catch (error) {
    console.error('Création du jeton Intercom impossible', error instanceof Error ? error.message : error)
    return json({ error: 'Identité Intercom indisponible' }, 500)
  }
})
