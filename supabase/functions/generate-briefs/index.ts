// Préparation de réunion (T-48h max, aligné sur generate_user_notifications) +
// digest quotidien (SPEC-08 adapté à la cadence déjà configurée dans
// notification_preferences.daily_digest_time, plutôt qu'une cadence hebdo
// imposée qui contredirait un réglage déjà existant et configurable).
//
// mode par défaut : génère le contenu des briefs pour les réunions externes
// proches sans brief, puis rafraîchit les rappels via generate_user_notifications
// (fonction SQL existante mais jamais appelée jusqu'ici).
// mode "digest" : envoie le digest quotidien aux utilisateurs dont l'heure
// préférée correspond au tick courant, une fois par jour maximum.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const MAX_MEETINGS_PER_RUN = 30;
const GENERATION_WINDOW_HOURS = 48;
const DIGEST_WINDOW_MINUTES = 7; // cron toutes les 15 min : tolérance pour matcher l'heure préférée sans trou

type SupabaseClient = ReturnType<typeof createClient>;

type Meeting = {
  id: string; organization_id: string; owner_user_id: string | null; user_id: string | null;
  company_id: string | null; title: string; starts_at: string | null; is_external: boolean | null;
};

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  async function next(): Promise<void> {
    const current = index++;
    if (current >= items.length) return;
    await worker(items[current]);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
}

function band(score: number | null): string | null {
  if (score === null || score === undefined) return null;
  return score >= 70 ? 'solide' : score >= 50 ? 'intermediaire' : 'fragile';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  // trace_id : identifiant de corrélation propagé dans tous les logs de cette
  // invocation (SPEC-10 §14 — traçage de bout en bout, sans contenu métier).
  const traceId = crypto.randomUUID();
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const body = await req.json().catch(() => ({}));

  const cronHeader = req.headers.get('x-cron-secret');
  let isCron = false;
  if (cronHeader) {
    const { data: sec } = await supabase.from('app_secrets').select('value').eq('name', 'monitor_cron').maybeSingle();
    if (sec?.value && sec.value === cronHeader) isCron = true;
  }
  if (!isCron) {
    // Génération transverse multi-organisation : réservée au cron pour l'instant,
    // pas d'usage interactif prévu (pas de bouton "générer maintenant" côté UI).
    return jsonResponse({ error: 'Cette fonction est réservée au cron.', trace_id: traceId }, 403);
  }

  console.log(JSON.stringify({ trace_id: traceId, fn: 'generate-briefs', mode: body.mode === 'digest' ? 'digest' : 'briefs', event: 'start' }));
  const result = body.mode === 'digest' ? await runDigest(supabase, traceId) : await runBriefs(supabase, traceId);
  const resultBody = await result.clone().json().catch(() => ({}));
  console.log(JSON.stringify({ trace_id: traceId, fn: 'generate-briefs', event: 'end', ...resultBody }));
  return result;
});

