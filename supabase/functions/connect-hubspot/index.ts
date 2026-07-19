// OAuth HubSpot — connexion CRM (spec Connecteurs, maquette Tohu).
// POST (authentifié, JWT) : action=start → renvoie l'URL d'autorisation HubSpot.
// GET  (public, appelé par HubSpot en retour d'auth) : ?code=&state= → échange le code, stocke le token, redirige vers l'app.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const APP_URL = 'https://tohu-bohu.netlify.app';
const HUBSPOT_AUTH_URL = 'https://app.hubspot.com/oauth/authorize';
const HUBSPOT_TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token';
const SCOPES = 'crm.objects.contacts.read crm.objects.companies.read';

function functionUrl(): string {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  return `${supabaseUrl}/functions/v1/connect-hubspot`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const clientId = Deno.env.get('HUBSPOT_CLIENT_ID');
  const clientSecret = Deno.env.get('HUBSPOT_CLIENT_SECRET');

  // ── GET = callback HubSpot (?code=&state=) ──────────────────────────────
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');

    if (oauthError) {
      return Response.redirect(`${APP_URL}/app/connectors?error=hubspot_${encodeURIComponent(oauthError)}`, 302);
    }
    if (!code || !state) return jsonResponse({ error: 'code et state requis' }, 400);
    if (!clientId || !clientSecret) return jsonResponse({ error: 'HUBSPOT_CLIENT_ID/HUBSPOT_CLIENT_SECRET non configurés' }, 500);

    let orgId: string, userId: string;
    try {
      const decoded = JSON.parse(atob(state));
      orgId = decoded.orgId; userId = decoded.userId;
      if (!orgId || !userId) throw new Error('state invalide');
    } catch {
      return Response.redirect(`${APP_URL}/app/connectors?error=hubspot_invalid_state`, 302);
    }

    try {
      const tokenRes = await fetch(HUBSPOT_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: functionUrl(),
          code,
        }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) {
        console.error('HubSpot token exchange failed:', JSON.stringify(tokenData));
        return Response.redirect(`${APP_URL}/app/connectors?error=hubspot_token_exchange`, 302);
      }

      await (supabase.from('connectors') as any).upsert({
        organization_id: orgId,
        user_id: userId,
        provider: 'hubspot',
        status: 'connected',
        scopes: SCOPES.split(' '),
        metadata: {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_in: tokenData.expires_in,
          token_stored_at: new Date().toISOString(),
        },
        last_synced_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'organization_id,user_id,provider' });

      return Response.redirect(`${APP_URL}/app/connectors?connected=hubspot`, 302);
    } catch (e: any) {
      console.error('HubSpot callback error:', e?.message);
      return Response.redirect(`${APP_URL}/app/connectors?error=hubspot_internal`, 302);
    }
  }

  // ── POST = start (authentifié) → renvoie l'URL d'autorisation ──────────
  if (req.method === 'POST') {
    const auth = req.headers.get('Authorization');
    if (!auth) return jsonResponse({ error: 'Missing authorization' }, 401);
    if (!clientId) return jsonResponse({ error: 'HUBSPOT_CLIENT_ID non configuré côté serveur — voir CONNECTEURS.md' }, 500);

    const { data: { user }, error: userErr } = await supabase.auth.getUser(auth.replace('Bearer ', ''));
    if (userErr || !user) return jsonResponse({ error: 'Unauthorized' }, 401);

    const { organizationId } = await req.json().catch(() => ({}));
    if (!organizationId) return jsonResponse({ error: 'organizationId requis' }, 400);

    const state = btoa(JSON.stringify({ orgId: organizationId, userId: user.id, ts: Date.now() }));
    const authorizeUrl = `${HUBSPOT_AUTH_URL}?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(functionUrl())}&scope=${encodeURIComponent(SCOPES)}&state=${encodeURIComponent(state)}`;

    return jsonResponse({ url: authorizeUrl });
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
});
