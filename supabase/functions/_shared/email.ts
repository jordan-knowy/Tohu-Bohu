// Wrapper d'envoi e-mail (Resend) partagé par tous les senders (digest, antisèche,
// alerte, nurturing). Centralise la doctrine d'envoi ACT-88 :
//  - opt-out global + désactivation par type (email_preferences) ;
//  - idempotence via dedupe_key (email_log) : un même e-mail n'est jamais envoyé 2×
//    (digest hebdo = 1 clé/semaine, antisèche = 1 clé/réunion) ;
//  - plafond d'alertes : max N/semaine/utilisateur (défaut 3).
// Aucune intelligence ici : les senders fournissent le HTML déjà rendu.

export type EmailType =
  | 'digest' | 'digest_empty'
  | 'antiseche'
  | 'alerte'
  | 'onb_1' | 'onb_2' | 'onb_3' | 'onb_4' | 'onb_5'

export const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? 'Tohu <bonjour@tohu.co>'
export const EMAIL_REPLY_TO = Deno.env.get('EMAIL_REPLY_TO') ?? 'bonjour@tohu.co'
const PREFERENCES_URL = Deno.env.get('EMAIL_PREFERENCES_URL') ?? 'https://tohu.co/preferences'

// Colonne d'activation par famille d'e-mail (null = toujours autorisé).
const TYPE_TOGGLE: Record<EmailType, string | null> = {
  digest: 'digest_enabled', digest_empty: 'digest_enabled',
  antiseche: 'antiseche_enabled',
  alerte: 'alerte_enabled',
  onb_1: 'onboarding_enabled', onb_2: 'onboarding_enabled', onb_3: 'onboarding_enabled',
  onb_4: 'onboarding_enabled', onb_5: 'onboarding_enabled',
}
// Famille de diffusion (pilotage super-admin : global / type de compte / user).
const DISPATCH_FAMILY: Record<EmailType, string> = {
  digest: 'digest', digest_empty: 'digest', antiseche: 'antiseche', alerte: 'alerte',
  onb_1: 'nurturing', onb_2: 'nurturing', onb_3: 'nurturing', onb_4: 'nurturing', onb_5: 'nurturing',
}

/** Lundi 00:00 UTC de la semaine courante — borne du plafond hebdo d'alertes. */
function startOfIsoWeek(now = new Date()): Date {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const day = date.getUTCDay() || 7 // dimanche = 7
  date.setUTCDate(date.getUTCDate() - (day - 1))
  return date
}

export type SendEmailInput = {
  supabase: any
  userId: string
  organizationId?: string | null
  type: EmailType
  to: string
  subject: string
  html: string
  // Clé d'idempotence. Ex. `digest:{userId}:{isoWeek}`, `antiseche:{meetingId}`,
  // `alerte:{signalId}`, `onb_2:{userId}`. Deux appels avec la même clé = 1 envoi.
  dedupeKey: string
  replyTo?: string
}

export type SendEmailResult =
  | { sent: true; id: string | null }
  | { sent: false; skipped: true; reason: string }

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const { supabase, userId, organizationId = null, type, to, subject, html, dedupeKey } = input

  // 1) Idempotence : déjà envoyé sous cette clé ?
  const { data: already } = await supabase.from('email_log')
    .select('status').eq('dedupe_key', dedupeKey).maybeSingle()
  if (already?.status === 'sent') return { sent: false, skipped: true, reason: 'already_sent' }

  // 2) Préférences : opt-out global + désactivation par type.
  const { data: pref } = await supabase.from('email_preferences')
    .select('unsubscribed_all, digest_enabled, antiseche_enabled, alerte_enabled, onboarding_enabled, alerte_max_per_week')
    .eq('user_id', userId).maybeSingle()
  if (pref?.unsubscribed_all) return { sent: false, skipped: true, reason: 'unsubscribed_all' }
  const toggle = TYPE_TOGGLE[type]
  if (toggle && pref && pref[toggle] === false) return { sent: false, skipped: true, reason: 'type_disabled' }

  // Règles de diffusion pilotées par le super-admin (global / type de compte / user).
  const { data: dispatchAllowed } = await supabase.rpc('email_dispatch_allowed', { p_user_id: userId, p_email_type: DISPATCH_FAMILY[type] })
  if (dispatchAllowed === false) return { sent: false, skipped: true, reason: 'dispatch_disabled' }

  // 3) Plafond d'alertes : max N/semaine/utilisateur (ACT-88).
  if (type === 'alerte') {
    const cap = pref?.alerte_max_per_week ?? 3
    const { count } = await supabase.from('email_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('email_type', 'alerte').eq('status', 'sent')
      .gte('created_at', startOfIsoWeek().toISOString())
    if ((count ?? 0) >= cap) return { sent: false, skipped: true, reason: 'weekly_alert_cap' }
  }

  // 4) Envoi Resend.
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) throw new Error('RESEND_API_KEY manquant')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [to],
      subject,
      html,
      reply_to: input.replyTo ?? EMAIL_REPLY_TO,
      headers: { 'List-Unsubscribe': `<${PREFERENCES_URL}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      tags: [{ name: 'type', value: type }],
    }),
  })
  const payload = await response.json().catch(() => ({}))
  const ok = response.ok

  // 5) Journalisation (upsert sur dedupe_key → l'échec peut être rejoué).
  await supabase.from('email_log').upsert({
    user_id: userId, organization_id: organizationId, email_type: type, dedupe_key: dedupeKey,
    to_email: to, subject, resend_id: (payload as any)?.id ?? null,
    status: ok ? 'sent' : 'failed', error: ok ? null : JSON.stringify(payload).slice(0, 500),
  }, { onConflict: 'dedupe_key' })

  if (!ok) throw new Error(`Resend ${response.status}: ${JSON.stringify(payload).slice(0, 200)}`)
  return { sent: true, id: (payload as any)?.id ?? null }
}

/** Clé de semaine ISO (ex. 2026-W32) pour la dédup du digest hebdo. */
export function isoWeekKey(now = new Date()): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
