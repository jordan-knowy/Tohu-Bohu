// Veille PAR PERSONNE (phase 2). Cron : détecte changement de poste + activité récente
// via l'agent n8n (réutilise cache + déjà-connu) → behavioral_signals + notifications.
//
// v2 — tiering par valeur (A/B/C) + routage de sources par type de domaine +
// réutilisation du contexte entreprise déjà collecté par monitor-company-news,
// pour ne payer l'agent IA que sur ce qui le mérite et ne jamais rechercher deux
// fois la même chose.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const N8N_ENRICH_URL = 'https://alyah-knowledge.app.n8n.cloud/webhook/knowr-enrich';
const STALE_MS = 12 * 60 * 60 * 1000;
const MAX_PER_RUN = 6;
const COMPANY_FRESH_MS = 60 * 24 * 60 * 60 * 1000; // 60 jours

// ── Classification de domaine (portée de enrich-contact) ─────────────────────
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
  'icloud.com', 'me.com', 'yahoo.com', 'yahoo.fr', 'proton.me', 'protonmail.com',
  'orange.fr', 'wanadoo.fr', 'free.fr', 'laposte.net', 'gmx.fr', 'sfr.fr',
]);
const MEGACORP_DOMAINS = new Set(['linkedin.com', 'google.com', 'microsoft.com', 'apple.com', 'amazon.com', 'meta.com', 'facebook.com', 'twitter.com', 'x.com']);
const EDU_PATTERNS = ['lycee', 'ecole', 'univ', 'iut', 'ens', 'sup', 'college', 'academie', 'institut', 'school', 'edu', 'campus', 'formation'];

type DomainType = 'personal' | 'megacorp' | 'edu' | 'startup' | 'company_fr' | 'company_intl';

function classifyDomain(email: string): { domain: string; domainType: DomainType } {
  const domain = (email.split('@')[1] ?? '').toLowerCase().trim();
  if (!domain) return { domain, domainType: 'personal' };
  if (MEGACORP_DOMAINS.has(domain)) return { domain, domainType: 'megacorp' };
  if (PERSONAL_DOMAINS.has(domain)) return { domain, domainType: 'personal' };
  const parts = domain.split('.');
  const tld = parts[parts.length - 1] ?? '';
  const isEdu = tld === 'edu' || parts.some((p) => EDU_PATTERNS.some((kw) => p.includes(kw)));
  if (isEdu) return { domain, domainType: 'edu' };
  if (['io', 'ai', 'app'].includes(tld)) return { domain, domainType: 'startup' };
  if (tld === 'fr') return { domain, domainType: 'company_fr' };
  return { domain, domainType: 'company_intl' };
}

function sourceHintsFor(domainType: DomainType): string | null {
  switch (domainType) {
    case 'company_fr': return 'Entreprise française : privilégie pappers.fr, societe.com, infogreffe.fr pour SIREN/dirigeants/forme juridique, puis LinkedIn et le site officiel.';
    case 'startup': return 'Startup : privilégie crunchbase.com et wellfound.com pour fondateurs/levées, puis le site officiel et LinkedIn.';
    case 'company_intl': return 'Entreprise internationale : site officiel (pages équipe/leadership) et LinkedIn en priorité.';
    case 'edu': return 'Établissement éducatif : site institutionnel et LinkedIn en priorité.';
    case 'personal': return 'Email personnel : recherche par nom + rôle connu uniquement, pas de registre d\'entreprise.';
    default: return null;
  }
}

// ── Tiering par valeur ────────────────────────────────────────────────────────
type Tier = 'A' | 'B' | 'C';

function classifyTier(isTracked: boolean, hasOwner: boolean, interactionCount: number): Tier {
  if (isTracked && (hasOwner || interactionCount >= 3)) return 'A';
  if (interactionCount >= 1) return 'B';
  return 'C';
}

