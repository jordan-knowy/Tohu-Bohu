// Scoring relationnel EN MASSE (doc 08) → cognitive_profiles + historique mensuel (contact_score_history).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { observedRelationshipAgeInDays, scoreLongevite } from '../_shared/relationship-longevity.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// Score composite PERSONNE — 5 axes (doc 5-axes) :
//   Confiance(25%) + Satisfaction(25%) + Engagement(20%) + Réciprocité(20%) + Ancrage(10%)
// Remplace la V57 (Intensité/Réciprocité/Récence). Moyenne pondérée pure, SANS
// règle plancher (le document de référence donne un exemple chiffré — 92/88/76/81/40
// → 80,4 — où le résultat dépasse largement l'axe le plus faible : la Confiance et la
// Satisfaction pèsent volontairement plus que l'Ancrage, un point de fragilité isolé
// (ex. bus factor) ne doit pas noyer une relation par ailleurs solide).
// Confiance et Satisfaction nécessitent une lecture du CONTENU des échanges (pas
// seulement leurs métadonnées) : elles sont extraites par IA dans sync-email-analysis
// (voir _shared/behavior-analysis.ts, champs trust/satisfaction) et lues ici depuis
// cognitive_profiles — score-batch reste un pur calcul, jamais d'appel IA lui-même.
const AXIS_WEIGHTS = { confiance: 0.25, satisfaction: 0.25, engagement: 0.20, reciprocite: 0.20, ancrage: 0.10 };
const PHASE_DELTA = 8.0, PHASE_DECLINE_MAX = 70;
// Score compte : mêmes seuils de phase que le score personne (cohérence de lecture),
// demi-vie de récence plus longue car un compte reste "vivant" plus longtemps qu'un contact isolé.
const ACCOUNT_PHASE_DELTA = 8, ACCOUNT_PHASE_DECLINE_MAX = 70, ACCOUNT_RECENCY_HALFLIFE_DAYS = 90;
const RECENT_WINDOW_MS = 14 * 86400000;
const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v));
// Types de relation où une asymétrie d'initiative est structurellement normale
// (ex. un prospect ne relance pas autant qu'un commercial) — atténue la
// pénalité de réciprocité plutôt que de la supprimer (voir scoreReciprocite).
const ASYMMETRIC_RELATIONSHIP_TYPES = new Set(['Prospect', 'Client', 'Fournisseur / Prestataire', 'Investisseur']);
// Nombre de messages minimum avec un même membre interne pour le compter comme
// « porteur » de la relation (ancrage) — évite qu'un simple CC ponctuel compte.
const ANCRAGE_MIN_MESSAGES_PER_CARRIER = 3;

interface Stats {
  emailsLast90: number; meetingsLast90: number; avgThreadDepth: number; channelCount: number;
  initiationRatio: number; responseRate: number; responseTimeRatio: number; ageInDays: number;
  daysSinceLastContact: number; monthlyExchangeCounts: number[]; quartersWithMeetings: number;
  totalInteractions: number;
}

// Engagement (20%) : intensité de la relation comparée à SA PROPRE baseline
// (moyenne d'interactions/90j sur toute la relation observée), pas à un seuil
// absolu — 20 échanges avec quelqu'un contacté 2x/mois est un signal fort, 20
// échanges avec quelqu'un contacté quotidiennement ne l'est pas. Sous la
// baseline → signal dégradé ; au-dessus → signal fort, plafonné à 2x la
// baseline. Une relation trop jeune (<45j) n'a pas encore de baseline fiable :
// traitée neutre plutôt que biaisée par sa propre activité de démarrage.
function scoreEngagement(s: Stats): number {
  const periods = Math.max(1, s.ageInDays / 90);
  const baselineRate = s.totalInteractions / periods;
  const recentRate = s.emailsLast90 + s.meetingsLast90 * 4;
  const ratio = s.ageInDays < 45 ? 1 : (baselineRate > 0 ? Math.min(4, recentRate / baselineRate) : (recentRate > 0 ? 2 : 0));
  const baselineComponent = ratio <= 1 ? ratio * 60 : Math.min(100, 60 + (ratio - 1) * 40);
  const richness = s.channelCount >= 3 ? 100 : s.channelCount === 2 ? 65 : 25;
  const depth = clamp(s.avgThreadDepth / 5) * 100;
  return clamp(baselineComponent * 0.70 + richness * 0.15 + depth * 0.15, 0, 100);
}

