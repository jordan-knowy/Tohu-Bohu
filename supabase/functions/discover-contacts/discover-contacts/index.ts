/**
 * discover-contacts v4
 * Scanne Gmail ET Outlook (reçus + envoyés) pour suggérer de nouveaux contacts.
 * Retourne les interlocuteurs fréquents pas encore dans la base.
 * Le corps est lu en mémoire pour snippet — jamais stocké en base (RGPD).
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

// ── Domaines personnels à ignorer ─────────────────────────────────────────────
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'yahoo.fr',
  'free.fr', 'orange.fr', 'wanadoo.fr', 'icloud.com', 'me.com',
  'live.com', 'protonmail.com', 'laposte.net', 'sfr.fr', 'gmx.com',
  'aol.com', 'msn.com', 'bbox.fr',
]);

function isSpam(email: string): boolean {
  if (/noreply|no-reply|donotreply|bounce|mailer-daemon/i.test(email)) return true;
  const local = email.split('@')[0];
  if (/noreply|no-reply|notifications?|alerts?|support|info|contact|newsletter/i.test(local)) return true;
  return false;
}

// ── Helpers Gmail ─────────────────────────────────────────────────────────────
const GMAIL = 'https://gmail.googleapis.com/gmail/v1';

function extractEmail(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
}

function extractName(raw: string): string {
  const m = raw.match(/^([^<]+)<[^>]+>/);
  if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  return extractEmail(raw).split('@')[0].replace(/[._-]/g, ' ');
}

function headerVal(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function parseAddresses(raw: string): Array<{ email: string; name: string }> {
  if (!raw) return [];
  return raw.split(/,(?![^<]*>)/)
    .map(p => ({ email: extractEmail(p.trim()), name: extractName(p.trim()) }))
    .filter(a => a.email.includes('@'));
}

function b64decode(s: string): string {
  try { return atob(s.replace(/-/g, '+').replace(/_/g, '/')); } catch { return ''; }
}

function extractBodyText(payload: any, depth = 0): string {
  if (!payload || depth > 4) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return b64decode(payload.body.data);
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return b64decode(payload.body.data).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }
  if (payload.parts?.length) {
    const plain = payload.parts.find((p: any) => p.mimeType === 'text/plain');
    if (plain) return extractBodyText(plain, depth + 1);
    const html = payload.parts.find((p: any) => p.mimeType === 'text/html');
    if (html) return extractBodyText(html, depth + 1);
    for (const part of payload.parts) { const t = extractBodyText(part, depth + 1); if (t) return t; }
  }
  return '';
}

function cleanSnippet(raw: string): string {
  return raw.split('\n').filter(l => !l.trim().startsWith('>')).join(' ')
    .replace(/\s{2,}/g, ' ').trim().slice(0, 250);
}

async function gmailGet(path: string, token: string) {
  const r = await fetch(`${GMAIL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw Object.assign(new Error(`Gmail ${r.status}`), { code: r.status });
  return r.json();
}

// ── Helpers Outlook (Microsoft Graph) ────────────────────────────────────────
const GRAPH = 'https://graph.microsoft.com/v1.0';

// ── Type fréquence contact ────────────────────────────────────────────────────
interface ContactFreq {
  name: string;
  count: number;
  lastSeen: string;
  lastSubject: string;
  lastSnippet: string;
  phone?: string;
  linkedIn?: string;
  title?: string;
}

// ── Extraction des données de signature ───────────────────────────────────────
function extractSignatureData(text: string): { phone?: string; linkedIn?: string; title?: string } {
  if (!text) return {};
  // Prend les 40 dernières lignes (là où se trouve la signature)
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const sigLines = lines.slice(-40).join(' ');

  // Téléphone : formats internationaux, français, avec/sans espaces
  const phoneMatch = sigLines.match(/(?:tel|tél|phone|mob|mobile|cell|☎|📞)?\s*:?\s*(\+?(?:33|1|44|49|34|39|41|32|31|1)[\s\-.]?\(?\d{1,4}\)?[\s\-.]?\d{2,4}[\s\-.]?\d{2,4}[\s\-.]?\d{2,4})/i)
    ?? sigLines.match(/(\+\d{1,3}[\s\-.]?\d{2,3}[\s\-.]?\d{2,4}[\s\-.]?\d{2,4}[\s\-.]?\d{2,4})/);
  const phone = phoneMatch?.[1]?.replace(/\s+/g, ' ').trim();

  // LinkedIn URL
  const linkedInMatch = sigLines.match(/linkedin\.com\/in\/([a-zA-Z0-9\-_%]+)/i);
  const linkedIn = linkedInMatch ? `https://www.linkedin.com/in/${linkedInMatch[1]}` : undefined;

  // Titre/Poste : mots-clés courants de signature
  const titleMatch = sigLines.match(/(?:^|\|)\s*((?:CEO|CTO|CFO|COO|VP|Director?|Directeur|Responsable|Manager|Lead|Head of|Chef|Founder|Co-Founder|Partner|Associé|Consultant|Ingénieur|Engineer|Developer|Développeur|Analyst|Sales|Commercial|Account)[^\n|•]{0,60})/im);
  const title = titleMatch?.[1]?.trim().slice(0, 80);

  return { phone: phone ?? undefined, linkedIn, title: title ?? undefined };
}

// ── Scan Gmail ────────────────────────────────────────────────────────────────
async function scanGmail(token: string, userEmail: string, afterEpoch: number): Promise<Map<string, ContactFreq>> {
  const freq = new Map<string, ContactFreq>();
  const allIds: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ maxResults: '500', q: `after:${afterEpoch}`, ...(pageToken ? { pageToken } : {}) });
    const page: any = await gmailGet(`/users/me/messages?${params}`, token);
    for (const m of page.messages ?? []) allIds.push(m.id);
    pageToken = page.nextPageToken;
  } while (pageToken && allIds.length < 2000);

  const chunkSize = 5;
  for (let i = 0; i < allIds.length; i += chunkSize) {
    const chunk = allIds.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async (id) => {
      try {
        const msg: any = await gmailGet(`/users/me/messages/${id}?format=full`, token);
        const headers: Array<{ name: string; value: string }> = msg.payload?.headers ?? [];
        const sentAt = msg.internalDate ? new Date(parseInt(msg.internalDate)).toISOString() : new Date().toISOString();
        const subject = headerVal(headers, 'Subject') || '';
        const bodyText = extractBodyText(msg.payload) || msg.snippet || '';
        const snippet = cleanSnippet(bodyText);
        const sigData = extractSignatureData(bodyText);
        const candidates = [
          ...parseAddresses(headerVal(headers, 'From')),
          ...parseAddresses(headerVal(headers, 'To')),
          ...parseAddresses(headerVal(headers, 'Cc')),
        ];
        for (const { email, name } of candidates) {
          if (email === userEmail) continue;
          const domain = email.split('@')[1] ?? '';
          if (PERSONAL_DOMAINS.has(domain) || isSpam(email)) continue;
          const cur = freq.get(email);
          if (!cur) { freq.set(email, { name, count: 1, lastSeen: sentAt, lastSubject: subject, lastSnippet: snippet, ...sigData }); }
          else {
            cur.count++;
            if (sentAt > cur.lastSeen) {
              cur.lastSeen = sentAt; if (name) cur.name = name; cur.lastSubject = subject; cur.lastSnippet = snippet;
              if (sigData.phone && !cur.phone) cur.phone = sigData.phone;
              if (sigData.linkedIn && !cur.linkedIn) cur.linkedIn = sigData.linkedIn;
              if (sigData.title && !cur.title) cur.title = sigData.title;
            }
          }
        }
      } catch { /* skip */ }
    }));
  }
  return freq;
}

