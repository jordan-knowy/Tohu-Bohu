/**
 * analyze-email-exchanges v1
 * Lit les corps des derniers emails d'un contact via Gmail API,
 * envoie le contexte conversationnel à Gemini 2.5 Flash (OpenRouter),
 * stocke UNIQUEMENT le résumé cognitif/relationnel — jamais le texte brut.
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
const GRAPH_API = 'https://graph.microsoft.com/v1.0';

// ── Résolution du token Google ─────────────────────────────────────────────
async function resolveGoogleToken(
  supabase: any,
  organizationId: string,
  userId: string,
  bodyToken: string | null,
): Promise<string | null> {
  if (bodyToken) return bodyToken;

  const { data: connector } = await supabase.from('connectors')
    .select('metadata, status')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .eq('provider', 'google')
    .maybeSingle();

  if (!connector || connector.status === 'not_connected') return null;

  let token = (connector.metadata as any)?.access_token ?? null;

  if (!token && (connector.metadata as any)?.refresh_token) {
    const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
    if (clientId && clientSecret) {
      try {
        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: (connector.metadata as any).refresh_token,
            grant_type: 'refresh_token',
          }),
        });
        if (res.ok) {
          const data = await res.json();
          token = data.access_token ?? null;
          if (token) {
            await supabase.from('connectors').update({
              metadata: { ...(connector.metadata ?? {}), access_token: token, stored_at: new Date().toISOString() },
              status: 'connected',
              updated_at: new Date().toISOString(),
            }).eq('organization_id', organizationId).eq('user_id', userId).eq('provider', 'google');
          }
        }
      } catch { /* ignore */ }
    }
  }

  return token;
}

// ── Résolution du token Microsoft ─────────────────────────────────────────
async function resolveOutlookToken(
  supabase: any,
  organizationId: string,
  userId: string,
  bodyToken: string | null,
): Promise<string | null> {
  if (bodyToken) return bodyToken;

  const { data: connector } = await supabase.from('connectors')
    .select('metadata, status')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .eq('provider', 'microsoft')
    .maybeSingle();

  if (!connector || connector.status === 'not_connected') return null;

  let token = (connector.metadata as any)?.access_token ?? null;
  const refreshToken = (connector.metadata as any)?.refresh_token ?? null;

  if (!token && refreshToken) {
    const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
    const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET');
    if (clientId && clientSecret) {
      try {
        const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
            scope: 'openid profile email offline_access Mail.Read',
          }),
        });
        if (res.ok) {
          const data = await res.json();
          token = data.access_token ?? null;
          if (token) {
            await supabase.from('connectors').update({
              metadata: { ...(connector.metadata ?? {}), access_token: token, token_stored_at: new Date().toISOString() },
              updated_at: new Date().toISOString(),
            }).eq('organization_id', organizationId).eq('user_id', userId).eq('provider', 'microsoft');
          }
        }
      } catch { /* ignore */ }
    }
  }
  return token;
}

// ── Nettoyage HTML Outlook → texte brut ───────────────────────────────────
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Détection newsletters / emails automatiques ───────────────────────────
function isNewsletter(headers: Array<{ name: string; value: string }>): boolean {
  const h = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
  // Emails automatiques / newsletters — jamais pertinents relationnellement
  if (h('List-Unsubscribe')) return true;
  if (h('List-Id')) return true;
  const precedence = h('Precedence').toLowerCase();
  if (precedence === 'bulk' || precedence === 'list' || precedence === 'junk') return true;
  if (h('Auto-Submitted') && h('Auto-Submitted').toLowerCase() !== 'no') return true;
  const xMailer = h('X-Mailer').toLowerCase();
  if (xMailer.includes('mailchimp') || xMailer.includes('sendgrid') || xMailer.includes('mailgun')) return true;
  return false;
  // Les emails de groupe (plusieurs destinataires) sont CONSERVÉS — pertinents relationnellement
}

// ── Extraction récursive du text/plain dans le MIME tree ──────────────────
function extractTextPlain(part: any): string {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) {
    try {
      // Gmail encode en base64url
      const b64 = (part.body.data as string).replace(/-/g, '+').replace(/_/g, '/');
      return atob(b64);
    } catch { return ''; }
  }
  if (part.parts && Array.isArray(part.parts)) {
    for (const sub of part.parts) {
      const t = extractTextPlain(sub);
      if (t) return t;
    }
  }
  return '';
}

// ── Nettoyage du corps (supprime signatures, citations, lignes vides) ──────
function cleanBody(raw: string, maxChars = 800): string {
  return raw
    .split('\n')
    .filter(line => {
      const t = line.trim();
      // Supprime lignes de citation, de signature, vides
      if (t.startsWith('>')) return false;
      if (/^[-_]{3,}$/.test(t)) return false;
      if (/^(De|From|À|To|Envoyé|Sent|Date|Objet|Subject)\s*:/i.test(t)) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxChars);
}

// ── Appel OpenRouter Gemini 2.5 Flash ─────────────────────────────────────
async function callGemini(prompt: string): Promise<any> {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) throw new Error('OPENROUTER_API_KEY non configuré');

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://knowy.ai',
      'X-Title': 'Knowy Email Analysis',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-lite',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 600,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  try {
    return JSON.parse(text);
  } catch {
    // Tentative d'extraction du JSON si enrobé de texte
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Réponse Gemini non parsable');
  }
}

