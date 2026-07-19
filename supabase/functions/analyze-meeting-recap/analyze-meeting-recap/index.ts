// Spec-27 — Compte-rendu (état « Après ») généré par IA depuis un transcript / une saisie.
// L'utilisateur colle/charge un compte-rendu → l'IA l'analyse selon la doctrine Knowr → meeting_post_summaries.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'google/gemini-2.5-flash-lite';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const auth = req.headers.get('Authorization');
  if (!auth) return jsonResponse({ error: 'Missing authorization header' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const { data: { user }, error: userErr } = await supabase.auth.getUser(auth.replace('Bearer ', ''));
  if (userErr || !user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const { meetingId, organizationId, transcript } = body;
  if (!meetingId || !organizationId) return jsonResponse({ error: 'meetingId and organizationId required' }, 400);
  if (!transcript || String(transcript).trim().length < 20) {
    return jsonResponse({ error: 'Transcript trop court — collez le compte-rendu ou les notes de la réunion.', code: 'TOO_SHORT' }, 400);
  }

  // Contexte : titre réunion + participants
  const { data: meeting } = await supabase
    .from('meetings').select('title, company, starts_at')
    .eq('id', meetingId).eq('organization_id', organizationId).maybeSingle();

  const { data: parts } = await supabase
    .from('meeting_participants')
    .select('display_name, name, contacts(full_name)')
    .eq('meeting_id', meetingId).eq('organization_id', organizationId);

  const participantNames = (parts ?? [])
    .map((p: any) => p.contacts?.full_name || p.display_name || p.name)
    .filter(Boolean);

  const key = Deno.env.get('OPENROUTER_API_KEY');
  if (!key) return jsonResponse({ error: 'LLM non configuré (OPENROUTER_API_KEY manquant).', code: 'NO_LLM' }, 500);

  const SYSTEM = `Tu es l'analyste relationnel de Knowr (OS Relationnel B2B). Tu produis le COMPTE-RENDU (état « Après ») d'une réunion à partir de notes/transcript bruts.
Doctrine Knowr (NON négociable) :
- Zéro-hallucination : n'affirme que ce qui est dans le texte fourni. Aucune donnée inventée. Si une info manque, ne l'invente pas.
- Comportement > titre : analyse les décisions, engagements, objections réelles, signaux de relation (chaud/froid, momentum, risque).
- Une réunion commerciale a des OBJECTIONS : extrais-les si présentes.
- Les tâches portent un owner et une échéance si mentionnés, sinon null.
Réponds UNIQUEMENT en JSON valide.`;

  const USER = `Réunion : ${meeting?.title ?? 'Sans titre'}${meeting?.company && meeting.company !== '—' ? ' · ' + meeting.company : ''}
Participants connus : ${participantNames.length ? participantNames.join(', ') : 'non précisés'}

NOTES / TRANSCRIPT BRUT :
"""
${String(transcript).slice(0, 12000)}
"""

Produis ce JSON (français, concis, fidèle au texte) :
{
  "summary_text": "synthèse 3-5 phrases : ce qui a été décidé, ce qui a changé dans la relation",
  "key_decisions": ["décision 1", "décision 2"],
  "action_items": [{"text":"tâche", "owner":null|"nom", "due":null|"échéance"}],
  "objections": ["objection ou tension soulevée"],
  "per_person": [{"name":"participant", "impact":"ce que la réunion change pour la relation avec lui"}],
  "analysis": "lecture relationnelle Knowr : posture à adopter, momentum, risque/levier détecté",
  "tags": ["mot-clé"]
}`;

  let parsed: any = {};
  try {
    const res = await fetch(OPENROUTER_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://knowy.ai',
        'X-Title': 'Knowr Meeting Recap',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: USER }],
        temperature: 0.2,
        max_tokens: 1800,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) return jsonResponse({ error: `LLM error ${res.status}` }, 502);
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content ?? '{}';
    try { parsed = JSON.parse(raw); }
    catch { const m = raw.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); }
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'Erreur LLM' }, 502);
  }

  // Persistance (upsert sur meeting_id unique)
  const row = {
    organization_id: organizationId,
    meeting_id: meetingId,
    summary_text: parsed.summary_text ?? null,
    key_decisions: parsed.key_decisions ?? [],
    action_items: parsed.action_items ?? [],
    objections: parsed.objections ?? [],
    tags: parsed.tags ?? [],
    sources: { kind: 'saisie_manuelle', per_person: parsed.per_person ?? [], analysis: parsed.analysis ?? null },
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data: saved, error: upErr } = await supabase
    .from('meeting_post_summaries')
    .upsert(row, { onConflict: 'meeting_id' })
    .select('*')
    .single();

  if (upErr) return jsonResponse({ error: upErr.message }, 500);

  return jsonResponse({ success: true, summary: saved });
});