type Contact = {
  id: string; full_name: string | null; email: string | null; organization_id: string;
  enrichment_data: any; owner_user_id: string | null;
  companies: { id?: string; name: string; domain: string | null; is_tracked?: boolean; enrichment_data?: any; enriched_at?: string | null } | null;
};

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

  let q = supabase.from('contacts')
    .select('id, full_name, email, organization_id, enrichment_data, owner_user_id, companies(id, name, domain, is_tracked, enrichment_data, enriched_at)')
    .not('email', 'is', null).is('merged_into_contact_id', null);

  if (!isCron) {
    const auth = req.headers.get('Authorization');
    if (!auth) return jsonResponse({ error: 'Missing authorization' }, 401);
    const { data: { user }, error: userErr } = await supabase.auth.getUser(auth.replace('Bearer ', ''));
    if (userErr || !user) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!body.organizationId) return jsonResponse({ error: 'organizationId required' }, 400);
    q = q.eq('organization_id', body.organizationId);
  } else {
    const cutoff = new Date(Date.now() - STALE_MS).toISOString();
    q = q.or(`last_monitored_at.is.null,last_monitored_at.lt.${cutoff}`);
  }

  const { data: contacts } = await q.order('last_monitored_at', { ascending: true, nullsFirst: true }).limit(MAX_PER_RUN);
  if (!contacts?.length) return jsonResponse({ success: true, scanned: 0, signals: 0, notified: 0 });

  // ── Volume d'interactions par contact (pour le tiering) — une seule requête ──
  const contactIds = (contacts as Contact[]).map((c) => c.id);
  const { data: msgCounts } = await supabase.from('communication_messages').select('contact_id').in('contact_id', contactIds).limit(2000);
  const interactionByContact = new Map<string, number>();
  for (const row of (msgCounts ?? []) as Array<{ contact_id: string }>) {
    interactionByContact.set(row.contact_id, (interactionByContact.get(row.contact_id) ?? 0) + 1);
  }

  // ── Signaux entreprise récents (déjà collectés par monitor-company-news) ────
  const companyIds = [...new Set((contacts as Contact[]).map((c) => c.companies?.id).filter(Boolean))] as string[];
  const { data: recentCompanySignals } = companyIds.length
    ? await supabase.from('company_signals').select('company_id, title, observed_at').in('company_id', companyIds).order('observed_at', { ascending: false }).limit(60)
    : { data: [] as any[] };
  const signalsByCompany = new Map<string, string[]>();
  for (const row of (recentCompanySignals ?? []) as Array<{ company_id: string; title: string }>) {
    signalsByCompany.set(row.company_id, [...(signalsByCompany.get(row.company_id) ?? []), row.title]);
  }

  function companyContextFor(c: Contact): { context: string | null; skip: boolean } {
    const company = c.companies;
    if (!company) return { context: null, skip: false };
    const facts: string[] = [];
    const enrichedAt = company.enriched_at ? new Date(company.enriched_at).getTime() : 0;
    const isFreshEnrichment = enrichedAt > 0 && Date.now() - enrichedAt < COMPANY_FRESH_MS;
    if (isFreshEnrichment && company.enrichment_data) {
      const data = company.enrichment_data as Record<string, unknown>;
      if (data.industry) facts.push(`Secteur : ${data.industry}`);
      if (data.summary) facts.push(String(data.summary));
    }
    const recentTitles = signalsByCompany.get(company.id ?? '') ?? [];
    if (recentTitles.length) facts.push(`Actualités récentes déjà connues : ${recentTitles.slice(0, 3).join(' · ')}`);
    if (!facts.length) return { context: null, skip: false };
    return { context: `Entreprise ${company.name} — ${facts.join(' | ')}`, skip: true };
  }

  const orgMembers = new Map<string, string[]>();
  const membersOf = async (orgId: string): Promise<string[]> => {
    if (orgMembers.has(orgId)) return orgMembers.get(orgId)!;
    const { data } = await supabase.from('memberships').select('user_id').eq('organization_id', orgId);
    const ids = (data ?? []).map((m: any) => m.user_id);
    orgMembers.set(orgId, ids);
    return ids;
  };

  let totalSignals = 0;
  let totalNotified = 0;
  let tierCounts = { A: 0, B: 0, C: 0 };

  const processContact = async (c: Contact) => {
    const email = (c.email ?? '').toLowerCase().trim();
    const { domain, domainType } = classifyDomain(email);
    const interactionCount = interactionByContact.get(c.id) ?? 0;
    const tier = domainType === 'megacorp' ? 'C' : classifyTier(c.companies?.is_tracked === true, Boolean(c.owner_user_id), interactionCount);
    tierCounts[tier]++;

    // Tier C : on ne dépense rien — on avance juste last_monitored_at pour ne
    // pas re-sélectionner ce contact à chaque run.
    if (tier === 'C') {
      await supabase.from('contacts').update({ last_monitored_at: new Date().toISOString() }).eq('id', c.id);
      return;
    }

    const entityKey = email ? `person:${email}` : `person:${(c.full_name ?? '').toLowerCase().trim()}`;
    const { data: cacheRow } = await supabase.from('enrichment_cache').select('data').eq('entity_key', entityKey).maybeSingle();
    const previous = cacheRow?.data ?? c.enrichment_data ?? null;
    const { context: companyContext, skip: skipCompanyResearch } = companyContextFor(c);

    let enr: any = null;
    try {
      const r = await fetch(N8N_ENRICH_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: 'person', entityId: c.id, organizationId: c.organization_id,
          fullName: c.full_name ?? '', email, domain: c.companies?.domain ?? domain,
          company: c.companies?.name ?? '', linkedinUrl: '',
          tier, domainType, sourceHints: sourceHintsFor(domainType), skipCompanyResearch, companyContext,
          alreadyKnown: { previousEnrichment: previous, note: 'Détecte surtout les CHANGEMENTS récents (poste, activité) vs le déjà-connu.' },
        }),
        signal: AbortSignal.timeout(120000),
      });
      if (r.ok) { const d = await r.json().catch(() => null); enr = d && (d.output ?? d); }
    } catch { /* ignore */ }

    await supabase.from('contacts').update({ last_monitored_at: new Date().toISOString() }).eq('id', c.id);
    if (!enr) return;

    const candidates: Array<{ signal_type: string; text: string; important: boolean; url?: string | null; date?: string | null }> = [];
    const prevRole = previous?.currentRole, prevCo = previous?.currentCompany;
    if (enr.currentRole && enr.roleConfidence === 'confirmed' && prevRole &&
        (enr.currentRole !== prevRole || (enr.currentCompany && enr.currentCompany !== prevCo))) {
      candidates.push({
        signal_type: 'mobility', important: true,
        text: `Changement de poste : ${prevRole}${prevCo ? ' @ ' + prevCo : ''} → ${enr.currentRole}${enr.currentCompany ? ' @ ' + enr.currentCompany : ''}`,
      });
    }
    const prevTitles = new Set((previous?.recentActivity ?? []).map((a: any) => (a.title || '').toLowerCase()));
    for (const a of (enr.recentActivity ?? []).slice(0, 5)) {
      if (a?.title && !prevTitles.has(String(a.title).toLowerCase())) {
        candidates.push({ signal_type: 'recent_activity', important: false, text: a.date ? `${a.title} (${a.date})` : a.title, url: a.url ?? null, date: a.date ?? null });
      }
    }

    await supabase.from('contacts').update({ enrichment_data: enr, web_bio: enr.summary ?? null }).eq('id', c.id);
    await supabase.from('enrichment_cache').upsert({
      entity_key: entityKey, entity_type: 'person', data: enr, sources: enr.sources ?? null, refreshed_at: new Date().toISOString(),
    }, { onConflict: 'entity_key' });

    if (!candidates.length) return;

    const { data: existing } = await supabase.from('behavioral_signals')
      .select('text').eq('contact_id', c.id).eq('source_type', 'ai_monitoring');
    const seen = new Set((existing ?? []).map((s: any) => (s.text || '').toLowerCase()));
    const fresh = candidates.filter(s => !seen.has(s.text.toLowerCase()));
    if (!fresh.length) return;

    await supabase.from('behavioral_signals').insert(fresh.map(s => ({
      organization_id: c.organization_id, contact_id: c.id,
      signal_type: s.signal_type, text: s.text, inference_level: 'observable',
      confidence: s.important ? 80 : 65, source_type: 'ai_monitoring', source_ref: s.url ?? null,
      observed_at: new Date().toISOString(),
    })));
    totalSignals += fresh.length;

    const important = fresh.filter(s => s.important);
    if (important.length) {
      const members = await membersOf(c.organization_id);
      const notifs = members.flatMap(uid => important.map(s => ({
        organization_id: c.organization_id, user_id: uid, type: 'contact_signal', priority: 'high',
        title: `${c.full_name ?? 'Contact'} — ${s.text}`.slice(0, 200), body: null,
        entity_type: 'contact', entity_id: c.id, link: `/contacts/${c.id}`,
      })));
      if (notifs.length) { await supabase.from('notifications').insert(notifs); totalNotified += notifs.length; }
    }
  };

  await Promise.allSettled((contacts as Contact[]).map(processContact));

  return jsonResponse({ success: true, scanned: contacts.length, signals: totalSignals, notified: totalNotified, tiers: tierCounts, mode: isCron ? 'cron' : 'user' });
});

