/**
 * ingest-communication v3
 * Pipeline d'ingestion email — métadonnées uniquement (RGPD-safe)
 * Supporte Gmail (Google) et Outlook (Microsoft Graph) en parallèle.
 *
 * Architecture v3 :
 *   - Détection automatique du provider via le paramètre `provider` (google|microsoft)
 *   - Gmail : messages.list → batch metadata (From/To/Cc/Subject)
 *   - Outlook : /me/messages Graph API → même schéma de données
 *   - Même tables cibles : communication_threads, communication_messages
 *   - Lookback par défaut : 365 jours, cap 50 contacts / appel
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';

// Domaines email personnels — ne deviennent jamais des comptes (spec-32)
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'yahoo.fr', 'free.fr',
  'orange.fr', 'wanadoo.fr', 'icloud.com', 'me.com', 'live.com', 'protonmail.com',
  'laposte.net', 'sfr.fr', 'gmx.com', 'aol.com', 'msn.com', 'bbox.fr',
]);

/**
 * Détection automatique des comptes (spec-28/32) — regroupe les contacts par
 * domaine email pro (repli sur company_name), crée les comptes manquants et
 * relie les contacts via company_id. Idempotent : dédup par domaine puis nom.
 */
async function detectCompanies(supabase: any, organizationId: string): Promise<{ created: number; linked: number }> {
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, email, company_id')
    .eq('organization_id', organizationId)
    .is('merged_into_contact_id', null);
  if (!contacts?.length) return { created: 0, linked: 0 };

  const { data: existing } = await supabase
    .from('companies')
    .select('id, name, domain')
    .eq('organization_id', organizationId);

  const byDomain = new Map<string, string>();
  for (const c of existing ?? []) {
    if (c.domain) byDomain.set(String(c.domain).toLowerCase(), c.id);
  }

  // Nom lisible dérivé du domaine (optee.io → Optee)
  const nameFromDomain = (d: string) => {
    const root = d.split('.')[0].replace(/[-_]/g, ' ');
    return root.charAt(0).toUpperCase() + root.slice(1);
  };

  // Regroupement par domaine email professionnel (les domaines perso sont ignorés)
  type Group = { name: string; domain: string; contactIds: string[] };
  const groups = new Map<string, Group>();
  for (const ct of contacts as any[]) {
    const domain = ct.email?.split('@')[1]?.toLowerCase() ?? null;
    if (!domain || PERSONAL_DOMAINS.has(domain)) continue;
    if (!groups.has(domain)) groups.set(domain, { name: nameFromDomain(domain), domain, contactIds: [] });
    groups.get(domain)!.contactIds.push(ct.id);
  }

  let created = 0, linked = 0;
  for (const g of groups.values()) {
    let companyId = byDomain.get(g.domain);
    if (!companyId) {
      const { data: ins } = await supabase
        .from('companies')
        .insert({ organization_id: organizationId, name: g.name, domain: g.domain })
        .select('id')
        .single();
      if (ins) {
        companyId = ins.id;
        created++;
        byDomain.set(g.domain, companyId);
      }
    }
    if (companyId) {
      const { error } = await supabase
        .from('contacts')
        .update({ company_id: companyId })
        .in('id', g.contactIds)
        .is('company_id', null);
      if (!error) linked += g.contactIds.length;
    }
  }
  return { created, linked };
}

// ── Google token refresh ───────────────────────────────────────────────────
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

    // Persist the refreshed token back to connectors.metadata
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