// ── Main handler ──────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const auth = req.headers.get('Authorization');
  if (!auth) return jsonResponse({ error: 'Missing authorization header' }, 401);

  // Filet de sécurité global — capture toute exception non gérée
  try {

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const jwt = auth.replace('Bearer ', '');
  const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const { contactId, organizationId, providerToken: bodyGoogleToken, microsoftToken: bodyMsToken } = body;
  if (!contactId || !organizationId) {
    return jsonResponse({ error: 'contactId et organizationId requis' }, 400);
  }

  // 1. Résoudre les tokens (Google + Microsoft en parallèle)
  const [gmailToken, outlookToken] = await Promise.all([
    resolveGoogleToken(supabase, organizationId, user.id, bodyGoogleToken ?? null),
    resolveOutlookToken(supabase, organizationId, user.id, bodyMsToken ?? null),
  ]);

  if (!gmailToken && !outlookToken) {
    return jsonResponse({
      error: 'Aucun compte messagerie connecté. Connectez Gmail ou Outlook dans Paramètres → Connexions.',
      code: 'TOKEN_MISSING',
    }, 401);
  }

  // 2. Récupérer les external_message_id stockés pour ce contact (20 plus récents)
  const { data: storedMsgs, error: msgsErr } = await supabase
    .from('communication_messages')
    .select('external_message_id, direction, sent_at, subject, provider')
    .eq('contact_id', contactId)
    .eq('organization_id', organizationId)
    .order('sent_at', { ascending: false })
    .limit(20);

  if (msgsErr || !storedMsgs?.length) {
    return jsonResponse({
      error: 'Aucun email synchronisé pour ce contact. Lancez d\'abord une synchronisation.',
      code: 'NO_MESSAGES',
    }, 400);
  }

  // 3. Charger le nom du contact
  const { data: contactRow } = await supabase.from('contacts')
    .select('full_name, email, role_title, company_name')
    .eq('id', contactId).maybeSingle();

  const contactName = contactRow?.full_name ?? 'Contact';
  const userEmail = user.email ?? '';

  // 4. Récupérer les corps d'emails depuis Gmail ET/OU Outlook selon le provider
  const msgsToFetch = storedMsgs.slice(0, 10);
  const emailBodies: Array<{ direction: string; subject: string; body: string; date: string }> = [];

  await Promise.all(msgsToFetch.map(async (msg: any) => {
    const provider: string = msg.provider ?? 'google';
    try {
      if (provider === 'microsoft' && outlookToken) {
        // ── Microsoft Graph ────────────────────────────────────────────────
        const res = await fetch(
          `${GRAPH_API}/me/messages/${msg.external_message_id}?$select=body,subject,isDraft`,
          { headers: { Authorization: `Bearer ${outlookToken}`, ConsistencyLevel: 'eventual' } },
        );
        if (!res.ok) return;
        const graphMsg = await res.json();
        if (graphMsg.isDraft) return;
        const contentType: string = graphMsg.body?.contentType ?? 'text';
        const rawContent: string = graphMsg.body?.content ?? '';
        const text = contentType === 'html' ? stripHtml(rawContent) : rawContent;
        const cleanedBody = cleanBody(text, 800);
        if (cleanedBody.length > 20) {
          emailBodies.push({
            direction: msg.direction,
            subject: msg.subject ?? graphMsg.subject ?? '(Sans objet)',
            body: cleanedBody,
            date: msg.sent_at,
          });
        }
      } else if (gmailToken) {
        // ── Gmail API ─────────────────────────────────────────────────────
        const res = await fetch(
          `${GMAIL_API}/users/me/messages/${msg.external_message_id}?format=full`,
          { headers: { Authorization: `Bearer ${gmailToken}` } },
        );
        if (!res.ok) return;
        const gmailMsg = await res.json();
        const headers: Array<{ name: string; value: string }> = gmailMsg.payload?.headers ?? [];
        if (isNewsletter(headers)) return;
        const rawBody = extractTextPlain(gmailMsg.payload);
        const cleanedBody = cleanBody(rawBody, 800);
        if (cleanedBody.length > 20) {
          emailBodies.push({
            direction: msg.direction,
            subject: msg.subject ?? '(Sans objet)',
            body: cleanedBody,
            date: msg.sent_at,
          });
        }
      }
    } catch { /* ignore les erreurs individuelles */ }
  }));

  if (emailBodies.length === 0) {
    return jsonResponse({
      error: 'Impossible de lire les corps des emails. Vérifiez les permissions de votre messagerie.',
      code: 'BODY_READ_FAILED',
    }, 400);
  }

  // 5. Construire le contexte conversationnel (limité à ~6000 chars total)
  emailBodies.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let conversationContext = '';
  for (const e of emailBodies) {
    const label = e.direction === 'outbound' ? `[Moi → ${contactName}]` : `[${contactName} → Moi]`;
    const entry = `${label} Objet: ${e.subject}\n${e.body}\n\n`;
    if ((conversationContext + entry).length > 6000) break;
    conversationContext += entry;
  }

  // 6. Prompt cognitif / relationnel + extraction de nom depuis signatures
  const prompt = `Tu es un expert en intelligence relationnelle et en psychologie cognitive.

Analyse la relation professionnelle entre moi (${userEmail}) et ${contactName}${contactRow?.role_title ? ` (${contactRow.role_title}${contactRow.company_name ? ` chez ${contactRow.company_name}` : ''})` : ''} a travers ces echanges emails.

REGLES :
- Ne reproduis JAMAIS le contenu brut des emails
- Analyse uniquement le style, le ton et la dynamique relationnelle
- Pour le nom : cherche dans les signatures des emails RECUS (marques [${contactName} -> Moi]) le vrai nom complet de la personne (Prenom Nom). Regarde les lignes de signature comme "Cordialement, Jean Dupont", "Best, Sarah", "-- Marie Martin", etc.

ECHANGES :
${conversationContext}

Reponds UNIQUEMENT en JSON valide :
{
  "suggested_name": "Prenom Nom trouve dans les signatures, ou null si non trouve",
  "suggested_name_confidence": "high|medium|low — high = nom complet clair dans signature, medium = prenom seul ou ambigu, low = incertain",
  "relationship_tone": "chaud|neutre|froid",
  "formality": "tres formel|formel|semi-formel|informel",
  "engagement_level": "tres eleve|eleve|modere|faible",
  "communication_style": "analytique|assertif|empathique|directif|collaboratif",
  "key_topics": ["max 5 themes identifies"],
  "behavioral_signals": ["max 5 signaux comportementaux observables"],
  "relationship_summary": "2-3 phrases de synthese relationnelle en francais",
  "contact_engagement": "description courte",
  "my_posture": "description courte",
  "red_flags": [],
  "opportunities": [],
  "emails_analyzed": ${emailBodies.length}
}`;

  let analysis: any;
  try {
    analysis = await callGemini(prompt);
  } catch (e: any) {
    return jsonResponse({ error: `Analyse IA échouée : ${e.message}`, code: 'AI_FAILED' }, 500);
  }

  // 7. Enrichir le résultat avec des métadonnées
  const result = {
    ...analysis,
    analyzed_at: new Date().toISOString(),
    emails_analyzed: emailBodies.length,
    model: 'gemini-2.5-flash-lite',
  };

  // 8. Renommage automatique depuis les signatures — si confiance high ou medium
  let nameUpdated = false;
  let previousName: string | null = null;
  const suggestedName: string | null = analysis.suggested_name ?? null;
  const nameConfidence: string = analysis.suggested_name_confidence ?? 'low';

  if (
    suggestedName &&
    suggestedName.trim().length > 1 &&
    (nameConfidence === 'high' || nameConfidence === 'medium') &&
    suggestedName.trim().toLowerCase() !== contactName.toLowerCase()
  ) {
    // Valide que le nom suggéré ressemble à un vrai nom (au moins 2 mots ou 1 mot de plus de 3 chars)
    const cleanName = suggestedName.trim();
    const wordCount = cleanName.split(/\s+/).filter(w => w.length > 1).length;
    if (wordCount >= 1 && cleanName.length >= 3 && !/[@.]/.test(cleanName)) {
      const { error: renameErr } = await supabase.from('contacts')
        .update({ full_name: cleanName, updated_at: new Date().toISOString() })
        .eq('id', contactId)
        .eq('organization_id', organizationId);
      if (!renameErr) {
        nameUpdated = true;
        previousName = contactName;
        console.log(`Contact renamed: "${contactName}" -> "${cleanName}" (confidence: ${nameConfidence})`);
      } else {
        console.error('Rename error:', renameErr.message);
      }
    }
  }

  // 9. Stocker dans contacts.email_analysis — jamais le texte brut
  const { error: saveErr } = await supabase.from('contacts')
    .update({ email_analysis: result, updated_at: new Date().toISOString() })
    .eq('id', contactId)
    .eq('organization_id', organizationId);

  if (saveErr) {
    console.error('Save error:', saveErr.message);
  }

  return jsonResponse({
    success: true,
    analysis: result,
    name_updated: nameUpdated,
    previous_name: previousName,
    new_name: nameUpdated ? suggestedName?.trim() : null,
  });

  } catch (e: any) {
    console.error('Uncaught error:', e?.message ?? String(e), e?.stack ?? '');
    return jsonResponse({ error: `Erreur interne : ${e?.message ?? String(e)}`, code: 'INTERNAL_ERROR' }, 500);
  }
});

