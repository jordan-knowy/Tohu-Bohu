// Antisèche (ACT-88, à chaque réunion). CRON horaire : réunions ~2 h avant le
// début, sur comptes suivis → antisèche (engagements ouverts + profil
// comportemental « qui sera en face » + entreprise) envoyée au propriétaire,
// dédup `antiseche:{meetingId}` (une seule fois par réunion).
// Test : { contactId } → antisèche synthétique « dans 2 h » envoyée à l'appelant.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendEmail } from '../_shared/email.ts'
import { renderAntiseche, type AntEngagement, type AntPerson, type AntisecheData } from '../_shared/email-templates/antiseche.ts'

const DAY = 86_400_000
const DAYS_LONG = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const frDate = (t: number) => { const d = new Date(t); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` }
function cleanLabel(content: string): string {
  let s = String(content ?? '').replace(/^\s*nous\s*:\s*/i, '').replace(/\s*[—-]\s*échéance.*$/i, '').trim()
  if (s.length > 60) s = s.slice(0, 58).trimEnd() + '…'
  return s
}
async function appSecret(supabase: any, name: string): Promise<string | null> {
  const { data } = await supabase.from('app_secrets').select('value').eq('name', name).maybeSingle()
  return (data as { value?: string } | null)?.value ?? null
}

function deriveProfile(name: string, role: string | null, cp: any): AntPerson {
  const data = cp?.cognitive_profile_data ?? {}
  const inter = cp?.source_interaction_count ?? 0
  const conf = cp?.global_confidence ?? null
  const ip = data.interpersonal ?? {}, ax = data.primary_axes ?? {}
  const warmth = ip.warmth?.score ?? 50, warmthLow = warmth < 45, warmthHigh = warmth > 60
  const fast = (ax.rythme?.raw_score ?? 50) >= 60, direct = (ax.registre?.raw_score ?? 50) >= 60
  const style = `<strong>${esc(ip.assertiveness?.label ?? 'Équilibré')}</strong> · ${fast ? 'rythme rapide' : 'rythme posé'}, ${direct ? 'registre direct et factuel' : 'registre nuancé'}, ${warmthLow ? 'faible chaleur relationnelle' : warmthHigh ? 'chaleureux' : 'chaleur neutre'}`
  const faire = warmthLow ? 'Aller droit au but, structurer en étapes concrètes, t’appuyer sur les faits' : 'Prendre le temps du lien avant d’entrer dans le fond'
  const eviter = warmthLow ? 'Le registre relationnel ou émotionnel — il attend de l’efficacité' : 'Aller trop vite au transactionnel — soigne d’abord la relation'
  return {
    name, role: role ?? 'À qualifier', modeLabel: cp?.cognitive_mode ?? 'Profil', style, faire, eviter,
    stats: `Profil sur ${inter} interaction(s)${conf ? ` · confiance ${conf}%` : ''}`,
  }
}
function engFor(commitments: any[]): AntEngagement[] {
  const now = Date.now(), twoW = now - 14 * DAY
  return (commitments ?? []).slice(0, 3).map((e) => {
    const created = new Date(e.observed_at ?? e.created_at).getTime()
    const overdue = created < twoW
    return { icon: (overdue ? 'slipped' : 'inprogress') as 'slipped' | 'inprogress', title: cleanLabel(e.content), sub: `promis le ${frDate(created)}`, badge: overdue ? `glissé · ${Math.round((now - created) / DAY)} j` : 'en cours' }
  })
}

async function contactBundle(supabase: any, orgId: string, contactId: string): Promise<{ person: AntPerson; engagements: AntEngagement[]; companyId: string | null }> {
  const [{ data: c }, { data: cp }, { data: commitments }] = await Promise.all([
    supabase.from('contacts').select('full_name,role_title,company_id').eq('id', contactId).maybeSingle(),
    supabase.from('cognitive_profiles').select('cognitive_mode,executive_summary,global_confidence,source_interaction_count,cognitive_profile_data').eq('organization_id', orgId).eq('contact_id', contactId).eq('profile_version', 1).maybeSingle(),
    supabase.from('person_memory_entries').select('content,observed_at,created_at').eq('organization_id', orgId).eq('contact_id', contactId).eq('entry_type', 'commitment').is('resolved_at', null).order('created_at', { ascending: true }).limit(5),
  ])
  return { person: deriveProfile(c?.full_name ?? 'Contact', c?.role_title ?? null, cp), engagements: engFor(commitments ?? []), companyId: c?.company_id ?? null }
}

async function buildAntiseche(supabase: any, orgId: string, contactIds: string[], meta: { when: string; title: string; headerRight: string }): Promise<AntisecheData> {
  const bundles = []
  for (const id of contactIds.slice(0, 2)) bundles.push(await contactBundle(supabase, orgId, id))
  const engagements = bundles.flatMap((b) => b.engagements).slice(0, 3)
  const companyId = bundles.map((b) => b.companyId).find(Boolean) ?? null
  let companyName = 'Entreprise', watch = 'Aucune actualité captée sur ce compte depuis votre dernier échange.'
  if (companyId) {
    const [{ data: co }, { data: sig }] = await Promise.all([
      supabase.from('companies').select('name').eq('id', companyId).maybeSingle(),
      supabase.from('company_signals').select('title,summary,source,observed_at').eq('organization_id', orgId).eq('company_id', companyId).order('observed_at', { ascending: false }).limit(1),
    ])
    companyName = co?.name ?? companyName
    if (sig?.[0]) watch = `<strong>${esc(sig[0].title ?? sig[0].summary ?? '')}</strong> <span style="color:#9A93AC;font-size:12px;">${esc(sig[0].source ?? '')}</span>`
    else watch += ' <span style="color:#9A93AC;font-size:12px;">On te le dit plutôt que d’inventer.</span>'
  }
  const first = (bundles[0]?.person.name ?? '').split(' ')[0]
  const openingList = engagements.length ? engagements.map((e) => e.title.toLowerCase()).join(', ') : 'les points ouverts'
  return {
    subject: `${meta.when.replace(/·.*/, '').trim()} · ${bundles.map((b) => b.person.name).join(' + ')} — ${meta.title}`,
    preheader: engagements.length ? `${engagements.length} engagement(s) sur la table.` : 'Prépa réunion.',
    headerRight: meta.headerRight, when: meta.when, title: meta.title,
    who: `${bundles.map((b) => b.person.name).join(', ')}, en face.`,
    relationTag: undefined,
    engagements, engagementsNote: engagements.length ? 'Traités dans l’ordre, tu sors avec des réponses.' : undefined,
    people: bundles.map((b) => b.person),
    company: { name: companyName, sub: 'Secteur & effectif — à confirmer', watch },
    opening: { text: `«&nbsp;${esc(first || 'Bonjour')}, pour être efficace : on cadre ${esc(openingList)}.&nbsp;»`, note: 'Calé sur son profil et les engagements encore ouverts.' },
    computedNote: 'Calculé par Tohu · sources : Gmail, Read AI',
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const body = await request.json().catch(() => ({} as any))
    const cronSecret = request.headers.get('x-cron-secret')

    // ── CRON : réunions à T−24 h ──────────────────────────────────────────────
    if (cronSecret) {
      const expected = await appSecret(supabase, 'monitor_cron')
      if (!expected || cronSecret !== expected) return json({ error: 'Cron secret invalide' }, 401)
      // Hook de validation ciblée (déclenché en SQL) : une antisèche « dans 2 h » sur un contact.
      if (body?.testContactId && body?.testOrg && body?.testEmail) {
        const data = await buildAntiseche(supabase, body.testOrg, [body.testContactId], { when: 'Aujourd’hui dans 2 h · 30 min · visio', title: 'Réunion à venir', headerRight: 'Antisèche · dans 2 h' })
        const rendered = renderAntiseche(data)
        const res = await sendEmail({ supabase, userId: body.testUserId, organizationId: body.testOrg, type: 'antiseche', to: body.testEmail, subject: `[Test réel] ${rendered.subject}`, html: rendered.html, dedupeKey: `antiseche-test:${Date.now()}` })
        return json({ ok: true, mode: 'cron-test', ...res })
      }
      // Fenêtre ~2 h avant le début (cron horaire → chaque réunion tombe dans un
      // seul passage ; la dédup `antiseche:{meetingId}` garantit un envoi unique).
      const from = new Date(Date.now() + 1.5 * 3600_000).toISOString()
      const to = new Date(Date.now() + 2.5 * 3600_000).toISOString()
      const { data: meetings } = await supabase.from('meetings').select('id,title,starts_at,company_id,owner_user_id,organization_id').gte('starts_at', from).lte('starts_at', to).limit(50)
      let sent = 0, skipped = 0
      for (const m of (meetings ?? [])) {
        try {
          if (!m.owner_user_id) { skipped++; continue }
          const { data: parts } = await supabase.from('meeting_participants').select('contact_id').eq('meeting_id', m.id).not('contact_id', 'is', null).limit(4)
          const contactIds = (parts ?? []).map((p: any) => p.contact_id)
          if (!contactIds.length) { skipped++; continue }
          const d = new Date(m.starts_at)
          const data = await buildAntiseche(supabase, m.organization_id, contactIds, { when: `${DAYS_LONG[d.getUTCDay()]} ${d.getUTCHours()} h · dans ~2 h · visio`, title: m.title ?? 'Réunion', headerRight: 'Antisèche · dans ~2 h' })
          const { data: u } = await supabase.auth.admin.getUserById(m.owner_user_id)
          const email = u?.user?.email
          if (!email) { skipped++; continue }
          const rendered = renderAntiseche(data)
          const res = await sendEmail({ supabase, userId: m.owner_user_id, organizationId: null, type: 'antiseche', to: email, subject: rendered.subject, html: rendered.html, dedupeKey: `antiseche:${m.id}` })
          if (res.sent) sent++; else skipped++
        } catch { skipped++ }
      }
      return json({ ok: true, mode: 'cron', sent, skipped })
    }

    // ── Test : { contactId } → antisèche « dans 2 h » à l'appelant ─────────────
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Authentification requise' }, 401)
    const { data: { user }, error: userError } = await supabase.auth.getUser(authorization.replace('Bearer ', ''))
    if (userError || !user) return json({ error: 'Session invalide' }, 401)
    const { organizationId, contactId, to } = body
    if (!organizationId || !contactId) return json({ error: 'organizationId et contactId requis' }, 400)
    const { data: membership } = await supabase.from('memberships').select('id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle()
    if (!membership) return json({ error: 'Accès refusé' }, 403)
    const data = await buildAntiseche(supabase, organizationId, [contactId], { when: 'Aujourd’hui dans 2 h · 30 min · visio', title: 'Réunion à venir', headerRight: 'Antisèche · dans 2 h' })
    const rendered = renderAntiseche(data)
    const recipient = (typeof to === 'string' && to.includes('@')) ? to : user.email
    const res = await sendEmail({ supabase, userId: user.id, organizationId, type: 'antiseche', to: recipient!, subject: `[Test] ${rendered.subject}`, html: rendered.html, dedupeKey: `antiseche-test:${user.id}:${Date.now()}` })
    return json({ ok: true, mode: 'test', ...res })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Envoi impossible' }, 500)
  }
})