// ── Gmail helpers ──────────────────────────────────────────────────────────
async function gmail<T = any>(path: string, token: string): Promise<T> {
  const res = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw Object.assign(new Error('TOKEN_EXPIRED'), { code: 401 });
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${await res.text()}`);
  return res.json() as T;
}

function headerVal(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function extractEmail(raw: string): string {
  const m = raw.match(/<([^>]+)>/) ?? raw.match(/([^\s,]+@[^\s,]+)/);
  return m ? m[1].trim().toLowerCase() : raw.trim().toLowerCase();
}

// Nettoie/valide un nom d'affichage issu d'un email (en-tête From / Graph).
// Rejette les emails bruts et les libellés génériques (noreply, contact, support…).
function cleanDisplayName(raw: string): string {
  if (!raw) return '';
  let s = raw.trim().replace(/^["']|["']$/g, '').trim();
  if (!s || s.includes('@')) return '';
  // « Nom, Prénom » → « Prénom Nom »
  if (/^[^,]+,\s*[^,]+$/.test(s)) {
    const [last, first] = s.split(',').map(x => x.trim());
    s = `${first} ${last}`;
  }
  const generic = /^(no.?reply|do.?not.?reply|ne.?pas.?repondre|contact|info|infos|hello|bonjour|support|sales|commercial|equipe|team|admin|service|client|clients|newsletter|notification|notifications|mailer|postmaster)$/i;
  if (generic.test(s)) return '';
  if (!/[a-zà-ÿ]/i.test(s)) return '';        // doit contenir une lettre
  if (s.length > 120) s = s.slice(0, 120);
  return s;
}

// Extrait le nom d'affichage d'un en-tête From Gmail : « "Camille Rambert" <x@y.com> » → « Camille Rambert ».
function extractName(rawFrom: string): string {
  let s = (rawFrom ?? '').trim();
  const lt = s.indexOf('<');
  s = lt > 0 ? s.slice(0, lt) : '';            // partie avant <email> ; sinon pas de nom
  return cleanDisplayName(s);
}

// Renseigne contacts.full_name UNIQUEMENT s'il est vide ou générique (= email / partie locale).
// Permet d'identifier « qui se cache » derrière contact@domaine.com à partir de la signature/From.
async function maybeSetContactName(
  supabase: any, contactId: string, contactEmail: string, resolvedName: string,
): Promise<void> {
  if (!resolvedName) return;
  const { data: cRow } = await supabase
    .from('contacts').select('full_name').eq('id', contactId).maybeSingle();
  const cur = (cRow?.full_name ?? '').trim().toLowerCase();
  const local = (contactEmail.split('@')[0] ?? '').toLowerCase();
  const isPlaceholder =
    !cur ||
    cur === contactEmail.toLowerCase() ||
    cur === local ||
    cur === local.replace(/[._-]+/g, ' ');
  if (isPlaceholder && resolvedName.toLowerCase() !== cur) {
    await supabase.from('contacts')
      .update({ full_name: resolvedName, updated_at: new Date().toISOString() })
      .eq('id', contactId);
  }
}

function isOutbound(headers: Array<{ name: string; value: string }>, labelIds: string[], userEmail: string): boolean {
  if (labelIds.includes('SENT')) return true;
  const from = extractEmail(headerVal(headers, 'From'));
  return from === userEmail.toLowerCase();
}

// ── Fetch all message IDs for a contact (paginated) ────────────────────────
async function listMessageIds(
  contactEmails: string | string[],
  token: string,
  afterEpoch: number,
  maxMessages: number,
): Promise<Array<{ id: string; threadId: string }>> {
  const results: Array<{ id: string; threadId: string }> = [];
  let pageToken: string | undefined;

  // Supporte plusieurs emails (email principal + alias secondaires d'un contact fusionné)
  const emails = Array.isArray(contactEmails) ? contactEmails : [contactEmails];
  const clause = emails.map(e => `from:${e} OR to:${e}`).join(' OR ');
  const q = encodeURIComponent(`(${clause}) after:${afterEpoch}`);

  do {
    const url = `/users/me/messages?q=${q}&maxResults=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const data = await gmail<{ messages?: Array<{ id: string; threadId: string }>; nextPageToken?: string }>(url, token);
    results.push(...(data.messages ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken && results.length < maxMessages);

  return results.slice(0, maxMessages);
}

// ── Fetch message metadata in parallel batches ─────────────────────────────
async function batchFetchMetadata(
  ids: string[],
  token: string,
  batchSize = 10,
): Promise<any[]> {
  const results: any[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const fetched = await Promise.all(
      batch.map(id =>
        gmail(
          `/users/me/messages/${id}?format=metadata` +
          `&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc` +
          `&metadataHeaders=Subject&metadataHeaders=Date`,
          token,
        ).catch(() => null),
      ),
    );
    results.push(...fetched.filter(Boolean));
  }
  return results;
}

// ── Process one contact ────────────────────────────────────────────────────
async function processContact(
  contactId: string,
  contactEmail: string,
  organizationId: string,
  userEmail: string,
  token: string,
  supabase: any,
  afterEpoch: number,
  maxMessages: number,
  secondaryEmails: string[] = [],
): Promise<{ messages: number; threads: number }> {

  // 1. Get all message IDs (paginated) — inclut l'email principal + les alias
  const allEmails = [contactEmail, ...secondaryEmails.filter(Boolean)];
  const msgList = await listMessageIds(allEmails, token, afterEpoch, maxMessages);
  if (msgList.length === 0) return { messages: 0, threads: 0 };

  // 2. Fetch metadata in parallel batches of 10
  const msgDetails = await batchFetchMetadata(msgList.map(m => m.id), token, 10);
  if (msgDetails.length === 0) return { messages: 0, threads: 0 };

  // 3. Group by threadId to upsert threads
  const threadMap = new Map<string, { subject: string; firstDate: string }>();
  for (const msg of msgDetails) {
    const tid = msg.threadId as string;
    if (!threadMap.has(tid)) {
      const headers: Array<{ name: string; value: string }> = msg.payload?.headers ?? [];
      const subject = headerVal(headers, 'Subject') || '(Sans objet)';
      const date = msg.internalDate
        ? new Date(parseInt(msg.internalDate)).toISOString()
        : new Date().toISOString();
      threadMap.set(tid, { subject, firstDate: date });
    }
  }

  // 4. Upsert all threads → get UUID map
  const threadExternalIds = Array.from(threadMap.keys());
  const threadRows = threadExternalIds.map(extId => ({
    organization_id: organizationId,
    provider: 'google',
    external_thread_id: extId,
    subject: threadMap.get(extId)!.subject,
    updated_at: new Date().toISOString(),
  }));

  const { data: upsertedThreads } = await supabase
    .from('communication_threads')
    .upsert(threadRows, { onConflict: 'organization_id,provider,external_thread_id' })
    .select('id, external_thread_id');

  const threadUUIDMap = new Map<string, string>();
  for (const t of (upsertedThreads ?? [])) {
    threadUUIDMap.set(t.external_thread_id, t.id);
  }

  // 5. Build message payloads
  // Track last timestamps per thread for response time estimation
  const threadLastOut = new Map<string, number>();
  const threadLastIn = new Map<string, number>();

  // Sort messages by date ascending for response time calculation
  msgDetails.sort((a, b) => parseInt(a.internalDate ?? '0') - parseInt(b.internalDate ?? '0'));

  const msgPayloads: any[] = [];
  let resolvedName = '';   // nom d'affichage du contact (depuis ses emails entrants)
  for (const msg of msgDetails) {
    const headers: Array<{ name: string; value: string }> = msg.payload?.headers ?? [];
    const labelIds: string[] = msg.labelIds ?? [];
    const tid = msg.threadId as string;
    const threadUUID = threadUUIDMap.get(tid);
    if (!threadUUID) continue;

    const sentAt = msg.internalDate
      ? new Date(parseInt(msg.internalDate)).toISOString()
      : null;
    if (!sentAt) continue;

    const msgTime = parseInt(msg.internalDate ?? '0');
    const outbound = isOutbound(headers, labelIds, userEmail);
    const direction = outbound ? 'outbound' : 'inbound';
    const subject = headerVal(headers, 'Subject') || null;

    // Le From d'un message entrant porte le nom du contact (le + récent l'emporte)
    // — mais SEULEMENT si l'expéditeur est bien ce contact. Un fil peut contenir
    //   d'autres expéditeurs (collègues, cc) dont le nom ne doit pas être collé ici.
    if (!outbound) {
      const fromEmail = extractEmail(headerVal(headers, 'From'));
      if (fromEmail === contactEmail.toLowerCase()) {
        const n = extractName(headerVal(headers, 'From'));
        if (n) resolvedName = n;
      }
    }

    // Response time estimation
    let responseTimeHours: number | null = null;
    if (outbound && threadLastIn.has(tid)) {
      const diff = (msgTime - threadLastIn.get(tid)!) / 3600000;
      if (diff >= 0 && diff <= 168) responseTimeHours = Math.round(diff * 10) / 10;
    } else if (!outbound && threadLastOut.has(tid)) {
      const diff = (msgTime - threadLastOut.get(tid)!) / 3600000;
      if (diff >= 0 && diff <= 168) responseTimeHours = Math.round(diff * 10) / 10;
    }
    if (outbound) threadLastOut.set(tid, msgTime);
    else threadLastIn.set(tid, msgTime);

    msgPayloads.push({
      organization_id: organizationId,
      thread_id: threadUUID,
      contact_id: contactId,
      provider: 'google',
      external_message_id: msg.id,
      direction,
      sent_at: sentAt,
      subject,
      body_text: null, // NEVER store body — RGPD
      metadata: {
        response_time_hours: responseTimeHours,
        gmail_labels: labelIds.filter(l => !['INBOX', 'UNREAD', 'IMPORTANT', 'CATEGORY_PERSONAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS'].includes(l)),
      },
    });
  }

  // 6. Upsert messages in chunks to avoid payload limits
  let inserted = 0;
  const chunkSize = 100;
  for (let i = 0; i < msgPayloads.length; i += chunkSize) {
    const chunk = msgPayloads.slice(i, i + chunkSize);
    const { data: rows, error: upsertErr } = await supabase
      .from('communication_messages')
      .upsert(chunk, { onConflict: 'organization_id,provider,external_message_id' })
      .select('id');
    if (upsertErr) {
      console.error('upsert error:', upsertErr.message, upsertErr.details);
    }
    inserted += (rows ?? []).length;
  }

  // 7. Mark contact for re-enrichment if new messages arrived
  if (inserted > 0) {
    await supabase.from('contacts')
      .update({ enrichment_status: 'pending', updated_at: new Date().toISOString() })
      .eq('id', contactId)
      .eq('enrichment_status', 'done'); // only reset if previously done
  }

  // 8. Identifier le contact (nom réel derrière un email générique) si manquant
  await maybeSetContactName(supabase, contactId, contactEmail, resolvedName);

  return { messages: inserted, threads: threadMap.size };
}

// ── Main handler ───────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const auth = req.headers.get('Authorization');
  if (!auth) return jsonResponse({ error: 'Missing authorization header' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const jwt = auth.replace('Bearer ', '');
  const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const {
    organizationId,
    providerToken: bodyToken,
    contactEmails,
    lookbackDays = 365,
    maxMessagesPerContact = 1000,
    provider = 'google', // 'google' | 'microsoft'
  } = body;

  if (!organizationId) return jsonResponse({ error: 'organizationId is required' }, 400);

  // Routage Outlook
  if (provider === 'microsoft') {
    return handleOutlookIngest(req, supabase, user, body);
  }

  // ── Resolve Google token — priorité : body token → token stocké en BDD ──
  // Fonctionne quel que soit le mode de connexion Supabase (email / LinkedIn / Google)
  let providerToken: string | null = bodyToken ?? null;

  if (!providerToken) {
    const { data: connector } = await supabase
      .from('connectors')
      .select('metadata, status')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .eq('provider', 'google')
      .maybeSingle();

    if (!connector || connector.status === 'not_connected') {
      return jsonResponse({
        error: 'Google non connecté. Allez dans Paramètres → Connexions et connectez votre compte Google.',
        code: 'NOT_CONNECTED',
      }, 400);
    }

    providerToken = (connector.metadata as any)?.access_token ?? null;

    // Si access_token absent mais refresh_token présent → tenter un refresh
    if (!providerToken && (connector.metadata as any)?.refresh_token) {
      const refreshed = await refreshGoogleToken((connector.metadata as any).refresh_token, supabase, organizationId, user.id);
      if (refreshed) providerToken = refreshed;
    }

    if (!providerToken) {
      return jsonResponse({
        error: 'Token Google introuvable ou expiré. Reconnectez votre compte Google dans Paramètres → Connexions.',
        code: 'TOKEN_MISSING',
      }, 401);
    }
  }

  const userEmail = user.email ?? '';
  const afterEpoch = Math.floor((Date.now() - lookbackDays * 86400000) / 1000);

  // Resolve which contacts to ingest
  let targetContacts: Array<{ id: string; email: string; secondary_emails: string[] }> = [];

  if (contactEmails?.length > 0) {
    const { data } = await supabase
      .from('contacts')
      .select('id, email, secondary_emails')
      .eq('organization_id', organizationId)
      .is('merged_into_contact_id', null)
      .in('email', contactEmails);
    targetContacts = (data ?? []).filter((c: any) => c.email);
  } else {
    const { data } = await supabase
      .from('contacts')
      .select('id, email, secondary_emails')
      .eq('organization_id', organizationId)
      .is('merged_into_contact_id', null)
      .not('email', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(150); // cap par appel (priorité aux contacts récents)
    targetContacts = (data ?? []).filter((c: any) => c.email);
  }

  if (targetContacts.length === 0) {
    return jsonResponse({ success: true, message: 'No contacts with emails found', stats: { contacts: 0, messages: 0, threads: 0 } });
  }

  let totalMessages = 0;
  let totalThreads = 0;
  const errors: string[] = [];
  const contactStats: Array<{ email: string; messages: number; threads: number }> = [];

  for (const contact of targetContacts) {
    try {
      const result = await processContact(
        contact.id,
        contact.email,
        organizationId,
        userEmail,
        providerToken,
        supabase,
        afterEpoch,
        maxMessagesPerContact,
        contact.secondary_emails ?? [],
      );
      totalMessages += result.messages;
      totalThreads += result.threads;
      if (result.messages > 0) {
        contactStats.push({ email: contact.email, messages: result.messages, threads: result.threads });
      }
    } catch (err: any) {
      if (err?.code === 401 || err?.message === 'TOKEN_EXPIRED') {
        await supabase.from('connectors')
          .update({ status: 'expired', updated_at: new Date().toISOString() })
          .eq('organization_id', organizationId)
          .eq('user_id', user.id)
          .eq('provider', 'google');
        return jsonResponse({ error: 'Google token expired. Please reconnect.', code: 'TOKEN_EXPIRED' }, 401);
      }
      errors.push(`${contact.email}: ${err?.message ?? String(err)}`);
    }
  }

  // Update connector sync timestamp
  await supabase.from('connectors')
    .update({ status: 'connected', last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .eq('provider', 'google');

  // Détection automatique des comptes à partir des contacts ingérés (best-effort)
  let companyDetection = { created: 0, linked: 0 };
  try {
    companyDetection = await detectCompanies(supabase, organizationId);
  } catch (e) {
    console.error('detectCompanies error:', e instanceof Error ? e.message : String(e));
  }

  return jsonResponse({
    success: true,
    stats: {
      contacts: targetContacts.length,
      messages: totalMessages,
      threads: totalThreads,
      errors: errors.length,
      companiesCreated: companyDetection.created,
      companiesLinked: companyDetection.linked,
    },
    contactStats,
    errors: errors.slice(0, 5),
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// OUTLOOK / MICROSOFT GRAPH — pipeline d'ingestion emails
// ══════════════════════════════════════════════════════════════════════════════

const GRAPH_API = 'https://graph.microsoft.com/v1.0';

async function graphGet(path: string, token: string): Promise<any> {
  const res = await fetch(`${GRAPH_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (res.status === 401) throw Object.assign(new Error('TOKEN_EXPIRED'), { code: 401 });
  if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Microsoft token refresh ──────────────────────────────────────────────────
// Les access tokens Graph expirent après ~1h. On utilise le refresh_token
// (scope offline_access) pour en obtenir un nouveau sans reconnexion.
async function refreshMicrosoftToken(
  refreshToken: string,
  supabase: any,
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
  const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET');
  if (!clientId || !clientSecret || !refreshToken) return null;
  try {
    const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: 'openid profile email offline_access Calendars.Read Mail.Read',
      }),
    });
    if (!res.ok) { console.error('MS refresh failed:', res.status, await res.text()); return null; }
    const data = await res.json();
    const newToken: string = data.access_token;
    if (!newToken) return null;
    // Microsoft fait tourner les refresh tokens : on stocke le nouveau s'il est fourni
    const newRefresh: string = data.refresh_token ?? refreshToken;
    const { data: conn } = await supabase.from('connectors').select('metadata')
      .eq('organization_id', organizationId).eq('user_id', userId).eq('provider', 'microsoft').maybeSingle();
    await supabase.from('connectors').update({
      metadata: { ...(conn?.metadata ?? {}), access_token: newToken, refresh_token: newRefresh, token_stored_at: new Date().toISOString() },
      status: 'connected', updated_at: new Date().toISOString(),
    }).eq('organization_id', organizationId).eq('user_id', userId).eq('provider', 'microsoft');
    return newToken;
  } catch (e) { console.error('MS refresh error:', e); return null; }
}

// Valide le token via un appel léger /me. Si 401 et refresh_token dispo → rafraîchit.
// Retourne un token valide, ou null si impossible (reconnexion nécessaire).
async function ensureValidMsToken(
  token: string | null,
  refreshToken: string | null,
  supabase: any,
  organizationId: string,
  userId: string,
): Promise<string | null> {
  if (token) {
    const test = await fetch(`${GRAPH_API}/me?$select=id`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (test.ok) return token;
    if (test.status !== 401) return token; // autre erreur transitoire → on tente quand même
  }
  if (refreshToken) {
    const fresh = await refreshMicrosoftToken(refreshToken, supabase, organizationId, userId);
    if (fresh) return fresh;
  }
  return null;
}

// Récupère tous les messages échangés avec un contact via deux requêtes séparées :
// 1) Messages reçus (from the contact) via /me/messages?$filter=from/emailAddress/address eq '...'
// 2) Messages envoyés (to the contact) via /me/sentItems?$filter=toRecipients/any(...)
// Note: toRecipients/any() n'est PAS supporté sur /me/messages — uniquement sur /me/sentItems
async function listOutlookMessages(
  contactEmails: string[],
  token: string,
  afterDate: string,
  maxMessages: number,
): Promise<any[]> {
  const results: any[] = [];
  const seen = new Set<string>();
  const select = 'id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isDraft';

  for (const email of contactEmails) {
    // Échappe les apostrophes dans l'adresse email pour OData
    const safeEmail = email.replace(/'/g, "''");

    // ── 1. Messages reçus de ce contact ──────────────────────────────────────
    // Note: $orderby sur un champ différent de $filter n'est pas supporté par Graph API sur toutes les boîtes
    let inboundUrl: string | null =
      `/me/messages?$top=100&$select=${select}` +
      `&$filter=isDraft eq false and from/emailAddress/address eq '${safeEmail}'`;

    while (inboundUrl && results.length < maxMessages) {
      try {
        const path = inboundUrl.startsWith('http') ? inboundUrl.replace(GRAPH_API, '') : inboundUrl;
        const data = await graphGet(path, token);
        const msgs: any[] = (data.value ?? []).filter((m: any) => {
          const d = m.receivedDateTime || m.sentDateTime;
          return d && d >= afterDate;
        });
        for (const m of msgs) { if (!seen.has(m.id)) { seen.add(m.id); results.push(m); } }
        if (msgs.length === 0) break;
        inboundUrl = data['@odata.nextLink'] ?? null;
      } catch { break; }
    }

    // ── 2. Messages envoyés à ce contact (/me/sentItems) ─────────────────────
    let sentUrl: string | null =
      `/me/sentItems?$top=100&$select=${select}` +
      `&$filter=isDraft eq false and toRecipients/any(r: r/emailAddress/address eq '${safeEmail}')`;

    while (sentUrl && results.length < maxMessages) {
      try {
        const path = sentUrl.startsWith('http') ? sentUrl.replace(GRAPH_API, '') : sentUrl;
        const data = await graphGet(path, token);
        const msgs: any[] = (data.value ?? []).filter((m: any) => {
          const d = m.sentDateTime || m.receivedDateTime;
          return d && d >= afterDate;
        });
        for (const m of msgs) { if (!seen.has(m.id)) { seen.add(m.id); results.push(m); } }
        if (msgs.length === 0) break;
        sentUrl = data['@odata.nextLink'] ?? null;
      } catch { break; }
    }
  }

  return results.slice(0, maxMessages);
}

async function processOutlookContact(
  contactId: string,
  contactEmail: string,
  organizationId: string,
  userEmail: string,
  token: string,
  supabase: any,
  afterDate: string,
  maxMessages: number,
  secondaryEmails: string[] = [],
): Promise<{ messages: number; threads: number }> {
  const allEmails = [contactEmail, ...secondaryEmails.filter(Boolean)];
  const msgs = await listOutlookMessages(allEmails, token, afterDate, maxMessages);
  if (!msgs.length) return { messages: 0, threads: 0 };

  // ── Threads (conversations) ───────────────────────────────────────────────
  const convMap = new Map<string, { subject: string; firstDate: string }>();
  for (const m of msgs) {
    const cid = m.conversationId as string;
    if (cid && !convMap.has(cid)) {
      convMap.set(cid, {
        subject: m.subject || '(Sans objet)',
        firstDate: m.receivedDateTime || m.sentDateTime || new Date().toISOString(),
      });
    }
  }

  const threadRows = Array.from(convMap.entries()).map(([extId, v]) => ({
    organization_id: organizationId,
    provider: 'microsoft',
    external_thread_id: extId,
    subject: v.subject,
    updated_at: new Date().toISOString(),
  }));

  const { data: upsertedThreads } = await supabase
    .from('communication_threads')
    .upsert(threadRows, { onConflict: 'organization_id,provider,external_thread_id' })
    .select('id, external_thread_id');

  const threadUUIDMap = new Map<string, string>();
  for (const t of upsertedThreads ?? []) threadUUIDMap.set(t.external_thread_id, t.id);

  // ── Messages ──────────────────────────────────────────────────────────────
  const payloads: any[] = [];
  let resolvedName = '';   // nom d'affichage du contact (depuis ses emails entrants)
  for (const m of msgs) {
    const threadUUID = threadUUIDMap.get(m.conversationId);
    if (!threadUUID) continue;

    const sentAt = m.receivedDateTime || m.sentDateTime;
    if (!sentAt) continue;

    const fromAddr = m.from?.emailAddress?.address?.toLowerCase() ?? '';
    const outbound = fromAddr === userEmail.toLowerCase();

    // Graph fournit le nom d'affichage sur les messages entrants — mais SEULEMENT
    // si l'expéditeur est bien ce contact (un fil peut mêler plusieurs expéditeurs).
    if (!outbound && fromAddr === contactEmail.toLowerCase()) {
      const n = cleanDisplayName(m.from?.emailAddress?.name ?? '');
      if (n) resolvedName = n;
    }

    payloads.push({
      organization_id: organizationId,
      thread_id: threadUUID,
      contact_id: contactId,
      provider: 'microsoft',
      external_message_id: m.id,
      direction: outbound ? 'outbound' : 'inbound',
      sent_at: sentAt,
      subject: m.subject || null,
      body_text: null, // NEVER store body — RGPD
      metadata: {
        response_time_hours: null,
        outlook_categories: [],
      },
    });
  }

  // Upsert en chunks
  let inserted = 0;
  for (let i = 0; i < payloads.length; i += 100) {
    const { data: rows } = await supabase
      .from('communication_messages')
      .upsert(payloads.slice(i, i + 100), { onConflict: 'organization_id,provider,external_message_id' })
      .select('id');
    inserted += (rows ?? []).length;
  }

  if (inserted > 0) {
    await supabase.from('contacts')
      .update({ enrichment_status: 'pending', updated_at: new Date().toISOString() })
      .eq('id', contactId)
      .eq('enrichment_status', 'done');
  }

  // Identifier le contact (nom réel derrière un email générique) si manquant
  await maybeSetContactName(supabase, contactId, contactEmail, resolvedName);

  return { messages: inserted, threads: convMap.size };
}

// Handler Outlook — appelé quand provider === 'microsoft'
export async function handleOutlookIngest(req: Request, supabase: any, user: any, body: any) {
  const { organizationId, providerToken: bodyToken, contactEmails, lookbackDays = 365, maxMessagesPerContact = 1000 } = body;
  if (!organizationId) return jsonResponse({ error: 'organizationId is required' }, 400);

  let providerToken: string | null = bodyToken ?? null;
  let refreshToken: string | null = null;
  // On lit toujours le connecteur pour récupérer le refresh_token (renouvellement auto)
  const { data: connector } = await supabase
    .from('connectors')
    .select('metadata, status')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .eq('provider', 'microsoft')
    .maybeSingle();
  if (!connector || connector.status === 'not_connected') {
    return jsonResponse({ error: 'Outlook non connecté. Connectez votre compte Microsoft dans Paramètres.', code: 'NOT_CONNECTED' }, 400);
  }
  refreshToken = (connector.metadata as any)?.refresh_token ?? null;
  if (!providerToken) providerToken = (connector.metadata as any)?.access_token ?? null;

  // Valide / rafraîchit le token avant d'attaquer Graph (évite les 401 silencieux)
  providerToken = await ensureValidMsToken(providerToken, refreshToken, supabase, organizationId, user.id);
  if (!providerToken) {
    await supabase.from('connectors').update({ status: 'needs_reauth', updated_at: new Date().toISOString() })
      .eq('organization_id', organizationId).eq('user_id', user.id).eq('provider', 'microsoft');
    return jsonResponse({ error: 'Token Outlook expiré et renouvellement impossible. Reconnectez votre compte Microsoft.', code: 'TOKEN_EXPIRED' }, 401);
  }

  const userEmail = user.email ?? '';
  const afterDate = new Date(Date.now() - lookbackDays * 86400000).toISOString();

  let targetContacts: Array<{ id: string; email: string; secondary_emails: string[] }> = [];
  if (contactEmails?.length > 0) {
    const { data } = await supabase.from('contacts').select('id, email, secondary_emails')
      .eq('organization_id', organizationId).is('merged_into_contact_id', null).in('email', contactEmails);
    targetContacts = (data ?? []).filter((c: any) => c.email);
  } else {
    const { data } = await supabase.from('contacts').select('id, email, secondary_emails')
      .eq('organization_id', organizationId).is('merged_into_contact_id', null).not('email', 'is', null).limit(50);
    targetContacts = (data ?? []).filter((c: any) => c.email);
  }

  if (!targetContacts.length) return jsonResponse({ success: true, message: 'No contacts found', stats: { contacts: 0, messages: 0, threads: 0 } });

  let totalMessages = 0, totalThreads = 0;
  const errors: string[] = [];
  const contactStats: any[] = [];

  for (const contact of targetContacts) {
    try {
      const result = await processOutlookContact(
        contact.id, contact.email, organizationId, userEmail,
        providerToken, supabase, afterDate, maxMessagesPerContact, contact.secondary_emails ?? [],
      );
      totalMessages += result.messages;
      totalThreads += result.threads;
      if (result.messages > 0) contactStats.push({ email: contact.email, ...result });
    } catch (err: any) {
      if (err?.code === 401 || err?.message === 'TOKEN_EXPIRED') {
        await supabase.from('connectors')
          .update({ status: 'expired', updated_at: new Date().toISOString() })
          .eq('organization_id', organizationId).eq('user_id', user.id).eq('provider', 'microsoft');
        return jsonResponse({ error: 'Outlook token expired. Please reconnect.', code: 'TOKEN_EXPIRED' }, 401);
      }
      errors.push(`${contact.email}: ${err?.message ?? String(err)}`);
    }
  }

  await supabase.from('connectors')
    .update({ status: 'connected', last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('organization_id', organizationId).eq('user_id', user.id).eq('provider', 'microsoft');

  return jsonResponse({ success: true, stats: { contacts: targetContacts.length, messages: totalMessages, threads: totalThreads, errors: errors.length }, contactStats, errors: errors.slice(0, 5) });
}

