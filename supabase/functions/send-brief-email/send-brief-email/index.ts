/**
 * send-brief-email v1
 * Envoie un email via Resend quand un brief est prêt.
 * Tracke l'envoi dans user_behavior_events.
 * Inclut un pixel de tracking + lien de clic tracké.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const RESEND_API = 'https://api.resend.com/emails';
const APP_URL = 'https://knowr-ai.netlify.app';
const SUPABASE_URL = 'https://bgmtzwfafcgjklgygvtx.supabase.co';
const FROM_EMAIL = 'Knowy <briefs@notifications.knowy.ai>';

// ── Formateur de date ──────────────────────────────────────────────────────────
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function minutesBefore(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60000);
}

// ── Template HTML email ────────────────────────────────────────────────────────
function buildEmailHtml(opts: {
  meetingTitle: string;
  meetingDate: string;
  meetingTime: string;
  company: string | null;
  participants: Array<{ name: string; role?: string }>;
  confidenceScore: number;
  briefUrl: string;
  trackClickUrl: string;
  trackOpenUrl: string;
  minutesBefore: number;
}): string {
  const { meetingTitle, meetingDate, meetingTime, company, participants, confidenceScore, briefUrl, trackClickUrl, trackOpenUrl, minutesBefore } = opts;

  const urgencyColor = minutesBefore <= 60 ? '#D94F63' : minutesBefore <= 1440 ? '#C47B00' : '#6E50C8';
  const urgencyText = minutesBefore <= 60
    ? `Dans ${minutesBefore} minute${minutesBefore > 1 ? 's' : ''}`
    : minutesBefore <= 1440
    ? `Dans ${Math.round(minutesBefore / 60)}h`
    : `Dans ${Math.round(minutesBefore / 1440)} jour${Math.round(minutesBefore / 1440) > 1 ? 's' : ''}`;

  const participantLines = participants
    .slice(0, 5)
    .map(p => `<li style="margin:4px 0;color:#374151;font-size:14px;">
      <span style="font-weight:600;">${p.name}</span>${p.role ? ` <span style="color:#6B7280;font-size:13px;">— ${p.role}</span>` : ''}
    </li>`)
    .join('');

  const confColor = confidenceScore >= 70 ? '#2EA86A' : confidenceScore >= 40 ? '#C47B00' : '#D94F63';
  const confBar = `<div style="height:6px;background:#E5E7EB;border-radius:9999px;overflow:hidden;margin-top:6px;">
    <div style="height:6px;width:${confidenceScore}%;background:${confColor};border-radius:9999px;"></div>
  </div>`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Votre brief est pret - ${meetingTitle}</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header Knowy -->
        <tr><td style="background:#6E50C8;border-radius:16px 16px 0 0;padding:28px 32px;text-align:center;">
          <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:-0.5px;">Knowy</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.75);margin-top:4px;">Intelligence relationnelle</div>
        </td></tr>

        <!-- Urgency badge -->
        <tr><td style="background:#fff;padding:0 32px;">
          <div style="margin-top:24px;display:inline-block;background:${urgencyColor}15;border:1px solid ${urgencyColor}30;border-radius:999px;padding:6px 14px;">
            <span style="color:${urgencyColor};font-size:13px;font-weight:700;">${urgencyText}</span>
          </div>
        </td></tr>

        <!-- Meeting title -->
        <tr><td style="background:#fff;padding:16px 32px 0;">
          <h1 style="margin:0;font-size:24px;font-weight:900;color:#111827;line-height:1.3;">${meetingTitle}</h1>
          ${company ? `<p style="margin:6px 0 0;font-size:15px;color:#6B7280;">${company}</p>` : ''}
        </td></tr>

        <!-- Date + time -->
        <tr><td style="background:#fff;padding:16px 32px 0;">
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="background:#F5F3FF;border-radius:10px;padding:12px 16px;">
              <div style="font-size:12px;font-weight:600;color:#6E50C8;text-transform:uppercase;letter-spacing:0.5px;">Date</div>
              <div style="font-size:15px;font-weight:700;color:#1F2937;margin-top:2px;">${meetingDate}</div>
              <div style="font-size:13px;color:#6B7280;margin-top:2px;">${meetingTime}</div>
            </div>
          </div>
        </td></tr>

        <!-- Participants -->
        ${participantLines ? `<tr><td style="background:#fff;padding:20px 32px 0;">
          <div style="font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Participants</div>
          <ul style="margin:0;padding-left:18px;">${participantLines}</ul>
        </td></tr>` : ''}

        <!-- Confidence score -->
        <tr><td style="background:#fff;padding:20px 32px 0;">
          <div style="font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">
            Confiance du brief
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:20px;font-weight:900;color:${confColor};">${confidenceScore}%</span>
            <div style="flex:1;">${confBar}</div>
          </div>
        </td></tr>

        <!-- Divider -->
        <tr><td style="background:#fff;padding:24px 32px 0;">
          <div style="height:1px;background:#E5E7EB;"></div>
        </td></tr>

        <!-- CTA -->
        <tr><td style="background:#fff;padding:28px 32px 32px;text-align:center;">
          <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">
            Votre brief Knowy est pret. Consultez le profil de vos interlocuteurs,<br/>
            les alertes relationnelles et les questions a poser avant la reunion.
          </p>
          <a href="${trackClickUrl}"
            style="display:inline-block;background:#6E50C8;color:#fff;text-decoration:none;
                   padding:14px 32px;border-radius:12px;font-size:16px;font-weight:700;
                   letter-spacing:-0.2px;">
            Ouvrir mon brief &rarr;
          </a>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#F9FAFB;border-radius:0 0 16px 16px;padding:20px 32px;text-align:center;border-top:1px solid #E5E7EB;">
          <p style="margin:0;font-size:12px;color:#9CA3AF;">
            Knowr &bull; Intelligence relationnelle &bull;
            <a href="${APP_URL}" style="color:#6E50C8;text-decoration:none;">knowr-ai.netlify.app</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
  <!-- Tracking pixel -->
  <img src="${trackOpenUrl}" width="1" height="1" alt="" style="display:none;"/>
</body>
</html>`;
}

// ── Main handler ───────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const auth = req.headers.get('Authorization');
  if (!auth) return jsonResponse({ error: 'Missing authorization header' }, 401);

  try {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const jwt = auth.replace('Bearer ', '');
  const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const { meetingId, organizationId } = body;
  if (!meetingId || !organizationId) return jsonResponse({ error: 'meetingId et organizationId requis' }, 400);

  // 1. Vérifier que l'email n'a pas déjà été envoyé pour cette réunion
  const { data: alreadySent } = await supabase
    .from('user_behavior_events')
    .select('id')
    .eq('user_id', user.id)
    .eq('event_type', 'brief_email_sent')
    .eq('entity_id', meetingId)
    .maybeSingle();

  if (alreadySent) {
    return jsonResponse({ success: false, message: 'Email deja envoye pour cette reunion', already_sent: true });
  }

  // 2. Charger les infos de la réunion
  const { data: meeting } = await supabase
    .from('meetings')
    .select('id, title, starts_at, company, brief_status, organization_id, owner_user_id')
    .eq('id', meetingId)
    .maybeSingle();

  if (!meeting) return jsonResponse({ error: 'Reunion introuvable' }, 404);
  if (meeting.brief_status !== 'ready' && meeting.brief_status !== 'consulted') {
    return jsonResponse({ error: 'Brief pas encore pret', code: 'BRIEF_NOT_READY', brief_status: meeting.brief_status }, 400);
  }

  // 3. Charger l'email de l'utilisateur
  const { data: profile } = await supabase.from('profiles')
    .select('full_name').eq('id', user.id).maybeSingle();
  const userEmail = user.email;
  if (!userEmail) return jsonResponse({ error: 'Email utilisateur introuvable' }, 400);

  // 4. Charger les participants (hors utilisateur courant)
  const { data: participantRows } = await supabase
    .from('meeting_participants')
    .select('display_name, name, email, role_in_meeting, is_current_user')
    .eq('meeting_id', meetingId)
    .eq('is_current_user', false)
    .limit(5);

  const participants = (participantRows ?? []).map((p: any) => ({
    name: p.display_name || p.name || p.email || 'Participant',
    role: p.role_in_meeting ?? null,
  }));

  // 5. Charger le score de confiance (depuis cognitive_profiles des participants)
  const { data: cpRows } = await supabase
    .from('cognitive_profiles')
    .select('global_confidence')
    .in('contact_id', (participantRows ?? []).map((p: any) => p.contact_id ?? '').filter(Boolean))
    .order('profile_version', { ascending: false })
    .limit(10);

  const confidenceScore = cpRows?.length
    ? Math.round(cpRows.reduce((a: number, b: any) => a + (b.global_confidence ?? 0), 0) / cpRows.length)
    : 65;

  // 6. Construire les URLs de tracking
  const briefUrl = `${APP_URL}/meeting/${meetingId}`;
  const trackClickUrl = `${SUPABASE_URL}/functions/v1/track-email-event?type=click&meetingId=${meetingId}&userId=${user.id}&redirect=${encodeURIComponent(briefUrl)}`;
  const trackOpenUrl = `${SUPABASE_URL}/functions/v1/track-email-event?type=open&meetingId=${meetingId}&userId=${user.id}`;
  const mbefore = minutesBefore(meeting.starts_at);

  // 7. Construire et envoyer l'email via Resend
  const emailHtml = buildEmailHtml({
    meetingTitle: meeting.title,
    meetingDate: formatDate(meeting.starts_at),
    meetingTime: formatTime(meeting.starts_at),
    company: meeting.company ?? null,
    participants,
    confidenceScore,
    briefUrl,
    trackClickUrl,
    trackOpenUrl,
    minutesBefore: mbefore,
  });

  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (!resendApiKey) return jsonResponse({ error: 'RESEND_API_KEY non configure' }, 500);

  const resendRes = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [userEmail],
      subject: `Votre brief est pret - ${meeting.title}`,
      html: emailHtml,
    }),
  });

  const resendData = await resendRes.json();

  if (!resendRes.ok) {
    console.error('Resend error:', JSON.stringify(resendData));
    // Si le domaine n'est pas verifie, tenter avec le domaine de test Resend
    if (resendData?.message?.includes('domain') || resendData?.statusCode === 422) {
      const retryRes = await fetch(RESEND_API, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Knowy <onboarding@resend.dev>',
          to: [userEmail],
          subject: `Votre brief est pret - ${meeting.title}`,
          html: emailHtml,
        }),
      });
      const retryData = await retryRes.json();
      if (!retryRes.ok) {
        return jsonResponse({ error: `Resend: ${retryData?.message ?? 'erreur envoi'}`, code: 'SEND_FAILED' }, 500);
      }
      // Succes via domaine fallback
      await logEmailSent(supabase, user.id, organizationId, meetingId, retryData?.id ?? null, userEmail);
      return jsonResponse({ success: true, message_id: retryData?.id, via: 'fallback_domain' });
    }
    return jsonResponse({ error: `Resend: ${resendData?.message ?? 'erreur envoi'}`, code: 'SEND_FAILED' }, 500);
  }

  // 8. Tracer l'envoi
  await logEmailSent(supabase, user.id, organizationId, meetingId, resendData?.id ?? null, userEmail);

  return jsonResponse({ success: true, message_id: resendData?.id });

  } catch (e: any) {
    console.error('Uncaught:', e?.message);
    return jsonResponse({ error: `Erreur interne: ${e?.message}`, code: 'INTERNAL_ERROR' }, 500);
  }
});

async function logEmailSent(supabase: any, userId: string, orgId: string, meetingId: string, resendId: string | null, sentTo: string) {
  await (supabase.from('user_behavior_events') as any).insert({
    user_id: userId,
    organization_id: orgId,
    event_type: 'brief_email_sent',
    entity_id: meetingId,
    entity_type: 'meeting',
    metadata: { resend_id: resendId, sent_to: sentTo },
    created_at: new Date().toISOString(),
  }).catch(() => {});
}

