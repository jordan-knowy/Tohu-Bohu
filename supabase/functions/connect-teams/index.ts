// Consentement admin Microsoft Teams — connexion CRM multi-client (une seule app
// Azure AD multi-tenant appartenant à Tohu-Bohu, chaque client autorise dans SON
// propre tenant). Contrairement à connect-hubspot, aucun jeton utilisateur n'est
// émis ici : seul le tenant_id du client est utile, les appels API se font ensuite
// en client_credentials avec le secret partagé Tohu-Bohu (voir sync-teams-meetings).
//
// POST (authentifié, JWT) : organizationId → renvoie l'URL de consentement admin Microsoft.
// GET  (public, appelé par Microsoft en retour de consentement) : ?tenant=&state=&admin_consent=
//      → enregistre le tenant_id, redirige vers l'app.
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
// Permissions Application demandées à l'admin — le scope v2.0/adminconsent attend
// des URLs Graph complètes, pas juste les noms courts.
const SCOPE = 'https://graph.microsoft.com/OnlineMeetings.Read.All https://graph.microsoft.com/OnlineMeetingTranscript.Read.All';

function functionUrl(): string {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  return `${supabaseUrl}/functions/v1/connect-teams`;
}

/** Pas d'accès pour poser des variables d'environnement Supabase depuis l'agent qui a
 *  développé ceci : les secrets Teams sont donc dans app_secrets (RLS activé, aucune
 *  policy authenticated/anon → accessible uniquement via service_role), même mécanisme
 *  déjà en place pour le secret cron (`monitor_cron`). */
async function appSecret(supabase: ReturnType<typeof createClient>, name: string): Promise<string | null> {
  const { data } = await supabase.from('app_secrets').select('value').eq('name', name).maybeSingle();
  return (data as { value?: string } | null)?.value ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const clientId = await appSecret(supabase, 'teams_sync_client_id');

  // ── GET = retour du consentement admin Microsoft (?tenant=&state=&admin_consent=) ──
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const tenant = url.searchParams.get('tenant');
    const state = url.searchParams.get('state');
    const adminConsent = url.searchParams.get('admin_consent');
    const oauthError = url.searchParams.get('error');

    if (oauthError) {
      return Response.redirect(`${APP_URL}/app/connectors?error=teams_${encodeURIComponent(oauthError)}`, 302);
    }
    if (!state) return jsonResponse({ error: 'state requis' }, 400);

    let orgId: string, userId: string;
    try {
      const decoded = JSON.parse(atob(state));
      orgId = decoded.orgId; userId = decoded.userId;
      if (!orgId || !userId) throw new Error('state invalide');
    } catch {
      return Response.redirect(`${APP_URL}/app/connectors?error=teams_invalid_state`, 302);
    }

    if (adminConsent !== 'True' || !tenant) {
      return Response.redirect(`${APP_URL}/app/connectors?error=teams_consent_declined`, 302);
    }

    try {
      // Pas de jeton à stocker (aucun n'est émis par ce flow) : seul le tenant_id
      // du client est utile, il sert de clé pour les appels client_credentials.
      const { error: connectorError } = await supabase.from('connectors').upsert({
        organization_id: orgId,
        user_id: userId,
        provider: 'teams',
        status: 'connected',
        scopes: SCOPE.split(' '),
        metadata: { tenant_id: tenant, connected_at: new Date().toISOString() },
        last_synced_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'organization_id,user_id,provider' });
      if (connectorError) {
        console.error('Teams connector upsert failed:', connectorError.message);
        return Response.redirect(`${APP_URL}/app/connectors?error=teams_internal`, 302);
      }
      return Response.redirect(`${APP_URL}/app/connectors?connected=teams`, 302);
    } catch (e: any) {
      console.error('Teams callback error:', e?.message);
      return Response.redirect(`${APP_URL}/app/connectors?error=teams_internal`, 302);
    }
  }

  // ── POST = start (authentifié) → renvoie l'URL de consentement admin ──────────
  if (req.method === 'POST') {
    const auth = req.headers.get('Authorization');
    if (!auth) return jsonResponse({ error: 'Missing authorization' }, 401);
    if (!clientId) return jsonResponse({ error: 'TEAMS_SYNC_CLIENT_ID non configuré côté serveur' }, 500);

    const { data: { user }, error: userErr } = await supabase.auth.getUser(auth.replace('Bearer ', ''));
    if (userErr || !user) return jsonResponse({ error: 'Unauthorized' }, 401);

    const { organizationId } = await req.json().catch(() => ({}));
    if (!organizationId) return jsonResponse({ error: 'organizationId requis' }, 400);

    const state = btoa(JSON.stringify({ orgId: organizationId, userId: user.id, ts: Date.now() }));
    // "organizations" : point d'entrée générique pour tout tenant professionnel/scolaire —
    // "common" est refusé par Microsoft pour le consentement admin (un compte perso ne peut pas consentir).
    const authorizeUrl = `https://login.microsoftonline.com/organizations/v2.0/adminconsent?client_id=${encodeURIComponent(clientId)}&scope=${encodeURIComponent(SCOPE)}&redirect_uri=${encodeURIComponent(functionUrl())}&state=${encodeURIComponent(state)}`;

    return jsonResponse({ url: authorizeUrl });
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
});