// ── Scan Outlook : reçus (/me/messages) + envoyés (/me/sentItems) ─────────────
async function scanOutlook(token: string, userEmail: string, afterDate: string): Promise<Map<string, ContactFreq>> {
  const freq = new Map<string, ContactFreq>();
  // OData ne supporte pas les millisecondes — on les enlève
  const after = afterDate.replace(/\.\d+Z$/, 'Z');
  const select = 'from,toRecipients,ccRecipients,subject,bodyPreview,receivedDateTime,sentDateTime';
  let scanned = 0;
  const MAX = 3000;

  function processMsg(msg: any) {
    const ts: string = msg.receivedDateTime || msg.sentDateTime || new Date().toISOString();
    const subject: string = msg.subject ?? '';
    const rawPreview = (msg.bodyPreview ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
    const snippet: string = cleanSnippet(rawPreview);
    const sigData = extractSignatureData(rawPreview);

    const candidates: Array<{ email: string; name: string }> = [];
    if (msg.from?.emailAddress) {
      const addr = msg.from.emailAddress.address?.toLowerCase() ?? '';
      if (addr) candidates.push({ email: addr, name: msg.from.emailAddress.name ?? '' });
    }
    for (const r of msg.toRecipients ?? []) {
      if (r.emailAddress?.address) candidates.push({ email: r.emailAddress.address.toLowerCase(), name: r.emailAddress.name ?? '' });
    }
    for (const r of msg.ccRecipients ?? []) {
      if (r.emailAddress?.address) candidates.push({ email: r.emailAddress.address.toLowerCase(), name: r.emailAddress.name ?? '' });
    }

    for (const { email, name } of candidates) {
      if (!email.includes('@') || email === userEmail) continue;
      const domain = email.split('@')[1] ?? '';
      if (PERSONAL_DOMAINS.has(domain) || isSpam(email)) continue;
      const cur = freq.get(email);
      if (!cur) { freq.set(email, { name, count: 1, lastSeen: ts, lastSubject: subject, lastSnippet: snippet, ...sigData }); }
      else {
        cur.count++;
        if (ts > cur.lastSeen) {
          cur.lastSeen = ts; if (name) cur.name = name; cur.lastSubject = subject; cur.lastSnippet = snippet;
          if (sigData.phone && !cur.phone) cur.phone = sigData.phone;
          if (sigData.linkedIn && !cur.linkedIn) cur.linkedIn = sigData.linkedIn;
          if (sigData.title && !cur.title) cur.title = sigData.title;
        }
      }
    }
  }

  // 1. Messages reçus — /me/messages avec filtre sur receivedDateTime
  // Note: on construit l'URL manuellement pour éviter l'encodage de $ par URLSearchParams
  let inboundUrl: string | null = `${GRAPH}/me/messages?$top=100&$select=${select}&$filter=receivedDateTime ge ${after}&$orderby=receivedDateTime desc`;
  while (inboundUrl && scanned < MAX) {
    try {
      const r = await fetch(inboundUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      if (!r.ok) {
        console.error('Outlook inbound error:', r.status, await r.text());
        break;
      }
      const page = await r.json();
      for (const msg of page.value ?? []) { processMsg(msg); scanned++; }
      inboundUrl = page['@odata.nextLink'] ?? null;
    } catch { break; }
  }

  // 2. Messages envoyés — /me/sentItems avec filtre sur sentDateTime
  let sentUrl: string | null = `${GRAPH}/me/sentItems?$top=100&$select=${select}&$filter=sentDateTime ge ${after}&$orderby=sentDateTime desc`;
  while (sentUrl && scanned < MAX) {
    try {
      const r = await fetch(sentUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      if (!r.ok) break;
      const page = await r.json();
      for (const msg of page.value ?? []) { processMsg(msg); scanned++; }
      sentUrl = page['@odata.nextLink'] ?? null;
    } catch { break; }
  }

  return freq;
}

// ── Merge deux maps de fréquence ──────────────────────────────────────────────
function mergeFreqs(a: Map<string, ContactFreq>, b: Map<string, ContactFreq>): Map<string, ContactFreq> {
  const result = new Map(a);
  for (const [email, v] of b) {
    const existing = result.get(email);
    if (!existing) { result.set(email, v); }
    else {
      existing.count += v.count;
      if (v.lastSeen > existing.lastSeen) { existing.lastSeen = v.lastSeen; existing.lastSubject = v.lastSubject; existing.lastSnippet = v.lastSnippet; if (v.name) existing.name = v.name; }
    }
  }
  return result;
}

// ── Microsoft token refresh ────────────────────────────────────────────────
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

async function ensureValidMsToken(token: string | null, refreshToken: string | null, supabase: any, organizationId: string, userId: string): Promise<string | null> {
  if (token) {
    const test = await fetch(`${GRAPH}/me?$select=id`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (test.ok) return token;
    if (test.status !== 401) return token;
  }
  if (refreshToken) {
    const fresh = await refreshMicrosoftToken(refreshToken, supabase, organizationId, userId);
    if (fresh) return fresh;
  }
  return null;
}

// ── Handler principal ─────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'Missing Authorization' }, 401);

    const { data: { user }, error: authErr } = await supabaseClient.auth.getUser(auth.replace('Bearer ', ''));
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const {
      organizationId,
      googleToken,
      microsoftToken,
      lookbackDays = 3650,  // par défaut : tout l'historique (~10 ans)
      minExchanges = 1,     // par défaut : 1 échange suffit
    } = body;

    if (!organizationId) return json({ error: 'organizationId required' }, 400);

    const userEmail = user.email?.toLowerCase() ?? '';
    const afterEpoch = Math.floor((Date.now() - lookbackDays * 86400000) / 1000);
    const afterDate = new Date(Date.now() - lookbackDays * 86400000).toISOString();

    let combinedFreq = new Map<string, ContactFreq>();

    if (!googleToken && !microsoftToken) {
      return json({ error: 'Aucun compte mail connecté. Connectez Google ou Microsoft dans Paramètres.' }, 400);
    }

    // ── Gmail ─────────────────────────────────────────────────────────────────
    if (googleToken) {
      try {
        const gmailFreq = await scanGmail(googleToken, userEmail, afterEpoch);
        combinedFreq = mergeFreqs(combinedFreq, gmailFreq);
        console.log(`Gmail scan: ${gmailFreq.size} contacts uniques`);
      } catch (e: any) {
        console.error('Gmail scan error:', e.message);
      }
    }

    // ── Outlook ───────────────────────────────────────────────────────────────
    // On lit le connecteur pour récupérer le refresh_token, puis on valide/rafraîchit
    // le token avant de scanner (évite les 401 silencieux → 0 résultat).
    {
      const { data: msConn } = await supabaseClient.from('connectors').select('metadata, status')
        .eq('organization_id', organizationId).eq('user_id', user.id).eq('provider', 'microsoft').maybeSingle();
      const hasMsConnector = msConn && msConn.status !== 'not_connected';
      if (microsoftToken || hasMsConnector) {
        const refreshToken = (msConn?.metadata as any)?.refresh_token ?? null;
        const candidateToken = microsoftToken ?? (msConn?.metadata as any)?.access_token ?? null;
        const validToken = await ensureValidMsToken(candidateToken, refreshToken, supabaseClient, organizationId, user.id);
        if (validToken) {
          try {
            const outlookFreq = await scanOutlook(validToken, userEmail, afterDate);
            combinedFreq = mergeFreqs(combinedFreq, outlookFreq);
            console.log(`Outlook scan: ${outlookFreq.size} contacts uniques`);
          } catch (e: any) {
            console.error('Outlook scan error:', e.message);
          }
        } else {
          console.error('Outlook: token invalide et refresh impossible');
        }
      }
    }

    // ── Seuil minimum d'échanges ──────────────────────────────────────────────
    const candidates = Array.from(combinedFreq.entries())
      .filter(([, v]) => v.count >= minExchanges)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 200);

    if (candidates.length === 0) return json({ suggestions: [], scanned: combinedFreq.size });

    // ── Filtrer les contacts déjà connus ──────────────────────────────────────
    const emails = candidates.map(([email]) => email);
    const { data: existing } = await supabaseClient
      .from('contacts')
      .select('email')
      .eq('organization_id', organizationId)
      .is('merged_into_contact_id', null)
      .in('email', emails);

    const knownEmails = new Set((existing ?? []).map((c: any) => c.email?.toLowerCase()));

    const suggestions = candidates
      .filter(([email]) => !knownEmails.has(email))
      .map(([email, v]) => ({
        email,
        name: v.name || email.split('@')[0].replace(/[._-]/g, ' '),
        domain: email.split('@')[1] ?? '',
        count: v.count,
        lastSeen: v.lastSeen,
        lastSubject: v.lastSubject,
        lastSnippet: v.lastSnippet,
        // Données extraites de la signature
        phone: v.phone ?? null,
        linkedIn: v.linkedIn ?? null,
        title: v.title ?? null,
      }))
      .slice(0, 100);

    return json({ suggestions, scanned: combinedFreq.size });

  } catch (err: any) {
    console.error('discover-contacts error:', err.message);
    return json({ error: err.message ?? 'Internal error' }, 500);
  }
});

