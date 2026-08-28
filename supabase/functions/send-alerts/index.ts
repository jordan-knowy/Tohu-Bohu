// Alertes (ACT-88, max 3/sem — plafond appliqué par le wrapper). CRON : repère les
// signaux entreprise forts et récents sur comptes suivis et envoie une alerte aux
// membres (dédup `alerte:{signalId}:{user}`). Test : { testAlerteEmail } → exemple.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendEmail } from '../_shared/email.ts'
import { renderAlerte, type AlerteData } from '../_shared/email-templates/alerte.ts'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
async function appSecret(supabase: any, name: string): Promise<string | null> {
  const { data } = await supabase.from('app_secrets').select('value').eq('name', name).maybeSingle()
  return (data as { value?: string } | null)?.value ?? null
}
// company_signals.confidence est stocké 0-1 (colonne numeric(3,2), voir
// monitor-company-news) — un seuil par défaut de 70 comparait une fraction (0.6)
// à une échelle 0-100 et bloquait donc TOUTE alerte, silencieusement, pour
// toujours. monitor-company-news écrit aujourd'hui une confiance fixe de 0.6
// (pas de scoring différencié par signal) : le seuil doit rester à ce niveau ou
// en dessous pour laisser passer un signal réel.
const CONFIDENCE_MIN = Number(Deno.env.get('ALERT_CONFIDENCE_MIN') ?? 0.6)

const FAMILY: Record<string, { tag: string; color: 'red' | 'green' | 'blue'; impact: string }> = {
  mobility: { tag: 'Mobilité', color: 'red', impact: 'Ton point d’entrée bouge. Sécurise le lien avant son départ, ou identifie dès maintenant son remplaçant.' },
  funding: { tag: 'Croissance', color: 'green', impact: 'Budget frais du côté du compte. C’est le moment de remettre sur la table l’extension que tu gardais pour plus tard.' },
  growth: { tag: 'Croissance', color: 'green', impact: 'Le compte accélère. Repositionne-toi comme partenaire de cette croissance.' },
  market: { tag: 'Marché', color: 'blue', impact: 'Le contexte concurrentiel du compte change. Ajuste ton discours de valeur en conséquence.' },
  risk: { tag: 'Risque', color: 'red', impact: 'Signal de risque sur le compte. Anticipe avant que ça touche votre relation.' },
}
function familyFor(f: string) { return FAMILY[String(f ?? '').toLowerCase()] ?? { tag: 'Signal', color: 'blue' as const, impact: 'À surveiller de près sur ce compte.' } }

const SAMPLE_ALERTE: AlerteData = {
  subject: 'Erwan Lefèvre quitte Adivisa Techno',
  preheader: '2 sources concordantes. Il est ton seul point d’entrée sur le compte — et il arrive DG ailleurs.',
  tag: { text: 'Mobilité', color: 'red' },
  title: 'Erwan Lefèvre quitte Adivisa Techno',
  who: 'Adivisa Techno · ton seul point d’entrée sur le compte',
  proof: ['Nouveau poste <strong>Directeur Général</strong> annoncé chez Sarona Group, effet septembre.', 'Profil LinkedIn mis à jour il y a 3 jours, confirmé par la presse RCS.'],
  source: 'LinkedIn + presse RCS · 2 sources',
  impact: 'Il est ton <strong>unique point d’entrée</strong> sur Adivisa. Prends contact avant son départ pour être introduit à son successeur — sinon la relation repart de zéro.',
  cta: { label: 'Ouvrir la fiche', url: 'https://tohu.co/app/home' },
  computedNote: 'Détecté par la veille Tohu · 2 sources',
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

    // Hook test : envoie l'exemple d'alerte.
    if (body?.testAlerteEmail && body?.testUserId) {
      const rendered = renderAlerte(SAMPLE_ALERTE)
      const res = await sendEmail({ supabase, userId: body.testUserId, organizationId: body.testOrg ?? null, type: 'alerte', to: body.testAlerteEmail, subject: `[Test] ${rendered.subject}`, html: rendered.html, dedupeKey: `alerte-test:${Date.now()}` })
      return json({ ok: true, mode: 'test', ...res })
    }

    // Signaux forts récents (3 j) sur comptes suivis, non rejetés.
    const since = new Date(Date.now() - 3 * 86_400_000).toISOString()
    const { data: signals } = await supabase.from('company_signals')
      .select('id,organization_id,company_id,family,title,summary,source,source_url,confidence,observed_at,companies(name,is_tracked)')
      .gte('observed_at', since).gte('confidence', CONFIDENCE_MIN).neq('status', 'dismissed')
      .order('observed_at', { ascending: false }).limit(50)

    let sent = 0, skipped = 0
    for (const s of (signals ?? [])) {
      if (!s.companies?.is_tracked) { skipped++; continue }
      const fam = familyFor(s.family)
      const data: AlerteData = {
        subject: String(s.title ?? s.summary ?? 'Signal sur un compte suivi'),
        preheader: String(s.summary ?? s.title ?? ''),
        tag: { text: fam.tag, color: fam.color },
        title: String(s.title ?? s.summary ?? 'Nouveau signal'),
        who: `${esc(s.companies?.name ?? 'Compte suivi')}`,
        proof: [esc(s.summary ?? s.title ?? '')].filter(Boolean),
        source: String(s.source ?? 'veille Tohu'),
        impact: fam.impact,
        cta: { label: 'Ouvrir la fiche', url: 'https://tohu.co/app/home' },
        computedNote: `Détecté le ${new Date(s.observed_at).toISOString().slice(0, 10)} · veille Tohu`,
      }
      const rendered = renderAlerte(data)
      const { data: members } = await supabase.from('memberships').select('user_id').eq('organization_id', s.organization_id)
      for (const m of (members ?? [])) {
        try {
          const { data: pref } = await supabase.from('email_preferences').select('unsubscribed_all,alerte_enabled').eq('user_id', m.user_id).maybeSingle()
          if (pref?.unsubscribed_all || pref?.alerte_enabled === false) { skipped++; continue }
          const { data: u } = await supabase.auth.admin.getUserById(m.user_id)
          const email = u?.user?.email
          if (!email) { skipped++; continue }
          const res = await sendEmail({ supabase, userId: m.user_id, organizationId: s.organization_id, type: 'alerte', to: email, subject: rendered.subject, html: rendered.html, dedupeKey: `alerte:${s.id}:${m.user_id}` })
          if (res.sent) sent++; else skipped++
        } catch { skipped++ }
      }
    }
    return json({ ok: true, mode: 'cron', sent, skipped })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Envoi impossible' }, 500)
  }
})
