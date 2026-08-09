// Digest hebdomadaire (ACT-88, 1×/sem). Trois usages :
//  - CRON (en-tête x-cron-secret) : itère les membres (modèle opt-out), assemble les
//    vraies données de la semaine et envoie ; dédup `digest:{user}:{semaine ISO}`.
//  - { organizationId } (JWT utilisateur) : assemble le digest RÉEL de son org et
//    l'envoie à l'appelant — sert de test « données réelles ».
//  - { test: true } : envoie le digest d'exemple à l'appelant (valide Resend + rendu).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendEmail, isoWeekKey } from '../_shared/email.ts'
import { renderDigest, renderDigestEmpty, SAMPLE_DIGEST } from '../_shared/email-templates/digest.ts'
import { assembleDigest } from './assemble.ts'

const DASHBOARD_URL = 'https://tohu.co/app/home'
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
async function appSecret(supabase: any, name: string): Promise<string | null> {
  const { data } = await supabase.from('app_secrets').select('value').eq('name', name).maybeSingle()
  return (data as { value?: string } | null)?.value ?? null
}

async function sendForUser(supabase: any, userId: string, organizationId: string, email: string): Promise<{ sent: boolean; reason?: string }> {
  const { data, significant } = await assembleDigest(supabase, organizationId, DASHBOARD_URL)
  const rendered = significant ? renderDigest(data) : renderDigestEmpty(data)
  const res = await sendEmail({
    supabase, userId, organizationId, type: significant ? 'digest' : 'digest_empty',
    to: email, subject: rendered.subject, html: rendered.html,
    dedupeKey: `digest:${userId}:${isoWeekKey()}`,
  })
  return res.sent ? { sent: true } : { sent: false, reason: (res as any).reason }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const body = await request.json().catch(() => ({} as any))

    // ── CRON : itère les membres (opt-out par défaut) ─────────────────────────
    const cronSecret = request.headers.get('x-cron-secret')
    if (cronSecret) {
      const expected = await appSecret(supabase, 'monitor_cron')
      if (!expected || cronSecret !== expected) return json({ error: 'Cron secret invalide' }, 401)
      const { data: allMembers } = await supabase.from('memberships').select('user_id,organization_id')
      // onlyUserId : restreint l'envoi à un membre (validation ciblée, sans spammer).
      const members = body?.onlyUserId ? (allMembers ?? []).filter((m: any) => m.user_id === body.onlyUserId) : (allMembers ?? [])
      let sent = 0, skipped = 0
      const errors: string[] = []
      for (const m of (members ?? [])) {
        try {
          const { data: prefRow } = await supabase.from('email_preferences').select('unsubscribed_all,digest_enabled').eq('user_id', m.user_id).maybeSingle()
          if (prefRow?.unsubscribed_all || prefRow?.digest_enabled === false) { skipped++; continue }
          const { data: userData } = await supabase.auth.admin.getUserById(m.user_id)
          const email = userData?.user?.email
          if (!email) { skipped++; continue }
          const result = await sendForUser(supabase, m.user_id, m.organization_id, email)
          if (result.sent) sent++; else skipped++
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error))
        }
      }
      return json({ ok: true, mode: 'cron', week: isoWeekKey(), sent, skipped, errors: errors.slice(0, 5) })
    }

    // ── JWT utilisateur ───────────────────────────────────────────────────────
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Authentification requise' }, 401)
    const { data: { user }, error: userError } = await supabase.auth.getUser(authorization.replace('Bearer ', ''))
    if (userError || !user) return json({ error: 'Session invalide' }, 401)
    const { test, organizationId, to } = body
    const recipient = (typeof to === 'string' && to.includes('@')) ? to : user.email
    if (!recipient) return json({ error: 'Aucune adresse destinataire' }, 400)

    if (test) {
      const { subject, html } = renderDigest(SAMPLE_DIGEST)
      const result = await sendEmail({ supabase, userId: user.id, organizationId: organizationId ?? null, type: 'digest', to: recipient, subject: `[Test] ${subject}`, html, dedupeKey: `digest-test:${user.id}:${Date.now()}` })
      return json({ ok: true, mode: 'test', recipient, ...result })
    }

    if (!organizationId) return json({ error: 'organizationId requis' }, 400)
    const { data: membership } = await supabase.from('memberships').select('id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle()
    if (!membership) return json({ error: 'Accès refusé' }, 403)
    const { data, significant } = await assembleDigest(supabase, organizationId, DASHBOARD_URL)
    const rendered = significant ? renderDigest(data) : renderDigestEmpty(data)
    // Test réel : clé unique pour ne pas être bloqué par la dédup hebdo.
    const result = await sendEmail({ supabase, userId: user.id, organizationId, type: significant ? 'digest' : 'digest_empty', to: recipient, subject: `[Réel] ${rendered.subject}`, html: rendered.html, dedupeKey: `digest-real:${user.id}:${Date.now()}` })
    return json({ ok: true, mode: 'real', significant, recipient, ...result })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Envoi impossible' }, 500)
  }
})
