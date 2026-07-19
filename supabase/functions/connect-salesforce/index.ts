// OAuth Salesforce — connexion CRM (spec Connecteurs, maquette Tohu).
// POST (authentifié, JWT) : action=start → renvoie l'URL d'autorisation Salesforce.
// GET  (public, appelé par Salesforce en retour d'auth) : ?code=&state= → échange le code, stocke le token + instance_url, redirige vers l'app.
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
// Domaine de login Salesforce — https://login.salesforce.com (prod) ou https://test.salesforce.com (sandbox).
// Certains orgs utilisent un "My Domain" dédié (https://votreorg.my.salesforce.com) : à configurer via SALESFORCE_LOGIN_URL si besoin.
const LOGIN_URL = Deno.env.get('SALESFORCE_LOGIN_URL') || 'https://login.salesforce.com';
const SCOPES = 'api refresh_token';

function functionUrl(): string {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  return `${supabaseUrl}/functions/v1/connect-salesforce`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const clientId = Deno.env.get('SALESFORCE_CLIENT_ID');
  const clientSecret = Deno.env.get('SALESFORCE_CLIENT_SECRET');

  // ── GET = callback Salesforce (?code=&state=) ───────────────────────────
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');

    if (oauthError) {
      return Response.redirect(`${APP_URL}/app/connectors?error=salesforce_${encodeURIComponent(oauthError)}`, 302);
    }
    if (!code || !state) return jsonResponse({ error: 'code et state requis' }, 400);
    if (!clientId || !clientSecret) return jsonResponse({ error: 'SALESFORCE_CLIENT_ID/SALESFORCE_CLIENT_SECRET non configurés' }, 500);

    let orgId: string, userId: string;
    try {
      const decoded = JSON.parse(atob(state));
      orgId = decoded.orgId; userId = decoded.userId;
      if (!orgId || !userId) throw new Error('state invalide');
    } catch {
      return Response.redirect(`${APP_URL}/app/connectors?error=salesforce_invalid_state`, 302);
    }

    try {
      const tokenRes = await fetch(`${LOGIN_URL}/services/oauth2/token`, {
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
        console.error('Salesforce token exchange failed:', JSON.stringify(tokenData));
        return Response.redirect(`${APP_URL}/app/connectors?error=salesforce_token_exchange`, 302);
      }

      // Salesforce renvoie instance_url : l'URL réelle de l'org du client (jamais fixe), indispensable pour tous les appels API suivants.
      await (supabase.from('connectors') as any).upsert({
        organization_id: orgId,
        user_id: userId,
        provider: 'salesforce',
        status: 'connected',
        scopes: SCOPES.split(' '),
        metadata: {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          instance_url: tokenData.instance_url,
          token_stored_at: new Date().toISOString(),
        },
        last_synced_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'organization_id,user_id,provider' });

      return Response.redirect(`${APP_URL}/app/connectors?connected=salesforce`, 302);
    } catch (e: any) {
      console.error('Salesforce callback error:', e?.message);
      return Response.redirect(`${APP_URL}/app/connectors?error=salesforce_internal`, 302);
    }
  }

  // ── POST = start (authentifié) → renvoie l'URL d'autorisation ──────────
  if (req.method === 'POST') {
    const auth = req.headers.get('Authorization');
    if (!auth) return jsonResponse({ error: 'Missing authorization' }, 401);
    if (!clientId) return jsonResponse({ error: 'SALESFORCE_CLIENT_ID non configuré côté serveur — voir CONNECTEURS.md' }, 500);

    const { data: { user }, error: userErr } = await supabase.auth.getUser(auth.replace('Bearer ', ''));
    if (userErr || !user) return jsonResponse({ error: 'Unauthorized' }, 401);

    const { organizationId } = await req.json().catch(() => ({}));
    if (!organizationId) return jsonResponse({ error: 'organizationId requis' }, 400);

    const state = btoa(JSON.stringify({ orgId: organizationId, userId: user.id, ts: Date.now() }));
    const authorizeUrl = `${LOGIN_URL}/services/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(functionUrl())}&scope=${encodeURIComponent(SCOPES)}&state=${encodeURIComponent(state)}`;

    return jsonResponse({ url: authorizeUrl });
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
});