async function runBriefs(supabase: SupabaseClient, traceId: string) {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + GENERATION_WINDOW_HOURS * 3_600_000);

  const { data: meetingsData, error } = await supabase
    .from('meetings')
    .select('id,organization_id,owner_user_id,user_id,company_id,title,starts_at,is_external')
    .or('brief_status.eq.to_generate,brief_status.is.null')
    .eq('is_external', true)
    .gte('starts_at', now.toISOString())
    .lte('starts_at', windowEnd.toISOString())
    .order('starts_at', { ascending: true })
    .limit(MAX_MEETINGS_PER_RUN);
  if (error) return jsonResponse({ success: false, trace_id: traceId, error: error.message }, 500);
  const meetings = (meetingsData ?? []) as Meeting[];
  if (!meetings.length) return jsonResponse({ success: true, trace_id: traceId, scanned: 0, generated: 0 });

  let generated = 0;
  let insufficient = 0;
  let failed = 0;
  const notifyTargets = new Map<string, { userId: string; orgId: string }>();

  await runWithConcurrency(meetings, 5, async (meeting) => {
    try {
      const [participantsRes, companyScoreRes, companyRecosRes, companySignalsRes] = await Promise.all([
        supabase.from('meeting_participants').select('contact_id,display_name,role_in_meeting').eq('meeting_id', meeting.id).not('contact_id', 'is', null),
        meeting.company_id
          ? supabase.from('account_relationship_score_snapshots').select('score,phase,computed_at').eq('company_id', meeting.company_id).order('computed_at', { ascending: false }).limit(1).maybeSingle()
          : Promise.resolve({ data: null as { score: number; phase: string | null } | null }),
        meeting.company_id
          ? supabase.from('account_recommendations').select('title,justification,priority').eq('company_id', meeting.company_id).eq('status', 'open').order('priority', { ascending: false }).limit(2)
          : Promise.resolve({ data: [] as Array<{ title: string; justification: string }> }),
        meeting.company_id
          ? supabase.from('company_signals').select('title,summary,observed_at').eq('company_id', meeting.company_id).order('observed_at', { ascending: false }).limit(2)
          : Promise.resolve({ data: [] as Array<{ title: string; summary: string | null; observed_at: string }> }),
      ]);

      const participants = (participantsRes.data ?? []) as Array<{ contact_id: string; display_name: string | null; role_in_meeting: string | null }>;
      const contactIds = participants.map((p) => p.contact_id).filter((id): id is string => Boolean(id));

      const [contactsRes, scoresRes, recosRes] = await Promise.all([
        contactIds.length ? supabase.from('contacts').select('id,full_name').in('id', contactIds) : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }> }),
        contactIds.length ? supabase.from('contact_score_history').select('contact_id,score,phase,snapshot_date').in('contact_id', contactIds).order('snapshot_date', { ascending: false }) : Promise.resolve({ data: [] as Array<{ contact_id: string; score: number; phase: string | null }> }),
        contactIds.length ? supabase.from('person_recommendations').select('contact_id,title').in('contact_id', contactIds).eq('status', 'open').order('priority', { ascending: false }) : Promise.resolve({ data: [] as Array<{ contact_id: string; title: string }> }),
      ]);

      const namesByContact = new Map((contactsRes.data ?? []).map((c) => [c.id, c.full_name]));
      const latestScoreByContact = new Map<string, { score: number; phase: string | null }>();
      for (const row of (scoresRes.data ?? [])) {
        if (!latestScoreByContact.has(row.contact_id)) latestScoreByContact.set(row.contact_id, { score: row.score, phase: row.phase });
      }
      const recoByContact = new Map<string, string>();
      for (const row of (recosRes.data ?? [])) {
        if (!recoByContact.has(row.contact_id)) recoByContact.set(row.contact_id, row.title);
      }

      const participantBlocks = participants.map((p) => {
        const scoreRow = latestScoreByContact.get(p.contact_id);
        const score = scoreRow?.score ?? null;
        return {
          contactId: p.contact_id,
          name: namesByContact.get(p.contact_id) ?? p.display_name ?? 'Contact',
          role: p.role_in_meeting,
          score,
          band: band(score),
          openRecommendation: recoByContact.get(p.contact_id) ?? null,
        };
      });

      const companyScore = companyScoreRes.data as { score: number; phase: string | null } | null;
      const companyRecos = (companyRecosRes.data ?? []) as Array<{ title: string; justification: string }>;
      const companySignals = (companySignalsRes.data ?? []) as Array<{ title: string; summary: string | null; observed_at: string }>;
      const hasCompanyData = meeting.company_id !== null && (companyScore !== null || companyRecos.length > 0 || companySignals.length > 0);
      const hasParticipantData = participantBlocks.some((p) => p.score !== null || p.openRecommendation !== null);

      if (!hasCompanyData && !hasParticipantData) {
        await supabase.from('meetings').update({ brief_status: 'insufficient_data' }).eq('id', meeting.id);
        insufficient++;
        return;
      }

      const content = {
        meeting: { id: meeting.id, title: meeting.title, startsAt: meeting.starts_at },
        account: meeting.company_id ? {
          companyId: meeting.company_id,
          score: companyScore?.score ?? null,
          band: band(companyScore?.score ?? null),
          phase: companyScore?.phase ?? null,
          openRecommendations: companyRecos.map((r) => ({ title: r.title, justification: r.justification })),
          recentSignals: companySignals.map((s) => ({ title: s.title, summary: s.summary, observedAt: s.observed_at })),
        } : null,
        participants: participantBlocks,
      };
      const dataPoints = [hasCompanyData, hasParticipantData, companyRecos.length > 0, participantBlocks.some((p) => p.openRecommendation !== null)].filter(Boolean).length;
      const confidenceScore = Math.round((dataPoints / 4) * 100);

      const { error: insertError } = await supabase.from('briefs').insert({
        organization_id: meeting.organization_id,
        meeting_id: meeting.id,
        brief_type: 'meeting_preparation',
        status: 'ready',
        confidence_score: confidenceScore,
        content,
        sources: [
          ...(meeting.company_id ? [{ type: 'account', id: meeting.company_id }] : []),
          ...contactIds.map((id) => ({ type: 'contact', id })),
        ],
      });
      if (insertError) {
        failed++;
        await supabase.from('meetings').update({ brief_status: 'failed' }).eq('id', meeting.id);
        return;
      }

      await supabase.from('meetings').update({ brief_status: 'ready' }).eq('id', meeting.id);
      generated++;

      const targetUser = meeting.owner_user_id ?? meeting.user_id;
      if (targetUser) notifyTargets.set(`${meeting.organization_id}:${targetUser}`, { userId: targetUser, orgId: meeting.organization_id });
    } catch (err) {
      failed++;
      await supabase.from('meetings').update({ brief_status: 'failed' }).eq('id', meeting.id);
      console.error(JSON.stringify({ trace_id: traceId, fn: 'generate-briefs', event: 'meeting_failed', meeting_id: meeting.id, message: err instanceof Error ? err.message : String(err) }));
    }
  });

  for (const target of notifyTargets.values()) {
    await supabase.rpc('generate_user_notifications', { p_user_id: target.userId, p_org_id: target.orgId });
  }

  return jsonResponse({ success: true, trace_id: traceId, scanned: meetings.length, generated, insufficient, failed, notified: notifyTargets.size });
}

