/**
 * track-email-event v1
 * Endpoint sans auth (appele depuis les emails).
 * - type=open  -> retourne un pixel 1x1 transparent + log
 * - type=click -> redirige vers l'URL et log le clic
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PIXEL = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
  0x00, 0xff, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00,
  0x01, 0x00, 0x00, 0x02, 0x00, 0x3b,
]); // GIF 1x1 transparent

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const type = url.searchParams.get('type') ?? 'open';
  const meetingId = url.searchParams.get('meetingId');
  const userId = url.searchParams.get('userId');
  const redirectUrl = url.searchParams.get('redirect');

  if (meetingId && userId) {
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      );
      await (supabase.from('user_behavior_events') as any).insert({
        user_id: userId,
        event_type: type === 'click' ? 'brief_email_clicked' : 'brief_email_opened',
        entity_id: meetingId,
        entity_type: 'meeting',
        metadata: { ip: req.headers.get('x-forwarded-for') ?? null },
        created_at: new Date().toISOString(),
      });
    } catch { /* ignore */ }
  }

  if (type === 'click' && redirectUrl) {
    return new Response(null, {
      status: 302,
      headers: {
        'Location': decodeURIComponent(redirectUrl),
        'Cache-Control': 'no-store',
      },
    });
  }

  return new Response(PIXEL, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    },
  });
});

