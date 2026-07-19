/**
 * sync-outlook-calendar
 * Synchronise le calendrier Outlook/Teams via Microsoft Graph API.
 * Écrit dans les mêmes tables que sync-google-calendar (meetings, meeting_participants).
 * Supporte les réunions Teams (joinUrl détecté automatiquement).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const GRAPH = 'https://graph.microsoft.com/v1.0';

async function graphGet(path: string, token: string) {
  const res = await fetch(`${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (res.status === 401) throw Object.assign(new Error('TOKEN_EXPIRED'), { code: 401 });
  if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text()}`);
  return res.json();
}

// Renouvelle l'access token Microsoft via le refresh_token (scope offline_access).
async function refreshMicrosoftToken(refreshToken: string, supabase: any, organizationId: string, userId: string): Promise<string | null> {
  const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
  const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET');
  if (!clientId || !clientSecret || !refreshToken) return null;
  try {
    const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken,
        grant_type: 'refresh_token', scope: 'openid profile email offline_access Calendars.Read Mail.Read',
      }),
    });
    if (!res.ok) { console.error('MS refresh failed:', res.status); return null; }
    const data = await res.json();
    if (!data.access_token) return null;
    const newRefresh = data.refresh_token ?? refreshToken;
    const { data: conn } = await supabase.from('connectors').select('metadata')
      .eq('organization_id', organizationId).eq('user_id', userId).eq('provider', 'microsoft').maybeSingle();
    await supabase.from('connectors').update({
      metadata: { ...(conn?.metadata ?? {}), access_token: data.access_token, refresh_token: newRefresh, token_stored_at: new Date().toISOString() },
      status: 'connected', updated_at: new Date().toISOString(),
    }).eq('organization_id', organizationId).eq('user_id', userId).eq('provider', 'microsoft');
    return data.access_token;
  } catch (e) { console.error('MS refresh error:', e); return null; }
}

interface GraphEvent {
  id: string;
  subject?: string;
  bodyPreview?: string;
  location?: { displayName?: string };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees?: Array<{
    emailAddress: { address: string; name?: string };
    status?: { response?: string };
    type?: string;
  }>;
  organizer?: { emailAddress: { address: string; name?: string } };
  onlineMeeting?: { joinUrl?: string };
  isOnlineMeeting?: boolean;
  onlineMeetingProvider?: string;
  webLink?: string;
  isCancelled?: boolean;
}

async function syncParticipants(
  supabase: any,
  meetingId: string,
  organizationId: string,
  attendees: GraphEvent['attendees'],
) {
  if (!attendees?.length) return;
  await supabase.from('meeting_participants').delete().eq('meeting_id', meetingId);
  await supabase.from('meeting_participants').insert(
    attendees.map(a => ({
      meeting_id: meetingId,
      organization_id: organizationId,
      email: a.emailAddress.address.toLowerCase(),
      display_name: a.emailAddress.name || a.emailAddress.address.split('@')[0],
      name: a.emailAddress.name || a.emailAddress.address.split('@')[0],
      response_status: a.status?.response || 'none',
      is_current_user: false,
    })),
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing authorization header' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', ''),
  );
  if (userError || !user) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const { organizationId, providerToken: bodyToken, refreshToken: bodyRefresh } = body;

  if (!organizationId) return json({ error: 'organizationId required' }, 400);

  // Résolution du token : body (frais, depuis la session) > connecteur stocké.
  // On capture aussi le refresh_token pour le renouvellement automatique.
  const { data: existingConn } = await supabase
    .from('connectors').select('metadata')
    .eq('organization_id', organizationId).eq('user_id', user.id).eq('provider', 'microsoft').maybeSingle();
  let providerToken: string | null = bodyToken ?? (existingConn?.metadata as any)?.access_token ?? null;
  const refreshToken: string | null = bodyRefresh ?? (existingConn?.metadata as any)?.refresh_token ?? null;

  // Si un refresh_token frais arrive du body, on le persiste tout de suite
  if (bodyRefresh) {
    await supabase.from('connectors').update({
      metadata: { ...(existingConn?.metadata ?? {}), refresh_token: bodyRefresh, ...(bodyToken ? { access_token: bodyToken } : {}), token_stored_at: new Date().toISOString() },
      status: 'connected', updated_at: new Date().toISOString(),
    }).eq('organization_id', organizationId).eq('user_id', user.id).eq('provider', 'microsoft');
  }

  if (!providerToken && refreshToken) {
    providerToken = await refreshMicrosoftToken(refreshToken, supabase, organizationId, user.id);
  }
  if (!providerToken) return json({ error: 'Outlook non connecté ou token introuvable. Reconnectez votre compte.', code: 'TOKEN_MISSING' }, 400);

  const now = new Date();
  const startDateTime = new Date(now.getTime() - 30 * 86400000).toISOString();
  const endDateTime   = new Date(now.getTime() + 60 * 86400000).toISOString();

  // ── 1. Fetch calendar events (paginated, max 250) ─────────────────────────
  let events: GraphEvent[] = [];
  try {
    const params = new URLSearchParams({
      startDateTime,
      endDateTime,
      $top: '250',
      $select: 'id,subject,bodyPreview,location,start,end,attendees,organizer,onlineMeeting,isOnlineMeeting,onlineMeetingProvider,webLink,isCancelled',
      $orderby: 'start/dateTime asc',
    });
    let data;
    try {
      data = await graphGet(`/me/calendarView?${params}`, providerToken);
    } catch (e: any) {
      // Token expiré en cours de route → on rafraîchit une fois et on réessaie
      if (e.code === 401 && refreshToken) {
        const fresh = await refreshMicrosoftToken(refreshToken, supabase, organizationId, user.id);
        if (fresh) { providerToken = fresh; data = await graphGet(`/me/calendarView?${params}`, providerToken); }
        else throw e;
      } else throw e;
    }
    events = data.value ?? [];

    // Pagination
    let next = data['@odata.nextLink'];
    while (next && events.length < 500) {
      const nextData = await fetch(next, {
        headers: { Authorization: `Bearer ${providerToken}`, Accept: 'application/json' },
      }).then(r => r.json());
      events.push(...(nextData.value ?? []));
      next = nextData['@odata.nextLink'];
    }
  } catch (e: any) {
    if (e.code === 401) {
      await supabase.from('connectors')
        .update({ status: 'needs_reauth', updated_at: new Date().toISOString() })
        .eq('organization_id', organizationId).eq('user_id', user.id).eq('provider', 'microsoft');
      return json({ error: 'Outlook token expired. Please reconnect your Microsoft account.', code: 'TOKEN_EXPIRED' }, 401);
    }
    return json({ error: `Graph API error: ${e.message}` }, 502);
  }

  const userDomain = user.email?.split('@')[1]?.toLowerCase() ?? '';

  // ── 2. Filtrer réunions avec participants externes ─────────────────────────
  const meetingEvents = events.filter(e => {
    if (e.isCancelled) return false;
    if (!e.subject) return false;
    const attendees = e.attendees ?? [];
    return attendees.some(a => a.emailAddress.address.toLowerCase() !== user.email?.toLowerCase());
  });

  let created = 0, updated = 0, skipped = 0;

  for (const event of meetingEvents) {
    const startsAt = event.start?.dateTime;
    const endsAt   = event.end?.dateTime;
    if (!startsAt || !endsAt) { skipped++; continue; }

    const attendees = (event.attendees ?? []).filter(
      a => a.emailAddress.address.toLowerCase() !== user.email?.toLowerCase(),
    );

    const externalAttendees = attendees.filter(a => {
      const domain = a.emailAddress.address.split('@')[1]?.toLowerCase() ?? '';
      return domain !== userDomain;
    });

    const isExternal = externalAttendees.length > 0;

    // Lien Teams ou autre visio
    const joinUrl = event.onlineMeeting?.joinUrl ?? null;
    const isTeams = event.onlineMeetingProvider === 'teamsForBusiness' || (joinUrl?.includes('teams.microsoft.com') ?? false);
    const platform = joinUrl ? (isTeams ? 'teams' : 'video') : (event.location?.displayName ? 'physical' : 'video');

    // Entreprise déduite du premier participant externe
    const firstExt = externalAttendees[0];
    const company = firstExt
      ? firstExt.emailAddress.name?.split(' ').slice(-1)[0]
        || firstExt.emailAddress.address.split('@')[1]?.split('.')[0]
        || ''
      : '';

    const meetingData = {
      organization_id: organizationId,
      owner_user_id: user.id,
      user_id: user.id,
      title: event.subject || 'Réunion sans titre',
      company: company || null,
      description: event.bodyPreview || null,
      location: event.location?.displayName || joinUrl || null,
      starts_at: startsAt,
      ends_at: endsAt,
      platform,
      format: joinUrl ? 'video' : (event.location?.displayName ? 'physical' : 'video'),
      is_external: isExternal,
      brief_status: 'to_generate',
      external_event_id: `outlook_${event.id}`,
      external_calendar_url: event.webLink || null,
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from('meetings')
      .select('id, brief_status')
      .eq('organization_id', organizationId)
      .eq('external_event_id', `outlook_${event.id}`)
      .maybeSingle();

    if (existing) {
      const updateData = { ...meetingData };
      if (existing.brief_status && existing.brief_status !== 'to_generate') {
        delete (updateData as any).brief_status;
      }
      await supabase.from('meetings').update(updateData).eq('id', existing.id);
      updated++;
      await syncParticipants(supabase, existing.id, organizationId, attendees);
    } else {
      const { data: newMeeting } = await supabase
        .from('meetings').insert(meetingData).select('id').single();
      if (newMeeting) {
        created++;
        await syncParticipants(supabase, newMeeting.id, organizationId, attendees);
      }
    }
  }

  // ── 3. Marquer le connector comme synchronisé + stocker le token ─────────
  // Le token est nécessaire pour ingest-communication (emails) qui s'exécute après.
  // On relit le connecteur (le refresh_token a pu tourner pendant la sync).
  const { data: latestConn } = await supabase
    .from('connectors').select('metadata')
    .eq('organization_id', organizationId).eq('user_id', user.id).eq('provider', 'microsoft').maybeSingle();

  await supabase.from('connectors')
    .update({
      status: 'connected',
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {
        ...(latestConn?.metadata ?? {}),
        access_token: providerToken,
        token_stored_at: new Date().toISOString(),
      },
    })
    .eq('organization_id', organizationId).eq('user_id', user.id).eq('provider', 'microsoft');

  return json({
    success: true,
    stats: { total_events: events.length, meeting_events: meetingEvents.length, created, updated, skipped },
  });
});

