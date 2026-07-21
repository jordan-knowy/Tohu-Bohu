// Scoring relationnel EN MASSE (doc 08) → cognitive_profiles + historique mensuel (contact_score_history) + NPS (nps_snapshots).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const W = { intensite: 0.40, reciprocite: 0.35, longevite: 0.25 };
const PHASE_DELTA = 8.0, PHASE_DECLINE_MAX = 70, HONEYMOON_DAYS = 45, HL_MIN = 30, HL_MAX = 180;
// Score compte : mêmes seuils de phase que le score personne (cohérence de lecture),
// demi-vie de récence plus longue car un compte reste "vivant" plus longtemps qu'un contact isolé.
const ACCOUNT_PHASE_DELTA = 8, ACCOUNT_PHASE_DECLINE_MAX = 70, ACCOUNT_RECENCY_HALFLIFE_DAYS = 90;
const RECENT_WINDOW_MS = 14 * 86400000;
const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v));
const temporalDecay = (days: number, depth: number) => Math.exp(-(Math.LN2 / (HL_MIN + depth * (HL_MAX - HL_MIN))) * days);
const honeymoon = (raw: number, age: number) => age >= HONEYMOON_DAYS ? raw : Math.min(raw, 0.45 + (age / HONEYMOON_DAYS) * 0.20);

interface Stats { emailsLast30: number; meetingsLast90: number; avgThreadDepth: number; channelCount: number; initiationRatio: number; responseRate: number; responseTimeRatio: number; ageInDays: number; daysSinceLastContact: number; monthlyExchangeCounts: number[]; quartersWithMeetings: number; totalInteractions: number; }