// Réciprocité (20%) : équilibre des initiatives, atténué selon le type de
// relation déclaré (une asymétrie commercial↔prospect est normale, une
// asymétrie partenaire↔partenaire l'est moins).
function scoreReciprocite(s: Stats, relationshipType: string | null): number {
  const asym = Math.abs(s.initiationRatio - 0.5) * 2;
  const asymWeight = relationshipType && ASYMMETRIC_RELATIONSHIP_TYPES.has(relationshipType) ? 0.35 : 0.60;
  const balance = Math.max(0.40, 1.0 - asym * asymWeight);
  return clamp(balance * 0.50 + clamp(s.responseRate) * 0.30 + clamp(s.responseTimeRatio / 2) * 0.20, 0, 1) * 100;
}

// Ancrage (10%) : nombre de membres internes distincts ayant une relation
// réelle (≥3 messages) avec ce contact — 1 porteur = risque bus factor,
// 3+ = relation intégrée à l'organisation, résiliente au départ d'un individu.
function scoreAncrage(carriers: number): number {
  if (carriers <= 0) return 0;
  if (carriers === 1) return 25;
  if (carriers === 2) return 60;
  return 100;
}

// Catégorisation COMPTE (chargement des comptes) : agrège les indices par
// contact (account_relation_hint, un par personne suivie du compte) en une
// suggestion unique — majorité PONDÉRÉE par confiance (un indice à 90% pèse
// plus que trois à 20%), jamais un simple décompte. Aucune suggestion tant que
// le signal est faible ou trop partagé entre catégories : mieux vaut laisser
// « à qualifier » qu'une catégorie hasardeuse (zéro hallucination).
const ACCOUNT_RELATION_MIN_CONFIDENCE = 55;
const ACCOUNT_RELATION_MIN_SHARE = 0.55;
function aggregateAccountRelation(hints: Array<{ category: string; confidence: number }>): { category: string; confidence: number } | null {
  const usable = hints.filter((hint) => hint.confidence >= ACCOUNT_RELATION_MIN_CONFIDENCE);
  if (!usable.length) return null;
  const weightByCategory = new Map<string, number>();
  let totalWeight = 0;
  for (const hint of usable) {
    weightByCategory.set(hint.category, (weightByCategory.get(hint.category) ?? 0) + hint.confidence);
    totalWeight += hint.confidence;
  }
  const [topCategory, topWeight] = [...weightByCategory.entries()].reduce((max, entry) => entry[1] > max[1] ? entry : max);
  if (totalWeight <= 0 || topWeight / totalWeight < ACCOUNT_RELATION_MIN_SHARE) return null;
  const contributingHints = usable.filter((hint) => hint.category === topCategory);
  const avgConfidence = contributingHints.reduce((sum, hint) => sum + hint.confidence, 0) / contributingHints.length;
  return { category: topCategory, confidence: Math.round(avgConfidence) };
}

function buildStats(allMsgs: any[], allMeets: any[], nowMs: number): Stats {
  const messages = allMsgs.filter(m => m.sent_at && new Date(m.sent_at).getTime() <= nowMs);
  const meetings = allMeets.filter(m => m.starts_at && new Date(m.starts_at).getTime() <= nowMs);
  const c90 = nowMs - 90 * 86400000;
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
  const allDates = [...messages.map(m => new Date(m.sent_at).getTime()), ...meetings.map(m => new Date(m.starts_at).getTime())];
  // L'ancienneté de la relation commence à la première interaction observée.
  // contacts.created_at est une date d'import technique : l'utiliser remettait
  // à zéro la longevité de relations anciennes lors d'une synchronisation.
  const ageInDays = observedRelationshipAgeInDays(allDates, nowMs);
  const lastContact = allDates.length ? Math.max(...allDates) : 0;
  const daysSinceLastContact = lastContact ? Math.round((nowMs - lastContact) / 86400000) : 999;
  const monthlyExchangeCounts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const start = nowMs - (i + 1) * 30 * 86400000, end = nowMs - i * 30 * 86400000;
    const messageCount = messages.filter(m => { const t = new Date(m.sent_at).getTime(); return t > start && t <= end; }).length;
    const meetingCount = meetings.filter(m => { const t = new Date(m.starts_at).getTime(); return t > start && t <= end; }).length;
    monthlyExchangeCounts.push(messageCount + meetingCount);
  }
  const quartersWithMeetings = [0, 1, 2, 3].filter(q => {
    const start = nowMs - (q + 1) * 90 * 86400000, end = nowMs - q * 90 * 86400000;
    return meetings.some(m => { const t = new Date(m.starts_at).getTime(); return t > start && t <= end; });
  }).length;
  return {
    emailsLast90: messages.filter(m => new Date(m.sent_at).getTime() > c90).length,
    meetingsLast90: meetings.filter(m => new Date(m.starts_at).getTime() > c90).length,
    avgThreadDepth, channelCount, initiationRatio, responseRate, responseTimeRatio, ageInDays, daysSinceLastContact,
    monthlyExchangeCounts, quartersWithMeetings, totalInteractions: messages.length + meetings.length * 4,
  };
}