async function runDigest(supabase: SupabaseClient, traceId: string) {
  const now = new Date();
  const parisNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const nowMinutes = parisNow.getHours() * 60 + parisNow.getMinutes();

  const { data: prefsData, error } = await supabase
    .from('notification_preferences')
    .select('user_id,organization_id,daily_digest_time')
    .eq('daily_digest_enabled', true);
  if (error) return jsonResponse({ success: false, trace_id: traceId, error: error.message }, 500);
  const prefs = (prefsData ?? []) as Array<{ user_id: string; organization_id: string; daily_digest_time: string }>;
  if (!prefs.length) return jsonResponse({ success: true, trace_id: traceId, sent: 0, checked: 0 });

  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  let sent = 0;
  for (const pref of prefs) {
    const [hourRaw, minuteRaw] = pref.daily_digest_time.split(':');
    const targetMinutes = (Number(hourRaw) || 8) * 60 + (Number(minuteRaw) || 0);
    if (Math.abs(nowMinutes - targetMinutes) > DIGEST_WINDOW_MINUTES) continue;

    const { data: already } = await supabase.from('notifications').select('id').eq('user_id', pref.user_id).eq('type', 'daily_digest').gte('created_at', todayStart.toISOString()).limit(1);
    if (already?.length) continue;

    const dayAgo = new Date(now.getTime() - 24 * 3_600_000).toISOString();
    const [scoresRes, companySignalsRes, behavioralSignalsRes] = await Promise.all([
      supabase.from('account_relationship_score_snapshots').select('company_id,score,computed_at').eq('organization_id', pref.organization_id).order('computed_at', { ascending: false }).limit(2000),
      supabase.from('company_signals').select('id').eq('organization_id', pref.organization_id).gte('observed_at', dayAgo),
      supabase.from('behavioral_signals').select('id').eq('organization_id', pref.organization_id).gte('observed_at', dayAgo),
    ]);

    const latestByCompany = new Map<string, number>();
    for (const row of (scoresRes.data ?? []) as Array<{ company_id: string; score: number }>) {
      if (!latestByCompany.has(row.company_id)) latestByCompany.set(row.company_id, row.score);
    }
    let fragile = 0, intermediate = 0, strong = 0;
    for (const score of latestByCompany.values()) {
      if (score < 50) fragile++;
      else if (score < 70) intermediate++;
      else strong++;
    }
    const newSignals = (companySignalsRes.data?.length ?? 0) + (behavioralSignalsRes.data?.length ?? 0);

    if (!latestByCompany.size && !newSignals) continue; // rien à dire : pas de digest vide trompeur

    const body = `Portefeuille : ${strong} solide${strong > 1 ? 's' : ''}, ${intermediate} intermédiaire${intermediate > 1 ? 's' : ''}, ${fragile} fragile${fragile > 1 ? 's' : ''} · ${newSignals} nouveau${newSignals > 1 ? 'x' : ''} signal${newSignals > 1 ? 'aux' : ''} sur 24 h.`;

    const { error: insertError } = await supabase.from('notifications').insert({
      organization_id: pref.organization_id,
      user_id: pref.user_id,
      type: 'daily_digest',
      priority: 'info',
      title: 'Digest quotidien',
      body,
      entity_type: null,
      entity_id: null,
      link: '/app/home',
    });
    if (!insertError) sent++;
  }
  return jsonResponse({ success: true, trace_id: traceId, sent, checked: prefs.length });
}
