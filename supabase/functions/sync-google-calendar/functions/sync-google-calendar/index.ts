import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

// Rafraîchit le token Google via le refresh_token stocké et le persiste dans connectors.
// Indispensable pour que la sync calendrier fonctionne >1h après le login (sinon 401).
async function refreshGoogleToken(
  refreshToken: string,
  supabase: any,
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const newToken: string = data.access_token;
    if (!newToken) return null;

    const { data: conn } = await supabase
      .from('connectors')
      .select('metadata')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .eq('provider', 'google')
      .maybeSingle();

    await supabase.from('connectors').update({
      metadata: { ...(conn?.metadata ?? {}), access_token: newToken, stored_at: new Date().toISOString() },
      status: 'connected',
      updated_at: new Date().toISOString(),
    }).eq('organization_id', organizationId).eq('user_id', userId).eq('provider', 'google');

    return newToken;
  } catch {
    return null;
  }
}

function fetchCalendarEvents(token: string, timeMin: string, timeMax: string) {
  return fetch(
    `${GOOGLE_CALENDAR_API}/calendars/primary/events?` +
    `timeMin=${encodeURIComponent(timeMin)}&` +
    `timeMax=${encodeURIComponent(timeMax)}&` +
    `singleEvents=true&` +
    `orderBy=startTime&` +
    `maxResults=250`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
  );
}

interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string; self?: boolean }>;
  organizer?: { email: string; displayName?: string };
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ uri: string; entryPointType: string }> };
  status?: string;
  htmlLink?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  // Auth: Supabase JWT
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'Missing authorization header' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // Verify the user via their JWT
  const jwt = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const { organizationId, providerToken: bodyToken } = body;

  if (!organizationId) return jsonResponse({ error: 'organizationId is required' }, 400);

  // Résolution du token : token de session frais (body) → token stocké → refresh serveur.
  // Rend la sync autonome (plus de dépendance à un login < 1h).
  const { data: connector } = await supabase
    .from('connectors')
    .select('metadata, status')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .eq('provider', 'google')
    .maybeSingle();

  const refreshToken: string | null = (connector?.metadata as any)?.refresh_token ?? null;
  let providerToken: string | null = bodyToken ?? (connector?.metadata as any)?.access_token ?? null;

  if (!providerToken && refreshToken) {
    providerToken = await refreshGoogleToken(refreshToken, supabase, organizationId, user.id);
  }
  if (!providerToken) {
    return jsonResponse({ error: 'providerToken is required — please reconnect your Google account', code: 'TOKEN_MISSING' }, 400);
  }

  // Fetch calendar events from Google Calendar API
  const now = new Date();
  const timeMin = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago
  const timeMax = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ahead

  let events: GoogleEvent[] = [];

  try {
    let calRes = await fetchCalendarEvents(providerToken, timeMin, timeMax);

    // Token expiré → refresh serveur + un seul retry
    let didRefresh = false;
    if (calRes.status === 401 && refreshToken) {
      const refreshed = await refreshGoogleToken(refreshToken, supabase, organizationId, user.id);
      if (refreshed) {
        providerToken = refreshed;
        didRefresh = true;
        calRes = await fetchCalendarEvents(providerToken, timeMin, timeMax);
      }
    }

    if (!calRes.ok) {
      const errText = await calRes.text();
      console.error('Google Calendar API error:', calRes.status, errText);

      if (calRes.status === 401 || calRes.status === 403) {
        if (didRefresh || calRes.status === 403) {
          // Token VALIDE mais accès Agenda refusé (scope Calendar non accordé).
          // Ne PAS casser le connecteur : les emails (scope Gmail) restent synchronisables.
          return jsonResponse({
            error: 'Accès Google Agenda non autorisé (périmètre Calendar non accordé). Les emails restent synchronisés ; reconnectez Google en acceptant l’agenda pour les réunions.',
            code: 'CALENDAR_SCOPE_MISSING',
            events: 0,
          }, 200);
        }
        // Refresh impossible (refresh_token absent/invalide) → vraie panne d'auth → reconnexion
        await supabase
          .from('connectors')
          .update({ status: 'needs_reauth', updated_at: new Date().toISOString() })
          .eq('organization_id', organizationId)
          .eq('user_id', user.id)
          .eq('provider', 'google');

        return jsonResponse({
          error: 'Google token expired. Please sign out and sign back in with Google to refresh your Calendar access.',
          code: 'TOKEN_EXPIRED',
        }, 401);
      }

      return jsonResponse({ error: `Google Calendar API error: ${calRes.status}` }, 502);
    }

    const calData = await calRes.json();
    events = (calData.items || []) as GoogleEvent[];
  } catch (e) {
    console.error('Fetch error:', e);
    return jsonResponse({ error: 'Failed to reach Google Calendar API' }, 502);
  }

  // Filter: only meetings with external attendees
  const meetingEvents = events.filter(e => {
    if (e.status === 'cancelled') return false;
    const attendees = e.attendees || [];
    const hasOthers = attendees.some(a => !a.self);
    return hasOthers && e.summary;
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;
  // Participants externes rencontrés → deviendront des contacts (pour que l'ingestion emails ait des cibles)
  const discovered = new Map<string, string>();

  for (const event of meetingEvents) {
    const startsAt = event.start?.dateTime || event.start?.date;
    const endsAt = event.end?.dateTime || event.end?.date;
    if (!startsAt || !endsAt) { skipped++; continue; }

    const attendees = (event.attendees || []).filter(a => !a.self);
    const externalAttendees = attendees.filter(a => {
      const domain = a.email.split('@')[1] || '';
      const userDomain = user.email?.split('@')[1] || '';
      return domain !== userDomain;
    });
    const isExternal = externalAttendees.length > 0;

    // Mémorise les participants externes exploitables (hors noreply / adresses calendrier)
    for (const a of externalAttendees) {
      const em = (a.email || '').toLowerCase().trim();
      if (!em || em.includes('noreply') || em.includes('no-reply') || em.includes('donotreply')) continue;
      const dom = em.split('@')[1] || '';
      if (!dom || dom.endsWith('calendar.google.com') || dom.endsWith('resource.calendar.google.com')) continue;
      if (!discovered.has(em)) discovered.set(em, a.displayName || em.split('@')[0]);
    }

    // Get video link
    const videoLink = event.hangoutLink ||
      event.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri ||
      null;

    // Get company from first external attendee domain
    const firstExternal = externalAttendees[0];
    const company = firstExternal
      ? firstExternal.displayName?.split(' ').slice(-1)[0] || firstExternal.email.split('@')[1]?.split('.')[0] || ''
      : '';

    // Upsert meeting
    const meetingData = {
      organization_id: organizationId,
      owner_user_id: user.id,
      user_id: user.id,
      title: event.summary || 'Réunion sans titre',
      company: company || null,
      description: event.description || null,
      location: event.location || videoLink || null,
      starts_at: startsAt,
      ends_at: endsAt,
      platform: videoLink ? 'video' : (event.location ? 'physical' : 'video'),
      format: videoLink ? 'video' : (event.location ? 'physical' : 'video'),
      is_external: isExternal,
      brief_status: 'to_generate',
      external_event_id: event.id,
      external_calendar_url: event.htmlLink || null,
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from('meetings')
      .select('id, brief_status')
      .eq('organization_id', organizationId)
      .eq('external_event_id', event.id)
      .maybeSingle();

    if (existing) {
      // Don't overwrite brief_status if already generated
      const updateData = { ...meetingData };
      if (existing.brief_status && existing.brief_status !== 'to_generate') {
        delete (updateData as any).brief_status;
      }
      await supabase.from('meetings').update(updateData).eq('id', existing.id);
      updated++;

      // Update participants
      await syncParticipants(supabase, existing.id, organizationId, attendees);
    } else {
      const { data: newMeeting } = await supabase
        .from('meetings')
        .insert(meetingData)
        .select('id')
        .single();

      if (newMeeting) {
        created++;
        await syncParticipants(supabase, newMeeting.id, organizationId, attendees);
      }
    }
  }

  // ── Auto-création de contacts depuis les participants externes ───────────────
  // Sans ça, ingest-communication n'a aucune cible et n'ingère aucun email.
  let contactsCreated = 0;
  if (discovered.size > 0) {
    const emails = [...discovered.keys()];
    const { data: existing } = await supabase
      .from('contacts')
      .select('email')
      .eq('organization_id', organizationId)
      .in('email', emails);
    const existingSet = new Set((existing ?? []).map((c: any) => (c.email || '').toLowerCase()));
    const rows = emails
      .filter(e => !existingSet.has(e))
      .map(e => ({ organization_id: organizationId, email: e, full_name: discovered.get(e) || e.split('@')[0] }));
    if (rows.length) {
      const { data: ins } = await supabase.from('contacts').insert(rows).select('id');
      contactsCreated = ins?.length ?? 0;
    }
  }

  // Update connector — stocke aussi le token pour que ingest-communication puisse l'utiliser
  const { data: existingConn } = await supabase
    .from('connectors')
    .select('metadata')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .eq('provider', 'google')
    .maybeSingle();

  await supabase
    .from('connectors')
    .update({
      status: 'connected',
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {
        ...(existingConn?.metadata ?? {}),
        access_token: providerToken,
        token_stored_at: new Date().toISOString(),
      },
    })
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .eq('provider', 'google');

  return jsonResponse({
    success: true,
    stats: {
      total_events: events.length,
      meeting_events: meetingEvents.length,
      created,
      updated,
      skipped,
      contacts_created: contactsCreated,
    },
  });
});

async function syncParticipants(
  supabase: ReturnType<typeof createClient>,
  meetingId: string,
  organizationId: string,
  attendees: Array<{ email: string; displayName?: string; responseStatus?: string; self?: boolean }>
) {
  if (!attendees.length) return;

  // Delete existing and re-insert
  await supabase.from('meeting_participants').delete().eq('meeting_id', meetingId);

  const participants = attendees.map(a => ({
    meeting_id: meetingId,
    organization_id: organizationId,
    email: a.email,
    display_name: a.displayName || a.email.split('@')[0],
    name: a.displayName || a.email.split('@')[0],
    response_status: a.responseStatus || 'needsAction',
    is_current_user: false,
  }));

  await supabase.from('meeting_participants').insert(participants);
}