type AxisInputs = { trustScore: number | null; satisfactionScore: number | null; relationshipType: string | null; ancrageCarriers: number };

// Interprétation déterministe (jamais un appel IA séparé) : identifie l'axe le
// plus faible et le formule en phrase actionnable, à l'image du document de
// référence — jamais un simple "score : X/100".
function interpretAxes(axes: { confiance: number; satisfaction: number; engagement: number; reciprocite: number; ancrage: number }): string {
  const labels: Record<keyof typeof axes, string> = { confiance: 'la confiance', satisfaction: 'la satisfaction', engagement: "l'engagement", reciprocite: 'la réciprocité', ancrage: "l'ancrage organisationnel" };
  const entries = Object.entries(axes) as Array<[keyof typeof axes, number]>;
  const [weakestKey, weakestValue] = entries.reduce((min, entry) => entry[1] < min[1] ? entry : min);
  const [strongestKey, strongestValue] = entries.reduce((max, entry) => entry[1] > max[1] ? entry : max);
  const overall = axes.confiance * AXIS_WEIGHTS.confiance + axes.satisfaction * AXIS_WEIGHTS.satisfaction + axes.engagement * AXIS_WEIGHTS.engagement + axes.reciprocite * AXIS_WEIGHTS.reciprocite + axes.ancrage * AXIS_WEIGHTS.ancrage;
  const level = overall >= 70 ? 'Relation solide' : overall >= 50 ? 'Relation intermédiaire' : 'Relation fragile';
  const strength = strongestValue >= 70 ? `, portée par ${labels[strongestKey]}` : '';
  const weakness = weakestValue < 60
    ? `. Le principal point de fragilité vient de ${labels[weakestKey]} (${weakestValue}/100)${weakestKey === 'ancrage' ? " : la relation reste trop dépendante d'un nombre limité de porteurs internes" : ''}.`
    : '.';
  return `${level}${strength}${weakness}`;
}