function scoreIntensite(s: Stats): number {
  const emailFreqNorm = clamp(s.emailsLast30 / 4);
  const emailFreqCapped = (s.initiationRatio > 0.85 || s.initiationRatio < 0.15) ? Math.min(emailFreqNorm, 0.50) : emailFreqNorm;
  const meetingFreqNorm = clamp((s.meetingsLast90 / 90) / (1 / 30));
  const richness = s.channelCount >= 3 ? 1.0 : s.channelCount === 2 ? 0.65 : 0.25;
  return emailFreqCapped * 0.40 + meetingFreqNorm * 0.35 + richness * 0.15 + clamp(s.avgThreadDepth / 5) * 0.10;
}
function scoreReciprocite(s: Stats): number {
  const asym = Math.abs(s.initiationRatio - 0.5) * 2;
  return Math.max(0.40, 1.0 - asym * 0.60) * 0.50 + clamp(s.responseRate) * 0.30 + clamp(s.responseTimeRatio / 2) * 0.20;
}
function scoreLongevite(s: Stats): { score: number; factor: number } {
  if (s.ageInDays < 30) return { score: 0, factor: 0 };
  const factor = s.ageInDays < 90 ? (s.ageInDays - 30) / 60 : 1.0;
  const ageScore = clamp(s.ageInDays / (24 * 30));
  let consistency = 0.5;
  if (s.monthlyExchangeCounts.length >= 3) {
    const mean = s.monthlyExchangeCounts.reduce((a, b) => a + b, 0) / s.monthlyExchangeCounts.length;
    if (mean > 0) {
      const variance = s.monthlyExchangeCounts.reduce((a, b) => a + (b - mean) ** 2, 0) / s.monthlyExchangeCounts.length;
      consistency = Math.max(0, 1.0 - (Math.sqrt(variance) / mean) / 2.0);
    }
  }
  return { score: (ageScore * 0.45 + consistency * 0.35 + (s.quartersWithMeetings / 4) * 0.20) * factor, factor };
}
function buildStats(allMsgs: any[], allMeets: any[], firstSeen: string | null, nowMs: number): Stats {
  const messages = allMsgs.filter(m => m.sent_at && new Date(m.sent_at).getTime() <= nowMs);
  const meetings = allMeets.filter(m => m.starts_at && new Date(m.starts_at).getTime() <= nowMs);
  const c30 = nowMs - 30 * 86400000, c90 = nowMs - 90 * 86400000;
  const outbound = messages.filter(m => m.direction === 'outbound').length;
  const inbound = messages.filter(m => m.direction === 'inbound').length;
  const total = messages.length || 1;
  const initiationRatio = outbound / total;
  const responseRate = total > 1 ? clamp((Math.min(inbound, outbound) * 2) / total) : 0.3;
  const rts = messages.filter(m => (m.metadata as any)?.response_time_hours != null).map(m => (m.metadata as any).response_time_hours);
  const avgRt = rts.length ? rts.reduce((a: number, b: number) => a + b, 0) / rts.length : 24;
  const responseTimeRatio = clamp(24 / Math.max(avgRt, 1), 0, 4) / 4;
  const threads = new Map<string, number>();
  for (const m of messages) if (m.thread_id) threads.set(m.thread_id, (threads.get(m.thread_id) || 0) + 1);
  const avgThreadDepth = threads.size ? Array.from(threads.values()).reduce((a, b) => a + b, 0) / threads.size : 1;
  const channelCount = (messages.length > 0 ? 1 : 0) + (meetings.length > 0 ? 1 : 0);
  const ageInDays = firstSeen ? Math.round((nowMs - new Date(firstSeen).getTime()) / 86400000)
    : messages.length > 0 ? Math.round((nowMs - new Date(messages[messages.length - 1].sent_at).getTime()) / 86400000) : 0;
  const allDates = [...messages.map(m => new Date(m.sent_at).getTime()), ...meetings.map(m => new Date(m.starts_at).getTime())];
  const lastContact = allDates.length ? Math.max(...allDates) : 0;
  const daysSinceLastContact = lastContact ? Math.round((nowMs - lastContact) / 86400000) : 999;
  const monthlyExchangeCounts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const start = nowMs - (i + 1) * 30 * 86400000, end = nowMs - i * 30 * 86400000;
    monthlyExchangeCounts.push(messages.filter(m => { const t = new Date(m.sent_at).getTime(); return t > start && t <= end; }).length);
  }
  const quartersWithMeetings = [0, 1, 2, 3].filter(q => {
    const start = nowMs - (q + 1) * 90 * 86400000, end = nowMs - q * 90 * 86400000;
    return meetings.some(m => { const t = new Date(m.starts_at).getTime(); return t > start && t <= end; });
  }).length;
  return {
    emailsLast30: messages.filter(m => new Date(m.sent_at).getTime() > c30).length,
    meetingsLast90: meetings.filter(m => new Date(m.starts_at).getTime() > c90).length,
    avgThreadDepth, channelCount, initiationRatio, responseRate, responseTimeRatio, ageInDays, daysSinceLastContact,
    monthlyExchangeCounts, quartersWithMeetings, totalInteractions: messages.length + meetings.length * 4,
  };
}
function computeScore(stats: Stats, prevScore: number | null) {
  const si = scoreIntensite(stats), sr = scoreReciprocite(stats);
  const { score: sl, factor: lf } = scoreLongevite(stats);
  const ew = lf < 1 ? { intensite: W.intensite + W.longevite * (1 - lf) * 0.54, reciprocite: W.reciprocite + W.longevite * (1 - lf) * 0.46, longevite: W.longevite * lf } : W;
  const raw = si * ew.intensite + sr * ew.reciprocite + sl * ew.longevite;
  const finalScore = Math.round(clamp(honeymoon(raw, stats.ageInDays) * temporalDecay(stats.daysSinceLastContact, clamp(stats.totalInteractions / 500))) * 100);
  const delta = finalScore - (prevScore ?? finalScore);
  let phase: 'growth' | 'stagnant' | 'decline' = 'stagnant';
  if (delta >= PHASE_DELTA) phase = 'growth';
  else if (delta <= -PHASE_DELTA && finalScore <= PHASE_DECLINE_MAX) phase = 'decline';
  return { finalScore, delta, phase, si: Math.round(si * 100), sr: Math.round(sr * 100), sl: Math.round(sl * 100), confidence: Math.min(90, 30 + stats.totalInteractions * 3) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const body = await req.json().catch(() => ({}));

  const cronHeader = req.headers.get('x-cron-secret');
  let isCron = false;
  if (cronHeader) {
    const { data: sec } = await supabase.from('app_secrets').select('value').eq('name', 'monitor_cron').maybeSingle();
    if (sec?.value && sec.value === cronHeader) isCron = true;
  }

  let cq = supabase.from('contacts').select('id, organization_id, created_at, owner_user_id, company_id').eq('is_tracked', true).is('merged_into_contact_id', null);
  if (!isCron) {
    const auth = req.headers.get('Authorization');
    if (!auth) return jsonResponse({ error: 'Missing authorization' }, 401);
    const { data: { user }, error: uErr } = await supabase.auth.getUser(auth.replace('Bearer ', ''));
    if (uErr || !user) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!body.organizationId) return jsonResponse({ error: 'organizationId required' }, 400);
    cq = cq.eq('organization_id', body.organizationId);
  } else if (body.organizationId) {
    cq = cq.eq('organization_id', body.organizationId);
  }
  const { data: contacts } = await cq.limit(2000);
  if (!contacts?.length) return jsonResponse({ success: true, scored: 0 });

  const ids = contacts.map((c: any) => c.id);
  const orgIds = Array.from(new Set(contacts.map((c: any) => c.organization_id)));
  const contactOrgMap = new Map<string, string>(contacts.map((c: any) => [c.id, c.organization_id]));
  const companyIds = Array.from(new Set(contacts.map((c: any) => c.company_id).filter(Boolean))) as string[];

  const [{ data: msgs }, { data: parts }, { data: prevProfiles }, { data: mems }] = await Promise.all([
    supabase.from('communication_messages').select('contact_id, direction, sent_at, thread_id, metadata').in('contact_id', ids).limit(10000),
    supabase.from('meeting_participants').select('contact_id, meetings(starts_at)').in('contact_id', ids).limit(10000),
    supabase.from('cognitive_profiles').select('contact_id, engagement_score').in('contact_id', ids),
    supabase.from('memberships').select('organization_id, user_id, role').in('organization_id', orgIds),
  ]);

  // ── Scope compte (santé + recommandations) : chargé une fois pour tout le run ──
  const trackedCompanySet = new Set<string>();
  const companyStrategic = new Map<string, boolean>();
  const companyOwner = new Map<string, string | null>();
  const decisionMakersByCompany = new Map<string, Set<string>>();
  const prevAccountScoreByCompany = new Map<string, number>();
  const accountSignalsByCompany = new Map<string, any[]>();
  const companyContactTotal = new Map<string, number>();
  const companyOrgId = new Map<string, string>();
  for (const c of contacts as any[]) {
    if (!c.company_id) continue;
    companyContactTotal.set(c.company_id, (companyContactTotal.get(c.company_id) ?? 0) + 1);
    if (!companyOrgId.has(c.company_id)) companyOrgId.set(c.company_id, c.organization_id);
  }
  if (companyIds.length) {
    const recentCutoff = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
    const [{ data: trackedCompanies }, { data: accountSettingsRows }, { data: contactRoles }, { data: prevAccountScores }, { data: recentAccountSignals }] = await Promise.all([
      supabase.from('companies').select('id').in('id', companyIds).eq('is_tracked', true),
      supabase.from('account_settings').select('company_id, strategic, primary_owner_user_id').in('company_id', companyIds),
      supabase.from('account_contact_roles').select('company_id, contact_id').in('company_id', companyIds).eq('active', true).not('decision_role', 'is', null),
      supabase.from('account_relationship_score_snapshots').select('company_id, score, computed_at').in('company_id', companyIds).order('computed_at', { ascending: false }),
      supabase.from('company_signals').select('id, company_id, family, title, observed_at').in('company_id', companyIds).in('family', ['risque', 'churn']).eq('status', 'candidate').gte('observed_at', recentCutoff),
    ]);
    for (const row of (trackedCompanies ?? []) as any[]) trackedCompanySet.add(row.id);
    for (const row of (accountSettingsRows ?? []) as any[]) { companyStrategic.set(row.company_id, row.strategic === true); companyOwner.set(row.company_id, row.primary_owner_user_id ?? null); }
    for (const row of (contactRoles ?? []) as any[]) { if (!decisionMakersByCompany.has(row.company_id)) decisionMakersByCompany.set(row.company_id, new Set()); decisionMakersByCompany.get(row.company_id)!.add(row.contact_id); }
    for (const row of (prevAccountScores ?? []) as any[]) { if (!prevAccountScoreByCompany.has(row.company_id) && row.score != null) prevAccountScoreByCompany.set(row.company_id, row.score); }
    for (const row of (recentAccountSignals ?? []) as any[]) { if (!accountSignalsByCompany.has(row.company_id)) accountSignalsByCompany.set(row.company_id, []); accountSignalsByCompany.get(row.company_id)!.push(row); }
  }

  const recentCareerCutoff = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
  const [{ data: recentCareerChanges }, { data: openPersonRecs }] = await Promise.all([
    supabase.from('person_career_entries').select('id, contact_id, title, organization_name, created_at').in('contact_id', ids).eq('entry_type', 'detected_change').gte('created_at', recentCareerCutoff),
    supabase.from('person_recommendations').select('contact_id, category').in('contact_id', ids).eq('status', 'open'),
  ]);
  let openAccountRecs: any[] = [];
  if (companyIds.length) {
    const { data } = await supabase.from('account_recommendations').select('company_id, category, source_signal_id').in('company_id', companyIds).eq('status', 'open');
    openAccountRecs = data ?? [];
  }
  const openPersonRecKey = new Set((openPersonRecs ?? []).map((r: any) => `${r.contact_id}|${r.category}`));
  const openAccountRecKey = new Set(openAccountRecs.map((r: any) => `${r.company_id}|${r.category}`));
  const openAccountRecBySignal = new Set(openAccountRecs.filter((r: any) => r.source_signal_id).map((r: any) => r.source_signal_id));

  const msgsByC = new Map<string, any[]>();
  for (const m of (msgs ?? [])) { if (!msgsByC.has(m.contact_id)) msgsByC.set(m.contact_id, []); msgsByC.get(m.contact_id)!.push(m); }
  const meetsByC = new Map<string, any[]>();
  for (const p of (parts ?? [])) { const mt = (p as any).meetings; if (!mt) continue; if (!meetsByC.has(p.contact_id)) meetsByC.set(p.contact_id, []); meetsByC.get(p.contact_id)!.push(mt); }
  const prevByC = new Map<string, number>();
  for (const p of (prevProfiles ?? [])) if ((p as any).engagement_score != null) prevByC.set(p.contact_id, (p as any).engagement_score);
  const orgOwner = new Map<string, string>();
  for (const m of (mems ?? []) as any[]) { if (!orgOwner.has(m.organization_id) || m.role === 'owner') orgOwner.set(m.organization_id, m.user_id); }

  const profileRows: any[] = [];
  const histRows: any[] = [];
  const relationshipRows: any[] = [];
  const personSnapshotRows: any[] = [];
  const personRecRows: any[] = [];
  type CompanyEngaged = { contactId: string; score: number; interactions: number; lastContactMs: number | null };
  const companyEngaged = new Map<string, CompanyEngaged[]>();
  const MONTHS = [5, 4, 3, 2, 1, 0];
  const now = Date.now();

  for (const c of contacts as any[]) {
    const cm = (msgsByC.get(c.id) ?? []).sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime());
    const cmeet = meetsByC.get(c.id) ?? [];
    const userId = c.owner_user_id ?? orgOwner.get(c.organization_id) ?? null;
    let lastScore: number | null = null;
    for (const ma of MONTHS) {
      const nowMs = ma === 0 ? now : now - ma * 30 * 86400000;
      const stats = buildStats(cm, cmeet, c.created_at, nowMs);
      if (stats.totalInteractions === 0) continue;
      const r = computeScore(stats, ma === 0 ? (prevByC.get(c.id) ?? null) : lastScore);
      lastScore = r.finalScore;
      const snapDate = new Date(nowMs).toISOString().slice(0, 10);
      if (userId) histRows.push({ organization_id: c.organization_id, contact_id: c.id, user_id: userId, score: r.finalScore, phase: r.phase, score_intensite: r.si, score_reciprocite: r.sr, score_longevite: r.sl, snapshot_date: snapDate });
      if (ma === 0) {
        const interactionDates = [
          ...cm.map((message: any) => message.sent_at),
          ...cmeet.map((meeting: any) => meeting.starts_at),
        ].filter(Boolean).map((value: string) => new Date(value).getTime()).filter(Number.isFinite);
        const lastInteractionAt = interactionDates.length ? new Date(Math.max(...interactionDates)).toISOString() : null;
        profileRows.push({ organization_id: c.organization_id, contact_id: c.id, profile_version: 1, engagement_score: r.finalScore, score_delta: r.delta, score_phase: r.phase, score_intensite: r.si, score_reciprocite: r.sr, score_longevite: r.sl, global_confidence: r.confidence, updated_at: new Date().toISOString() });
        if (userId) relationshipRows.push({ organization_id: c.organization_id, user_id: userId, contact_id: c.id, engagement_score: r.finalScore, score_evolution: r.delta, phase: r.phase, phase_started_at: new Date().toISOString(), last_contact_at: lastInteractionAt, last_contact_type: cm.length ? 'email' : cmeet.length ? 'meeting' : null, reciprocity_pct: r.sr, snapshot_date: snapDate });
        personSnapshotRows.push({ organization_id: c.organization_id, contact_id: c.id, score: r.finalScore, phase: r.phase === 'growth' ? 'growing' : r.phase === 'decline' ? 'declining' : 'stable', phase_delta: r.delta, intensity_score: r.si, reciprocity_score: r.sr, recency_score: r.sl, confidence: r.confidence, total_interactions: stats.totalInteractions, email_interactions: cm.length, meeting_interactions: cmeet.length, last_interaction_at: lastInteractionAt, computed_at: new Date().toISOString(), model_version: 'relationship-score-v1', source_type: 'computed', source_label: 'Moteur relationnel Tohu', observed_at: lastInteractionAt, inference_level: 'inferred' });

        if (c.company_id && trackedCompanySet.has(c.company_id)) {
          if (!companyEngaged.has(c.company_id)) companyEngaged.set(c.company_id, []);
          companyEngaged.get(c.company_id)!.push({ contactId: c.id, score: r.finalScore, interactions: stats.totalInteractions, lastContactMs: lastInteractionAt ? new Date(lastInteractionAt).getTime() : null });
        }

        // ── Recommandations personne : règles déterministes, une seule par run/contact ──
        const recNowIso = new Date().toISOString();
        if (r.phase === 'decline' && r.finalScore <= 70 && !openPersonRecKey.has(`${c.id}|relationnel`)) {
          personRecRows.push({
            organization_id: c.organization_id, contact_id: c.id, kind: 'action', category: 'relationnel',
            priority: Math.min(100, 50 + Math.abs(r.delta)), title: 'Renouer le contact',
            justification: `Score relationnel en baisse de ${Math.abs(r.delta)} pts (actuellement ${r.finalScore}/100).`,
            recommended_action: 'Planifier un point avec ce contact dans les prochains jours.',
            source_type: 'engine', source_label: 'Moteur de recommandations Tohu', observed_at: recNowIso,
            confidence: r.confidence, inference_level: 'inferred',
          });
        } else if (userId && stats.daysSinceLastContact >= 45 && stats.daysSinceLastContact < 999 && !openPersonRecKey.has(`${c.id}|relationnel`)) {
          personRecRows.push({
            organization_id: c.organization_id, contact_id: c.id, kind: 'action', category: 'relationnel',
            priority: Math.min(90, 40 + Math.floor(stats.daysSinceLastContact / 5)), title: 'Reprendre contact',
            justification: `Aucun échange détecté depuis ${stats.daysSinceLastContact} jours.`,
            recommended_action: 'Envoyer un message ou proposer un point rapide.',
            source_type: 'engine', source_label: 'Moteur de recommandations Tohu', observed_at: recNowIso,
            confidence: r.confidence, inference_level: 'inferred',
          });
        }
      }
    }
  }

  for (const entry of (recentCareerChanges ?? []) as any[]) {
    if (openPersonRecKey.has(`${entry.contact_id}|opportunite`)) continue;
    const orgId = contactOrgMap.get(entry.contact_id);
    if (!orgId) continue;
    personRecRows.push({
      organization_id: orgId, contact_id: entry.contact_id, kind: 'action', category: 'opportunite',
      priority: 70, title: 'Confirmer le nouveau poste',
      justification: `Changement de poste détecté : ${entry.title}${entry.organization_name ? ' @ ' + entry.organization_name : ''}.`,
      recommended_action: 'Féliciter le contact et confirmer les nouvelles priorités.',
      source_type: 'engine', source_label: 'Moteur de recommandations Tohu', observed_at: entry.created_at,
      confidence: 65, inference_level: 'inferred',
    });
  }

  // ── Santé de compte + recommandations compte : agrégation à partir des scores personne calculés ci-dessus ──
  const accountScoreRows: any[] = [];
  const accountRecRows: any[] = [];
  const accountNowIso = new Date().toISOString();
  for (const companyId of trackedCompanySet) {
    const orgId = companyOrgId.get(companyId);
    const totalContacts = companyContactTotal.get(companyId) ?? 0;
    if (!orgId || totalContacts === 0) continue;
    const engaged = companyEngaged.get(companyId) ?? [];
    const contactCoverage = Math.round((engaged.length / totalContacts) * 100);
    const totalInteractions = engaged.reduce((sum, e) => sum + e.interactions, 0);
    const lastContactMsValues = engaged.map(e => e.lastContactMs).filter((v): v is number => v != null);
    const lastInteractionAt = lastContactMsValues.length ? new Date(Math.max(...lastContactMsValues)).toISOString() : null;
    const daysSinceLastInteraction = lastContactMsValues.length ? (Date.now() - Math.max(...lastContactMsValues)) / 86400000 : null;
    const interactionFrequency30d = Math.round((totalInteractions / 30) * 100) / 100;

    const decisionMakers = decisionMakersByCompany.get(companyId);
    const decisionMakerCoverage = decisionMakers && decisionMakers.size
      ? Math.round((engaged.filter(e => decisionMakers.has(e.contactId)).length / decisionMakers.size) * 100)
      : null;

    const maxSingleContactInteractions = engaged.reduce((max, e) => Math.max(max, e.interactions), 0);
    const concentrationRisk = totalInteractions > 0 ? Math.round((maxSingleContactInteractions / totalInteractions) * 100) : null;

    const weightedScoreSum = engaged.reduce((sum, e) => sum + e.score * (1 + e.interactions), 0);
    const weightSum = engaged.reduce((sum, e) => sum + (1 + e.interactions), 0);
    const engagementComponent = weightSum > 0 ? weightedScoreSum / weightSum : 0;
    const recencyComponent = daysSinceLastInteraction != null ? Math.exp(-(Math.LN2 / ACCOUNT_RECENCY_HALFLIFE_DAYS) * daysSinceLastInteraction) * 100 : 0;
    const finalScore = engaged.length > 0
      ? Math.round(clamp((engagementComponent / 100) * 0.55 + (contactCoverage / 100) * 0.25 + (recencyComponent / 100) * 0.20) * 100)
      : 0;

    const prevScore = prevAccountScoreByCompany.get(companyId) ?? null;
    const phaseDelta = prevScore != null ? finalScore - prevScore : null;
    let phase: 'growing' | 'stable' | 'declining' | 'unknown' = engaged.length === 0 ? 'unknown' : 'stable';
    if (phaseDelta != null) {
      if (phaseDelta >= ACCOUNT_PHASE_DELTA) phase = 'growing';
      else if (phaseDelta <= -ACCOUNT_PHASE_DELTA && finalScore <= ACCOUNT_PHASE_DECLINE_MAX) phase = 'declining';
    }
    const confidence = Math.min(90, 30 + totalInteractions);

    accountScoreRows.push({
      organization_id: orgId, company_id: companyId, score: finalScore, phase, phase_delta: phaseDelta,
      confidence, concentration_risk: concentrationRisk, contact_coverage: contactCoverage,
      decision_maker_coverage: decisionMakerCoverage, total_interactions: totalInteractions,
      interaction_frequency_30d: interactionFrequency30d, last_interaction_at: lastInteractionAt,
      computed_at: accountNowIso, model_version: 'account-relationship-score-v1', source_type: 'computed',
      source_label: 'Moteur relationnel Tohu', observed_at: lastInteractionAt, inference_level: 'inferred',
    });

    if (phase === 'declining' && !openAccountRecKey.has(`${companyId}|risque`)) {
      accountRecRows.push({
        organization_id: orgId, company_id: companyId, category: 'risque', priority: Math.min(100, 50 + Math.abs(phaseDelta ?? 0)),
        title: 'Compte en tension', justification: `Score relationnel du compte en baisse de ${Math.abs(phaseDelta ?? 0)} pts (actuellement ${finalScore}/100).`,
        recommended_action: 'Planifier un point stratégique avec les interlocuteurs clés.',
        source_label: 'Moteur de recommandations Tohu', observed_at: accountNowIso, confidence, inference_level: 'inferred',
      });
    }
    if (concentrationRisk != null && concentrationRisk > 70 && engaged.length > 1 && !openAccountRecKey.has(`${companyId}|risque_concentration`)) {
      accountRecRows.push({
        organization_id: orgId, company_id: companyId, category: 'risque_concentration', priority: concentrationRisk,
        title: 'Élargir les points de contact', justification: `${concentrationRisk}% des échanges reposent sur un seul contact.`,
        recommended_action: 'Identifier et engager d’autres interlocuteurs chez ce compte.',
        source_label: 'Moteur de recommandations Tohu', observed_at: accountNowIso, confidence, inference_level: 'inferred',
      });
    }
    if (companyStrategic.get(companyId) && !companyOwner.get(companyId) && !openAccountRecKey.has(`${companyId}|ownership`)) {
      accountRecRows.push({
        organization_id: orgId, company_id: companyId, category: 'ownership', priority: 60,
        title: 'Assigner un pilote de compte', justification: 'Ce compte est marqué stratégique mais n’a pas de propriétaire attitré.',
        recommended_action: 'Désigner un owner interne pour ce compte.',
        source_label: 'Moteur de recommandations Tohu', observed_at: accountNowIso, confidence: 80, inference_level: 'inferred',
      });
    }
    for (const signal of (accountSignalsByCompany.get(companyId) ?? [])) {
      if (openAccountRecBySignal.has(signal.id)) continue;
      accountRecRows.push({
        organization_id: orgId, company_id: companyId, source_signal_id: signal.id,
        category: signal.family === 'churn' ? 'risque_churn' : 'risque', priority: 75,
        title: signal.title, justification: `Signal de veille détecté : ${signal.title}.`,
        recommended_action: 'Qualifier ce signal et décider d’une action.',
        source_label: 'Veille Tohu', observed_at: signal.observed_at ?? accountNowIso, confidence: null, inference_level: 'inferred',
      });
    }
  }

  let scored = 0;
  for (let i = 0; i < profileRows.length; i += 100) {
    const { error } = await supabase.from('cognitive_profiles').upsert(profileRows.slice(i, i + 100), { onConflict: 'organization_id,contact_id,profile_version' });
    if (!error) scored += Math.min(100, profileRows.length - i);
  }
  for (let i = 0; i < histRows.length; i += 200) {
    await supabase.from('contact_score_history').upsert(histRows.slice(i, i + 200), { onConflict: 'organization_id,contact_id,user_id,snapshot_date', ignoreDuplicates: false });
  }
  for (let i = 0; i < relationshipRows.length; i += 200) {
    await supabase.from('relationship_snapshots').upsert(relationshipRows.slice(i, i + 200), { onConflict: 'organization_id,user_id,contact_id,snapshot_date', ignoreDuplicates: false });
  }
  const today = new Date().toISOString().slice(0, 10);
  const { data: existingToday } = await supabase.from('person_relationship_score_snapshots')
    .select('contact_id').in('contact_id', ids).gte('computed_at', `${today}T00:00:00.000Z`);
  const alreadySnapshotted = new Set((existingToday ?? []).map((row: any) => row.contact_id));
  const newPersonSnapshots = personSnapshotRows.filter((row) => !alreadySnapshotted.has(row.contact_id));
  for (let i = 0; i < newPersonSnapshots.length; i += 200) {
    await supabase.from('person_relationship_score_snapshots').insert(newPersonSnapshots.slice(i, i + 200));
  }
  for (let i = 0; i < accountScoreRows.length; i += 200) {
    await supabase.from('account_relationship_score_snapshots').insert(accountScoreRows.slice(i, i + 200));
  }
  for (let i = 0; i < accountRecRows.length; i += 200) {
    await supabase.from('account_recommendations').insert(accountRecRows.slice(i, i + 200));
  }
  for (let i = 0; i < personRecRows.length; i += 200) {
    await supabase.from('person_recommendations').insert(personRecRows.slice(i, i + 200));
  }

  const npsByOrgDate = new Map<string, { org: string; date: string; scores: number[] }>();
  for (const h of histRows) {
    const k = `${h.organization_id}|${h.snapshot_date}`;
    if (!npsByOrgDate.has(k)) npsByOrgDate.set(k, { org: h.organization_id, date: h.snapshot_date, scores: [] });
    npsByOrgDate.get(k)!.scores.push(h.score);
  }
  const npsRows = Array.from(npsByOrgDate.values()).map(v => {
    const promoters = v.scores.filter(s => s >= 70).length;
    const detractors = v.scores.filter(s => s <= 50).length;
    const total = v.scores.length;
    return { organization_id: v.org, snapshot_date: v.date, nps_value: Math.round((promoters / total) * 100 - (detractors / total) * 100), avg_score: Math.round(v.scores.reduce((a, b) => a + b, 0) / total), promoters, detractors, total };
  });
  for (let i = 0; i < npsRows.length; i += 200) {
    await supabase.from('nps_snapshots').upsert(npsRows.slice(i, i + 200), { onConflict: 'organization_id,snapshot_date' });
  }

  return jsonResponse({
    success: true, scored, history_points: histRows.length, relationship_snapshots: relationshipRows.length,
    person_snapshots: newPersonSnapshots.length, nps_points: npsRows.length,
    account_snapshots: accountScoreRows.length, account_recommendations: accountRecRows.length, person_recommendations: personRecRows.length,
    mode: isCron ? 'cron' : 'user',
  });
});
