// Nurturing (ACT-89). CRON quotidien : selon l'ancienneté du compte (J+0/3/7/14/21),
// envoie le mail d'onboarding correspondant, conditionné à l'état réel (déjà connecté ?
// équipe invitée ?). Dédup `onb_{step}:{user}`. onb_5 (J+21) = renvoi de onb_4.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendEmail, type EmailType } from '../_shared/email.ts'
import { renderNurturing, type NurtureStep } from '../_shared/email-templates/nurturing.ts'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
async function appSecret(supabase: any, name: string): Promise<string | null> {
  const { data } = await supabase.from('app_secrets').select('value').eq('name', name).maybeSingle()
  return (data as { value?: string } | null)?.value ?? null
}
// Jour d'ancienneté → étape de la séquence.
const DAY_TO_STEP: Record<number, NurtureStep> = { 0: 1, 3: 2, 7: 3, 14: 4, 21: 5 }

async function assembleData(supabase: any, userId: string, organizationId: string) {
  const [{ data: profile }, { count: contacts }, { count: companies }] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
    supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).is('merged_into_contact_id', null),
    supabase.from('companies').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId),
  ])
  const firstName = String(profile?.full_name ?? '').trim().split(' ')[0] || undefined
  return { firstName, contacts: contacts ?? undefined, companies: companies ?? undefined }
}

// Conditions d'envoi selon l'état (ne pas relancer une action déjà faite).
async function shouldSend(supabase: any, step: NurtureStep, organizationId: string): Promise<boolean> {
  if (step === 2) return true
  const { count: connected } = await supabase.from('connectors').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'connected')
  if (step === 1) return (connected ?? 0) === 0
  if (step === 3) return (connected ?? 0) < 2
  // 4 & 5 : équipe pas encore invitée (un seul membre).
  const { count: members } = await supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId)
  return (members ?? 0) <= 1
}

async function sendStep(supabase: any, userId: string, organizationId: string, email: string, step: NurtureStep): Promise<boolean> {
  const { data: pref } = await supabase.from('email_preferences').select('unsubscribed_all,onboarding_enabled').eq('user_id', userId).maybeSingle()
  if (pref?.unsubscribed_all || pref?.onboarding_enabled === false) return false
  if (!(await shouldSend(supabase, step, organizationId))) return false
  const data = await assembleData(supabase, userId, organizationId)
  const rendered = renderNurturing(step, data)
  const type = (`onb_${step}` as EmailType)
  const res = await sendEmail({ supabase, userId, organizationId, type, to: email, subject: rendered.subject, html: rendered.html, dedupeKey: `onb_${step}:${userId}` })
  return res.sent
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const body = await request.json().catch(() => ({} as any))
    const cronSecret = request.headers.get('x-cron-secret')
    if (!cronSecret) return json({ error: 'Réservé au cron' }, 401)
    const expected = await appSecret(supabase, 'monitor_cron')
    if (!expected || cronSecret !== expected) return json({ error: 'Cron secret invalide' }, 401)

    // Hook test : { testStep, testEmail, testUserId, testOrg } → envoie l'étape.
    if (body?.testStep && body?.testEmail && body?.testUserId && body?.testOrg) {
      const data = await assembleData(supabase, body.testUserId, body.testOrg)
      const rendered = renderNurturing(body.testStep as NurtureStep, data)
      const res = await sendEmail({ supabase, userId: body.testUserId, organizationId: body.testOrg, type: (`onb_${body.testStep}` as EmailType), to: body.testEmail, subject: `[Test] ${rendered.subject}`, html: rendered.html, dedupeKey: `onb-test:${Date.now()}` })
      return json({ ok: true, mode: 'test', ...res })
    }

    const { data: members } = await supabase.from('memberships').select('user_id,organization_id')
    let sent = 0, skipped = 0
    for (const m of (members ?? [])) {
      try {
        const { data: u } = await supabase.auth.admin.getUserById(m.user_id)
        const created = u?.user?.created_at ? new Date(u.user.created_at) : null
        const email = u?.user?.email
        if (!created || !email) { skipped++; continue }
        const days = Math.floor((Date.now() - created.getTime()) / 86_400_000)
        const step = DAY_TO_STEP[days]
        if (!step) { skipped++; continue }
        const ok = await sendStep(supabase, m.user_id, m.organization_id, email, step)
        if (ok) sent++; else skipped++
      } catch { skipped++ }
    }
    return json({ ok: true, mode: 'cron', sent, skipped })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Envoi impossible' }, 500)
  }
})