// Le projet Supabase plafonne chaque requête PostgREST à 1000 lignes côté
// serveur (db-max-rows), quel que soit le .limit() demandé côté client — un
// org avec plus de 1000 messages/snapshots ne recevait donc qu'un sous-ensemble
// arbitraire (aucun tri explicite), faussant potentiellement le calcul du
// score. On pagine explicitement via .range() jusqu'à épuisement des pages.
async function fetchAllPages<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>, pageSize = 1000, maxRows = 30000): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  while (from < maxRows) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    out.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return out;
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
  // Appel admin (Service Role) : la passerelle Supabase (verify_jwt) a déjà
  // validé la signature du token avant d'invoquer la fonction — il suffit de
  // lire son rôle, pas de comparer une chaîne littérale.
  if (!isCron) {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const segments = token.split('.');
    if (segments.length === 3) {
      try {
        const payload = JSON.parse(atob(segments[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload?.role === 'service_role') isCron = true;
      } catch { /* token non décodable : ignoré, pas d'accès admin */ }
    }
  }

  // deepBackfill : reconstruit tout l'historique réel (jusqu'à la toute
  // première interaction observée, sans plafond métier) au lieu de la fenêtre
  // glissante de 6 mois du cron normal — même formule, aucune divergence entre
  // score passé et présent. Toujours borné à une organisation (jamais un
  // backfill global non scopé) pour contenir le coût d'un seul appel.
  const deepBackfill = body.deepBackfill === true;
  if (deepBackfill && !body.organizationId) return jsonResponse({ error: 'deepBackfill nécessite organizationId' }, 400);
  // forceRecompute : ignore le « déjà couvert » et RECALCULE (upsert, jamais un
  // insert brut) les mois déjà présents — sert à corriger un backfill antérieur
  // qui aurait tourné sur des données incomplètes (ex. plafond de lignes côté
  // serveur), sans jamais supprimer de ligne existante.
  const forceRecompute = deepBackfill && body.forceRecompute === true;

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
  if (body.contactId) cq = cq.eq('id', body.contactId);
  const { data: rawContacts } = await cq.limit(2000);
  if (!rawContacts?.length) return jsonResponse({ success: true, scored: 0 });

  // Un contact archivé (person_settings.archived_at) n'alimente plus aucun
  // score — ni le sien, ni celui de son compte — tant qu'il reste archivé.
  // L'archivage produit ne touche jamais contacts.is_tracked (qui reste vrai),
  // donc l'exclusion se fait ici, explicitement. On récupère au passage le
  // type de relation déclaré (utilisé pour nuancer la réciprocité).
  const { data: personSettingsRows } = await supabase.from('person_settings').select('contact_id, archived_at, relationship_type').in('contact_id', rawContacts.map((c: any) => c.id));
  const archivedContactIds = new Set((personSettingsRows ?? []).filter((r: any) => r.archived_at).map((r: any) => r.contact_id));
  const relationshipTypeByContact = new Map<string, string | null>((personSettingsRows ?? []).map((r: any) => [r.contact_id, r.relationship_type ?? null]));
  const contacts = rawContacts.filter((c: any) => !archivedContactIds.has(c.id));
  if (!contacts.length) return jsonResponse({ success: true, scored: 0 });

  const ids = contacts.map((c: any) => c.id);
  const orgIds = Array.from(new Set(contacts.map((c: any) => c.organization_id)));
  const contactOrgMap = new Map<string, string>(contacts.map((c: any) => [c.id, c.organization_id]));
  const contactCompanyMap = new Map<string, string>(contacts.filter((c: any) => c.company_id).map((c: any) => [c.id, c.company_id]));
  const companyIds = Array.from(new Set(contacts.map((c: any) => c.company_id).filter(Boolean))) as string[];

  const [msgs, parts, { data: prevProfiles }, { data: mems }] = await Promise.all([
    fetchAllPages<any>((from, to) => supabase.from('communication_messages').select('contact_id, direction, sent_at, thread_id, metadata').in('contact_id', ids).order('id', { ascending: true }).range(from, to)),
    fetchAllPages<any>((from, to) => supabase.from('meeting_participants').select('contact_id, meetings(starts_at)').in('contact_id', ids).order('id', { ascending: true }).range(from, to)),
    // trust_score/satisfaction_score/account_relation_hint : derniers signaux IA
    // connus (voir sync-email-analysis) — score-batch les LIT, ne les calcule
    // jamais lui-même (pas d'appel IA ici).
    supabase.from('cognitive_profiles').select('contact_id, engagement_score, trust_score, satisfaction_score, account_relation_hint, account_relation_hint_confidence').in('contact_id', ids),
    supabase.from('memberships').select('organization_id, user_id, role').in('organization_id', orgIds),
  ]);

  // Mois déjà couverts (granularité calendaire) : un deepBackfill rejoué n'a
  // pas à recalculer un mois déjà réellement écoulé et présent — ni pour
  // l'historique personne (contact_score_history), ni pour la santé de
  // compte (account_relationship_score_snapshots).
  const existingMonthsByContact = new Map<string, Set<string>>();
  const existingMonthsByCompany = new Map<string, Set<string>>();
  if (deepBackfill) {
    const [existingHist, existingAccountHist] = await Promise.all([
      fetchAllPages<any>((from, to) => supabase.from('contact_score_history').select('contact_id, snapshot_date').in('contact_id', ids).order('id', { ascending: true }).range(from, to)),
      companyIds.length
        ? fetchAllPages<any>((from, to) => supabase.from('account_relationship_score_snapshots').select('company_id, computed_at').in('company_id', companyIds).order('id', { ascending: true }).range(from, to))
        : Promise.resolve([] as any[]),
    ]);
    for (const row of (existingHist ?? []) as any[]) {
      if (!existingMonthsByContact.has(row.contact_id)) existingMonthsByContact.set(row.contact_id, new Set());
      existingMonthsByContact.get(row.contact_id)!.add(String(row.snapshot_date).slice(0, 7));
    }
    for (const row of (existingAccountHist ?? []) as any[]) {
      if (!existingMonthsByCompany.has(row.company_id)) existingMonthsByCompany.set(row.company_id, new Set());
      existingMonthsByCompany.get(row.company_id)!.add(String(row.computed_at).slice(0, 7));
    }
  }

  // ── Scope compte (santé + recommandations) : chargé une fois pour tout le run ──
  const trackedCompanySet = new Set<string>();
  const companyStrategic = new Map<string, boolean>();
  const companyOwner = new Map<string, string | null>();
  const decisionMakersByCompany = new Map<string, Set<string>>();
  const prevAccountScoreByCompany = new Map<string, number>();
  const accountSignalsByCompany = new Map<string, any[]>();
  const companyRelationshipStatus = new Map<string, string | null>();
  const companyRelationshipSource = new Map<string, string | null>();
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
      supabase.from('account_settings').select('company_id, strategic, primary_owner_user_id, archived_at, relationship_status, relationship_status_source').in('company_id', companyIds),
      supabase.from('account_contact_roles').select('company_id, contact_id').in('company_id', companyIds).eq('active', true).not('decision_role', 'is', null),
      supabase.from('account_relationship_score_snapshots').select('company_id, score, computed_at').in('company_id', companyIds).order('computed_at', { ascending: false }),
      supabase.from('company_signals').select('id, company_id, family, title, observed_at').in('company_id', companyIds).in('family', ['risque', 'churn']).eq('status', 'candidate').gte('observed_at', recentCutoff),
    ]);
    // Un compte archivé (account_settings.archived_at) sort du calcul : plus
    // aucun account_relationship_score_snapshots/recommandation n'est produit
    // pour lui tant qu'il reste archivé (même logique que pour les contacts).
    const archivedCompanyIds = new Set((accountSettingsRows ?? []).filter((row: any) => row.archived_at).map((row: any) => row.company_id));
    for (const row of (trackedCompanies ?? []) as any[]) { if (!archivedCompanyIds.has(row.id)) trackedCompanySet.add(row.id); }
    for (const row of (accountSettingsRows ?? []) as any[]) {
      companyStrategic.set(row.company_id, row.strategic === true);
      companyOwner.set(row.company_id, row.primary_owner_user_id ?? null);
      companyRelationshipStatus.set(row.company_id, row.relationship_status ?? null);
      companyRelationshipSource.set(row.company_id, row.relationship_status_source ?? null);
    }
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
  const axisInputsByContact = new Map<string, { trustScore: number | null; satisfactionScore: number | null }>();
  for (const p of (prevProfiles ?? []) as any[]) axisInputsByContact.set(p.contact_id, { trustScore: p.trust_score ?? null, satisfactionScore: p.satisfaction_score ?? null });
  const orgOwner = new Map<string, string>();
  for (const m of (mems ?? []) as any[]) { if (!orgOwner.has(m.organization_id) || m.role === 'owner') orgOwner.set(m.organization_id, m.user_id); }

  // Catégorisation COMPTE : indice par contact (voir _shared/behavior-analysis.ts,
  // champ account_relation, même appel IA que trust/satisfaction), agrégé par
  // compte plus bas (aggregateAccountRelation) pour suggérer relationship_status.
  const relationHintsByCompany = new Map<string, Array<{ category: string; confidence: number }>>();
  for (const p of (prevProfiles ?? []) as any[]) {
    if (!p.account_relation_hint) continue;
    const companyId = contactCompanyMap.get(p.contact_id);
    if (!companyId) continue;
    if (!relationHintsByCompany.has(companyId)) relationHintsByCompany.set(companyId, []);
    relationHintsByCompany.get(companyId)!.push({ category: p.account_relation_hint, confidence: Number(p.account_relation_hint_confidence) || 0 });
  }

  // Ancrage : porteurs internes distincts par contact, calculés sur TOUT
  // l'historique de messages disponible pour ce run (pas seulement la fenêtre
  // récente) — la résilience organisationnelle d'une relation ne se mesure
  // pas sur 90 jours. metadata.user_id n'est pas toujours renseigné selon la
  // voie d'ingestion : le propriétaire déclaré du contact compte toujours
  // comme au moins 1 porteur (jamais 0 par simple absence de métadonnée).
  const ancrageCarriersByContact = new Map<string, number>();
  for (const c of contacts as any[]) {
    const contactMsgs = msgsByC.get(c.id) ?? [];
    const countsByUser = new Map<string, number>();
    for (const m of contactMsgs) {
      const uid = (m.metadata as any)?.user_id;
      if (!uid) continue;
      countsByUser.set(uid, (countsByUser.get(uid) ?? 0) + 1);
    }
    const detected = Array.from(countsByUser.values()).filter((n) => n >= ANCRAGE_MIN_MESSAGES_PER_CARRIER).length;
    ancrageCarriersByContact.set(c.id, c.owner_user_id ? Math.max(detected, 1) : detected);
  }

  function computeScore(stats: Stats, prevScore: number | null, axisInputs: AxisInputs) {
    const engagement = scoreEngagement(stats);
    const reciprocite = scoreReciprocite(stats, axisInputs.relationshipType);
    const ancrage = scoreAncrage(axisInputs.ancrageCarriers);
    // Confiance/Satisfaction : valeur IA si déjà mesurée, sinon neutre (50) en
    // attendant l'analyse — jamais fabriquée à partir du seul volume d'emails
    // (voir _shared/behavior-analysis.ts). `*Measured` distingue les deux cas
    // pour l'interprétation et la confiance affichées.
    const confianceMeasured = axisInputs.trustScore != null;
    const satisfactionMeasured = axisInputs.satisfactionScore != null;
    const confiance = axisInputs.trustScore ?? 50;
    const satisfaction = axisInputs.satisfactionScore ?? 50;
    const { score: sl } = scoreLongevite(stats);
    const weighted = confiance * AXIS_WEIGHTS.confiance + satisfaction * AXIS_WEIGHTS.satisfaction
      + engagement * AXIS_WEIGHTS.engagement + reciprocite * AXIS_WEIGHTS.reciprocite + ancrage * AXIS_WEIGHTS.ancrage;
    const finalScore = Math.round(clamp(weighted, 0, 100));
    const delta = finalScore - (prevScore ?? finalScore);
    let phase: 'growth' | 'stagnant' | 'decline' = 'stagnant';
    if (delta >= PHASE_DELTA) phase = 'growth';
    else if (delta <= -PHASE_DELTA && finalScore <= PHASE_DECLINE_MAX) phase = 'decline';
    const measuredAxisCount = 3 + (confianceMeasured ? 1 : 0) + (satisfactionMeasured ? 1 : 0);
    return {
      finalScore, delta, phase,
      engagement: Math.round(engagement), reciprocite: Math.round(reciprocite), ancrage: Math.round(ancrage),
      confiance: Math.round(confiance), satisfaction: Math.round(satisfaction), confianceMeasured, satisfactionMeasured,
      sl: Math.round(sl * 100),
      confidence: Math.min(90, 20 + stats.totalInteractions * 2 + measuredAxisCount * 8),
    };
  }

  const profileRows: any[] = [];
  const histRows: any[] = [];
  const relationshipRows: any[] = [];
  const personSnapshotRows: any[] = [];
  const personRecRows: any[] = [];
  type CompanyEngaged = { contactId: string; score: number; interactions: number; lastContactMs: number | null };
  // ma -> companyId -> contacts engagés CE mois-là — permet de reconstruire la
  // santé de compte mois par mois pendant un deepBackfill (pas seulement
  // « aujourd'hui »), sans alourdir le cron normal (ma===0 uniquement).
  const companyEngagedByMonth = new Map<number, Map<string, CompanyEngaged[]>>();
  const DEFAULT_MONTHS = [5, 4, 3, 2, 1, 0];
  // Aucun plafond métier : on remonte jusqu'à la toute première interaction
  // réelle du contact (les emails/réunions existent, l'historique ne doit
  // jamais être amputé). Seul un garde-fou technique très large empêche une
  // donnée de date corrompue de générer une boucle démesurée.
  const DEEP_BACKFILL_SAFETY_CAP_MONTHS = 600;
  const now = Date.now();

  for (const c of contacts as any[]) {
    const cm = (msgsByC.get(c.id) ?? []).sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime());
    const cmeet = meetsByC.get(c.id) ?? [];
    const userId = c.owner_user_id ?? orgOwner.get(c.organization_id) ?? null;
    let lastScore: number | null = null;
    const axisInputs: AxisInputs = {
      trustScore: axisInputsByContact.get(c.id)?.trustScore ?? null,
      satisfactionScore: axisInputsByContact.get(c.id)?.satisfactionScore ?? null,
      relationshipType: relationshipTypeByContact.get(c.id) ?? null,
      ancrageCarriers: ancrageCarriersByContact.get(c.id) ?? 0,
    };

    // deepBackfill : fenêtre étendue jusqu'à la première interaction réelle de
    // CE contact (pas une fenêtre globale) — un contact récent ne recalcule
    // pas des dizaines de mois de silence pour rien.
    let contactMonths: number[] = DEFAULT_MONTHS;
    if (deepBackfill) {
      const allTimes = [...cm.map((m: any) => new Date(m.sent_at).getTime()), ...cmeet.map((m: any) => new Date(m.starts_at).getTime())].filter(Number.isFinite);
      if (allTimes.length) {
        const monthsBack = Math.min(DEEP_BACKFILL_SAFETY_CAP_MONTHS, Math.ceil((now - Math.min(...allTimes)) / (30 * 86400000)));
        contactMonths = Array.from({ length: monthsBack + 1 }, (_, i) => monthsBack - i);
      } else {
        contactMonths = [0];
      }
    }
    const coveredMonths = deepBackfill && !forceRecompute ? (existingMonthsByContact.get(c.id) ?? new Set<string>()) : null;

    for (const ma of contactMonths) {
      const nowMs = ma === 0 ? now : now - ma * 30 * 86400000;
      const snapDate = new Date(nowMs).toISOString().slice(0, 10);
      // Un mois déjà réellement couvert (backfill rejoué) n'est jamais recalculé ;
      // le mois courant (ma===0), lui, doit toujours rester à jour.
      if (coveredMonths && ma !== 0 && coveredMonths.has(snapDate.slice(0, 7))) continue;
      const stats = buildStats(cm, cmeet, nowMs);
      if (stats.totalInteractions === 0) continue;
      const r = computeScore(stats, ma === 0 ? (prevByC.get(c.id) ?? null) : lastScore, axisInputs);
      lastScore = r.finalScore;
      if (userId) histRows.push({ organization_id: c.organization_id, contact_id: c.id, user_id: userId, score: r.finalScore, phase: r.phase, score_engagement: r.engagement, score_reciprocite: r.reciprocite, score_confiance: r.confiance, score_satisfaction: r.satisfaction, score_ancrage: r.ancrage, snapshot_date: snapDate });

      // relationship_snapshots (tendance Home « 1 mois / trimestre / année »)
      // + agrégation compte plus bas : reconstruits mois par mois UNIQUEMENT en
      // deepBackfill, pour ne pas alourdir le cron normal (qui garde ma===0 seul,
      // comportement inchangé).
      if (ma === 0 || deepBackfill) {
        const cutoffLastInteractionAt = stats.daysSinceLastContact < 999 ? new Date(nowMs - stats.daysSinceLastContact * 86400000).toISOString() : null;
        if (userId) relationshipRows.push({ organization_id: c.organization_id, user_id: userId, contact_id: c.id, engagement_score: r.finalScore, score_evolution: r.delta, phase: r.phase, phase_started_at: new Date(nowMs).toISOString(), last_contact_at: cutoffLastInteractionAt, last_contact_type: cm.length ? 'email' : cmeet.length ? 'meeting' : null, reciprocity_pct: r.reciprocite, snapshot_date: snapDate });
        if (c.company_id && trackedCompanySet.has(c.company_id)) {
          if (!companyEngagedByMonth.has(ma)) companyEngagedByMonth.set(ma, new Map());
          const monthMap = companyEngagedByMonth.get(ma)!;
          if (!monthMap.has(c.company_id)) monthMap.set(c.company_id, []);
          monthMap.get(c.company_id)!.push({ contactId: c.id, score: r.finalScore, interactions: stats.totalInteractions, lastContactMs: cutoffLastInteractionAt ? new Date(cutoffLastInteractionAt).getTime() : null });
        }
      }

      if (ma === 0) {
        const interactionDates = [
          ...cm.map((message: any) => message.sent_at),
          ...cmeet.map((meeting: any) => meeting.starts_at),
        ].filter(Boolean).map((value: string) => new Date(value).getTime()).filter(Number.isFinite);
        const lastInteractionAt = interactionDates.length ? new Date(Math.max(...interactionDates)).toISOString() : null;
        profileRows.push({ organization_id: c.organization_id, contact_id: c.id, profile_version: 1, engagement_score: r.finalScore, score_delta: r.delta, score_phase: r.phase, score_engagement: r.engagement, score_reciprocite: r.reciprocite, score_confiance: r.confiance, score_satisfaction: r.satisfaction, score_ancrage: r.ancrage, global_confidence: r.confidence, updated_at: new Date().toISOString() });
        const interpretation = interpretAxes({ confiance: r.confiance, satisfaction: r.satisfaction, engagement: r.engagement, reciprocite: r.reciprocite, ancrage: r.ancrage });
        personSnapshotRows.push({ organization_id: c.organization_id, contact_id: c.id, score: r.finalScore, phase: r.phase === 'growth' ? 'growing' : r.phase === 'decline' ? 'declining' : 'stable', phase_delta: r.delta, engagement_score: r.engagement, reciprocity_score: r.reciprocite, confiance_score: r.confiance, satisfaction_score: r.satisfaction, ancrage_score: r.ancrage, ancrage_carriers: axisInputs.ancrageCarriers, axis_interpretation: interpretation, relationship_age_days: stats.ageInDays, confidence: r.confidence, total_interactions: stats.totalInteractions, email_interactions: cm.length, meeting_interactions: cmeet.length, last_interaction_at: lastInteractionAt, computed_at: new Date().toISOString(), model_version: 'relationship-score-v4', source_type: 'computed', source_label: 'Moteur relationnel Tohu', observed_at: lastInteractionAt, inference_level: 'inferred' });

        // ── Recommandations personne : règles déterministes, une seule par run/contact — toujours sur l'état ACTUEL ──
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
        } else if (axisInputs.ancrageCarriers <= 1 && stats.totalInteractions >= 8 && !openPersonRecKey.has(`${c.id}|ancrage`)) {
          personRecRows.push({
            organization_id: c.organization_id, contact_id: c.id, kind: 'action', category: 'ancrage',
            priority: 45, title: "Élargir les porteurs de la relation",
            justification: `Cette relation repose sur un seul interlocuteur interne (ancrage faible) malgré ${stats.totalInteractions} interactions.`,
            recommended_action: 'Impliquer un autre membre de l’équipe dans les prochains échanges.',
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
  // Cron normal : un seul mois (aujourd'hui), comportement inchangé. deepBackfill :
  // rejoue la même agrégation pour chaque mois reconstruit — même formule.
  const accountScoreRows: any[] = [];
  const accountRecRows: any[] = [];
  const accountRelationSuggestionRows: any[] = [];
  const accountMonths = Array.from(new Set([0, ...companyEngagedByMonth.keys()])).sort((a, b) => b - a);
  const lastAccountScore = new Map<string, number>();
  for (const ma of accountMonths) {
    const nowMsForMonth = ma === 0 ? now : now - ma * 30 * 86400000;
    const accountNowIso = new Date(nowMsForMonth).toISOString();
    const engagedThisMonth = companyEngagedByMonth.get(ma) ?? new Map<string, CompanyEngaged[]>();
    for (const companyId of trackedCompanySet) {
      const orgId = companyOrgId.get(companyId);
      const totalContacts = companyContactTotal.get(companyId) ?? 0;
      if (!orgId || totalContacts === 0) continue;
      if (deepBackfill && !forceRecompute && ma !== 0) {
        const covered = existingMonthsByCompany.get(companyId);
        if (covered?.has(accountNowIso.slice(0, 7))) continue;
      }
      const engaged = engagedThisMonth.get(companyId) ?? [];
      if (ma !== 0 && engaged.length === 0) continue; // rien de nouveau à écrire pour ce mois-là

      const contactCoverage = Math.round((engaged.length / totalContacts) * 100);
      const totalInteractions = engaged.reduce((sum, e) => sum + e.interactions, 0);
      const lastContactMsValues = engaged.map(e => e.lastContactMs).filter((v): v is number => v != null);
      const lastInteractionAt = lastContactMsValues.length ? new Date(Math.max(...lastContactMsValues)).toISOString() : null;
      const daysSinceLastInteraction = lastContactMsValues.length ? (nowMsForMonth - Math.max(...lastContactMsValues)) / 86400000 : null;
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
      // Aucun contact engagé mesuré ≠ compte en échec : neutre (50), pas 0 — le
      // phase 'unknown' ci-dessous distingue déjà ce cas d'un score réellement mauvais.
      const finalScore = engaged.length > 0
        ? Math.round(clamp((engagementComponent / 100) * 0.55 + (contactCoverage / 100) * 0.25 + (recencyComponent / 100) * 0.20) * 100)
        : 50;

      const prevScore = ma === 0 ? (prevAccountScoreByCompany.get(companyId) ?? null) : (lastAccountScore.get(companyId) ?? null);
      const phaseDelta = prevScore != null ? finalScore - prevScore : null;
      lastAccountScore.set(companyId, finalScore);
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
        // Composantes réelles du score (0,55 engagement + 0,25 couverture + 0,20 récence) —
        // null (pas 0) quand aucun contact engagé ce mois-là : une absence de mesure
        // n'est pas un mauvais score, jamais fabriquée (voir §2.4 doc scoring).
        engagement_component: engaged.length > 0 ? Math.round(engagementComponent) : null,
        recency_component: engaged.length > 0 ? Math.round(recencyComponent) : null,
        computed_at: accountNowIso, model_version: 'account-relationship-score-v1', source_type: 'computed',
        source_label: 'Moteur relationnel Tohu', observed_at: lastInteractionAt, inference_level: 'inferred',
      });

      if (ma !== 0) continue; // recommandations : toujours sur l'état actuel, jamais rétroactives

      // Catégorisation compte : ne retouche JAMAIS un choix humain confirmé
      // (relationship_status_source === 'manual'). Tant que non confirmée, la
      // suggestion peut être raffinée à chaque run à mesure que d'autres
      // contacts du compte sont analysés — sans jamais effacer une suggestion
      // déjà posée si ce run-ci manque simplement de signal frais.
      if (companyRelationshipSource.get(companyId) !== 'manual') {
        const suggestion = aggregateAccountRelation(relationHintsByCompany.get(companyId) ?? []);
        if (suggestion) {
          accountRelationSuggestionRows.push({
            organization_id: orgId, company_id: companyId,
            relationship_status: suggestion.category, relationship_status_source: 'suggested',
            relationship_status_confidence: suggestion.confidence, updated_by: null, updated_at: accountNowIso,
          });
        }
      }

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
  for (let i = 0; i < accountRelationSuggestionRows.length; i += 200) {
    await supabase.from('account_settings').upsert(accountRelationSuggestionRows.slice(i, i + 200), { onConflict: 'organization_id,company_id' });
  }
  for (let i = 0; i < personRecRows.length; i += 200) {
    await supabase.from('person_recommendations').insert(personRecRows.slice(i, i + 200));
  }

  return jsonResponse({
    success: true, scored, history_points: histRows.length, relationship_snapshots: relationshipRows.length,
    person_snapshots: newPersonSnapshots.length,
    account_snapshots: accountScoreRows.length, account_recommendations: accountRecRows.length, person_recommendations: personRecRows.length,
    account_relation_suggestions: accountRelationSuggestionRows.length,
    mode: isCron ? 'cron' : 'user',
  });
});
