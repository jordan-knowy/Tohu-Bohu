// Veille d'actualités d'entreprise (Feed signaux Home).
// 2 modes : utilisateur (JWT + organizationId) ou cron (header x-cron-secret valide → toutes les orgs).
// Chaque signal important génère une NOTIFICATION pour les membres de l'org.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const PERPLEXITY_API = 'https://api.perplexity.ai/chat/completions';
const PERPLEXITY_MODEL = 'sonar';

const IMPORTANT = new Set(['churn', 'risque', 'croissance', 'marche', 'mobilite', 'levier']);
function priorityFor(family: string): string {
  if (family === 'churn' || family === 'risque') return 'high';
  if (family === 'presence') return 'info';
  return 'medium';
}

function classifyFamily(typeOrText: string): string {
  const s = (typeOrText || '').toLowerCase();
  if (/churn|faillite|liquidation|cessation|redressement/.test(s)) return 'churn';
  if (/risque|litige|proc[eè]s|sanction|alerte|d[ée]part/.test(s)) return 'risque';
  if (/lev[ée]e|fund|financement|croissance|recrut|expansion|embauche|hiring/.test(s)) return 'croissance';
  if (/rachat|acquisition|fusion|m&a|cession|prise de participation|controle/.test(s)) return 'marche';
  if (/nomination|promotion|nouveau (dg|ceo|directeur)|arriv[ée]e|mobilit/.test(s)) return 'mobilite';
  if (/partenariat|contrat|lancement|produit|opportunit|appel d'offres/.test(s)) return 'levier';
  return 'presence';
}

async function newsForCompany(key: string, name: string, domain: string | null): Promise<any[]> {
  const prompt = `Recherche les ACTUALITÉS PUBLIQUES récentes (12 derniers mois) sur l'entreprise "${name}"${domain ? ` (site ${domain})` : ''}.
Sources : presse, LinkedIn (page entreprise), communiqués, registres (BODACC/Pappers).
Cherche : levée de fonds / financement, rachat / fusion / M&A, changement de dirigeant ou nomination, recrutement / croissance / expansion, lancement produit, partenariat, litige / risque, procédure.

Réponds UNIQUEMENT par un tableau JSON (max 4 items, les plus récents/pertinents), sans texte autour :
[{"type":"levee_fonds|rachat|dirigeant|recrutement|produit|partenariat|risque|autre","title":"titre court factuel","summary":"1-2 phrases factuelles","source":"Presse|LinkedIn|Registres|Web","source_url":"url si dispo sinon null","date":"AAAA-MM ou AAAA-MM-JJ si connu sinon null"}]
Règle stricte : n'invente RIEN. Si aucune actualité fiable trouvée, renvoie [].`;
  try {
    const res = await fetch(PERPLEXITY_API, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: PERPLEXITY_MODEL,
        messages: [
          { role: 'system', content: 'Veille B2B factuelle. Données publiques vérifiables uniquement, avec source. Aucune hallucination. Réponds en JSON strict.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 900,
        temperature: 0.1,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const content: string = data.choices?.[0]?.message?.content ?? '';
    const m = content.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

type Company = { id: string; name: string; domain: string | null; organization_id: string };

async function processCompany(supabase: any, key: string, c: Company): Promise<{ inserted: any[] }> {
  const items = await newsForCompany(key, c.name, c.domain);
  const rows: any[] = [];
  for (const it of items) {
    if (!it?.title) continue;
    let observedAt: string | null = null;
    if (it.date) {
      const d = String(it.date);
      observedAt = /^\d{4}-\d{2}$/.test(d) ? `${d}-01T00:00:00Z` : (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00Z` : null);
    }
    rows.push({
      organization_id: c.organization_id,
      company_id: c.id,
      family: classifyFamily(`${it.type} ${it.title}`),
      title: String(it.title).slice(0, 300),
      summary: it.summary ? String(it.summary).slice(0, 800) : null,
      source: it.source ?? 'Web',
      source_url: it.source_url ?? null,
      observed_at: observedAt,
      confidence: 0.6,
      status: 'candidate',
      updated_at: new Date().toISOString(),
    });
  }
  let inserted: any[] = [];
  if (rows.length) {
    const { data } = await supabase
      .from('company_signals')
      .upsert(rows, { onConflict: 'organization_id,company_id,title', ignoreDuplicates: true })
      .select('id, family, title, summary, company_id, organization_id');
    inserted = data ?? [];
  }
  await supabase.from('companies').update({ last_monitored_at: new Date().toISOString() }).eq('id', c.id);
  return { inserted };
}

async function notifyMembers(supabase: any, orgMembers: Map<string, string[]>, companyName: Map<string, string>, signals: any[]) {
  const notifs: any[] = [];
  for (const s of signals) {
    if (!IMPORTANT.has(s.family)) continue;
    const members = orgMembers.get(s.organization_id) ?? [];
    for (const uid of members) {
      notifs.push({
        organization_id: s.organization_id,
        user_id: uid,
        type: 'company_signal',
        priority: priorityFor(s.family),
        title: `${companyName.get(s.company_id) ?? 'Compte'} — ${s.title}`.slice(0, 200),
        body: s.summary ?? null,
        entity_type: 'company',
        entity_id: s.company_id,
        link: `/company/${s.company_id}`,
      });
    }
  }
  if (notifs.length) await supabase.from('notifications').insert(notifs);
  return notifs.length;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const key = Deno.env.get('PERPLEXITY_API_KEY');
  if (!key) return jsonResponse({ error: 'Veille indisponible (PERPLEXITY_API_KEY manquant).', code: 'NO_KEY' }, 500);

  const body = await req.json().catch(() => ({}));

  const cronHeader = req.headers.get('x-cron-secret');
  let isCron = false;
  if (cronHeader) {
    const { data: sec } = await supabase.from('app_secrets').select('value').eq('name', 'monitor_cron').maybeSingle();
    if (sec?.value && sec.value === cronHeader) isCron = true;
  }

  let companies: Company[] = [];

  if (isCron) {
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('companies')
      .select('id, name, domain, organization_id, last_monitored_at')
      .or(`last_monitored_at.is.null,last_monitored_at.lt.${cutoff}`)
      .order('last_monitored_at', { ascending: true, nullsFirst: true })
      .limit(25);
    companies = (data ?? []) as Company[];
  } else {
    const auth = req.headers.get('Authorization');
    if (!auth) return jsonResponse({ error: 'Missing authorization header' }, 401);
    const { data: { user }, error: userErr } = await supabase.auth.getUser(auth.replace('Bearer ', ''));
    if (userErr || !user) return jsonResponse({ error: 'Unauthorized' }, 401);
    const { organizationId, limit = 8 } = body;
    if (!organizationId) return jsonResponse({ error: 'organizationId required' }, 400);
    const { data } = await supabase
      .from('companies')
      .select('id, name, domain, organization_id')
      .eq('organization_id', organizationId)
      .limit(limit);
    companies = (data ?? []) as Company[];
  }

  if (!companies.length) return jsonResponse({ success: true, inserted: 0, scanned: 0, message: 'Aucun compte à surveiller.' });

  const allInserted: any[] = [];
  const companyName = new Map<string, string>();
  for (const c of companies) {
    companyName.set(c.id, c.name);
    const { inserted } = await processCompany(supabase, key, c);
    allInserted.push(...inserted);
  }

  let notified = 0;
  if (allInserted.length) {
    const orgIds = Array.from(new Set(allInserted.map(s => s.organization_id)));
    const { data: members } = await supabase.from('memberships').select('organization_id, user_id').in('organization_id', orgIds);
    const orgMembers = new Map<string, string[]>();
    for (const m of (members ?? []) as any[]) {
      if (!orgMembers.has(m.organization_id)) orgMembers.set(m.organization_id, []);
      orgMembers.get(m.organization_id)!.push(m.user_id);
    }
    notified = await notifyMembers(supabase, orgMembers, companyName, allInserted);
  }

  return jsonResponse({ success: true, inserted: allInserted.length, scanned: companies.length, notified, mode: isCron ? 'cron' : 'user' });
});

