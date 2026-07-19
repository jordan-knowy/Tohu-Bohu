// Enrichissement via l'agent n8n (OpenRouter + Perplexity), DB-aware.
// - Cache GLOBAL (enrichment_cache) partagé entre users/orgs : même entité = réutilisation, pas de re-recherche.
// - Transmet à l'agent ce qui est DÉJÀ connu (cache + signaux existants) pour ne pas répéter et chercher le NOUVEAU.
//
// v2 — routage de sources par type de domaine + réutilisation du contexte
// entreprise déjà collecté (monitor-company-news / enrichment_cache société)
// quand on enrichit une personne, pour ne jamais payer deux fois la même recherche.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const N8N_ENRICH_URL = 'https://alyah-knowledge.app.n8n.cloud/webhook/knowr-enrich';
const FRESH_MS = 14 * 24 * 60 * 60 * 1000;
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

function classifyDomain(rawDomain: string): DomainType {
  const domain = rawDomain.toLowerCase().trim();
  if (!domain) return 'personal';
  if (MEGACORP_DOMAINS.has(domain)) return 'megacorp';
  if (PERSONAL_DOMAINS.has(domain)) return 'personal';
  const parts = domain.split('.');
  const tld = parts[parts.length - 1] ?? '';
  const isEdu = tld === 'edu' || parts.some((p) => EDU_PATTERNS.some((kw) => p.includes(kw)));
  if (isEdu) return 'edu';
  if (['io', 'ai', 'app'].includes(tld)) return 'startup';
  if (tld === 'fr') return 'company_fr';
  return 'company_intl';
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const auth = req.headers.get('Authorization');
  if (!auth) return jsonResponse({ error: 'Missing authorization' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
  const { data: { user }, error: userErr } = await supabase.auth.getUser(auth.replace('Bearer ', ''));
  if (userErr || !user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const { contactId, companyId, organizationId, forceRefresh = false } = body;
  if (!organizationId || (!contactId && !companyId)) {
    return jsonResponse({ error: 'organizationId and (contactId or companyId) required' }, 400);
  }

  let entityType: 'person' | 'company';
  let entityKey: string;
  let payload: Record<string, unknown>;
  let knownSignals: string[] = [];
  let domainType: DomainType = 'personal';
  let companyContext: string | null = null;
  let skipCompanyResearch = false;

  if (contactId) {
    entityType = 'person';
    const { data: c, error } = await supabase
      .from('contacts')
      .select('id, full_name, email, role_title, enrichment_data, companies(id, name, domain, enrichment_data, enriched_at)')
      .eq('id', contactId).eq('organization_id', organizationId).maybeSingle();
    if (error || !c) return jsonResponse({ error: 'Contact not found' }, 404);
    const email = (c.email ?? '').toLowerCase().trim();
    const company = c.companies as any;
    const domain = company?.domain ?? (email ? email.split('@')[1] : '');
    domainType = classifyDomain(domain ?? '');
    entityKey = email ? `person:${email}` : `person:${(c.full_name ?? '').toLowerCase().trim()}@${domain}`;

    if (domainType === 'megacorp') {
      return jsonResponse({ error: 'Domaine plateforme (LinkedIn/Google/…) — probablement un utilisateur, pas un salarié. Enrichissement non pertinent.', code: 'MEGACORP_SKIPPED' }, 200);
    }

    if (company) {
      const facts: string[] = [];
      const enrichedAt = company.enriched_at ? new Date(company.enriched_at).getTime() : 0;
      if (enrichedAt > 0 && Date.now() - enrichedAt < COMPANY_FRESH_MS && company.enrichment_data) {
        const data = company.enrichment_data as Record<string, unknown>;
        if (data.industry) facts.push(`Secteur : ${data.industry}`);
        if (data.summary) facts.push(String(data.summary));
      }
      const { data: signals } = await supabase.from('company_signals').select('title').eq('company_id', company.id).order('observed_at', { ascending: false }).limit(3);
      const titles = (signals ?? []).map((s: any) => s.title).filter(Boolean);
      if (titles.length) facts.push(`Actualités récentes déjà connues : ${titles.join(' · ')}`);
      if (facts.length) { companyContext = `Entreprise ${company.name} — ${facts.join(' | ')}`; skipCompanyResearch = true; }
    }

    payload = {
      entityType, entityId: contactId, organizationId,
      fullName: c.full_name ?? '', email, domain, company: company?.name ?? '', linkedinUrl: '',
      tier: 'A', domainType, sourceHints: sourceHintsFor(domainType), skipCompanyResearch, companyContext,
    };
    const { data: sigs } = await supabase.from('behavioral_signals').select('text').eq('contact_id', contactId).limit(25);
    knownSignals = (sigs ?? []).map((s: any) => s.text).filter(Boolean);
  } else {
    entityType = 'company';
    const { data: co, error } = await supabase
      .from('companies').select('id, name, domain, enrichment_data')
      .eq('id', companyId).eq('organization_id', organizationId).maybeSingle();
    if (error || !co) return jsonResponse({ error: 'Company not found' }, 404);
    const domain = (co.domain ?? '').toLowerCase().trim();
    domainType = classifyDomain(domain);
    entityKey = domain ? `company:${domain}` : `company:${(co.name ?? '').toLowerCase().trim()}`;
    payload = { entityType, entityId: companyId, organizationId, fullName: '', email: '', domain, company: co.name ?? '', linkedinUrl: '', tier: 'A', domainType, sourceHints: sourceHintsFor(domainType), skipCompanyResearch: false, companyContext: null };
    const { data: sigs } = await supabase.from('company_signals').select('title').eq('company_id', companyId).limit(25);
    knownSignals = (sigs ?? []).map((s: any) => s.title).filter(Boolean);
  }

  const { data: cached } = await supabase
    .from('enrichment_cache').select('data, refreshed_at').eq('entity_key', entityKey).maybeSingle();

  const persist = async (enr: any) => {
    const now = new Date().toISOString();
    if (contactId) {
      await supabase.from('contacts').update({
        web_bio: enr.summary ?? null, enrichment_data: enr,
        enrichment_status: 'done', last_enriched_at: now, enrichment_error: null,
      }).eq('id', contactId).eq('organization_id', organizationId);
    } else {
      await supabase.from('companies').update({ enrichment_data: enr, enriched_at: now }).eq('id', companyId).eq('organization_id', organizationId);
    }
  };

  if (!forceRefresh && cached?.data && cached.refreshed_at &&
      (Date.now() - new Date(cached.refreshed_at).getTime()) < FRESH_MS) {
    await persist(cached.data);
    return jsonResponse({ status: 'done', source: 'cache', enrichment: cached.data });
  }

  payload.alreadyKnown = {
    previousEnrichment: cached?.data ?? null,
    knownSignals,
    note: 'Ne répète pas ces éléments déjà connus. Concentre-toi sur les informations NOUVELLES, récentes ou manquantes.',
  };

  let enr: any = null;
  try {
    const r = await fetch(N8N_ENRICH_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(150000),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return jsonResponse({ error: `Agent n8n: HTTP ${r.status}`, detail: txt.slice(0, 300), code: 'AGENT_ERROR' }, 502);
    }
    const data = await r.json().catch(() => null);
    enr = data && (data.output ?? data);
  } catch (e) {
    return jsonResponse({ error: 'Agent n8n injoignable (workflow actif ?)', detail: String(e), code: 'AGENT_UNREACHABLE' }, 502);
  }

  if (!enr || (typeof enr === 'object' && !enr.summary && !enr.fullName && !enr.company && !enr.currentRole)) {
    return jsonResponse({ error: 'Agent: réponse vide', code: 'EMPTY' }, 502);
  }

  await persist(enr);
  await supabase.from('enrichment_cache').upsert({
    entity_key: entityKey, entity_type: entityType, data: enr, sources: enr.sources ?? null, refreshed_at: new Date().toISOString(),
  }, { onConflict: 'entity_key' });

  return jsonResponse({ status: 'done', source: 'agent', enrichment: enr });
});

