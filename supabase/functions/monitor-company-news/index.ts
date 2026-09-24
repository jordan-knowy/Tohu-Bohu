// Veille d'actualités d'entreprise (Feed signaux Home).
// 2 modes : utilisateur (JWT + organizationId) ou cron (header x-cron-secret valide → toutes les orgs).
// Chaque signal important génère une NOTIFICATION pour les membres de l'org.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getWebSearchSettings, readWebSearchKeys, runWebSearch, type WebSearchKeys, type WebSearchSettings } from '../_shared/web-search.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

type SearchContext = { keys: WebSearchKeys; settings: WebSearchSettings };

const IMPORTANT = new Set(['churn', 'risque', 'croissance', 'marche', 'mobilite', 'levier']);
function priorityFor(family: string): string {
  if (family === 'churn' || family === 'risque') return 'high';
  if (family === 'presence') return 'info';
  return 'medium';
}

// Mapping principal type→family (taxonomie affichée, colonnes/CSS existants —
// on étend le vocabulaire `type` sans toucher aux 7 valeurs de `family`).
const TYPE_FAMILY: Record<string, string> = {
  levee_fonds: 'croissance',
  acquisition: 'marche',
  dirigeant: 'mobilite',
  recrutement: 'croissance',
  produit: 'levier',
  partenariat: 'levier',
  implantation: 'croissance',
  activite_publique: 'levier',
  positionnement: 'levier',
  resultats: 'croissance',
  marche: 'marche',
  risque: 'risque',
};

function classifyFamily(type: string, text: string): string {
  const s = (text || '').toLowerCase();
  // Un mot-clé de difficulté prime sur le type déclaré (ex. "resultats" avec
  // un déficit dedans doit remonter en risque, pas en croissance).
  if (/faillite|liquidation|cessation|redressement judiciaire/.test(s)) return 'churn';
  if (/licenciement|plan social|fermeture (de|d')|d[ée]ficit|perte nette|difficult[ée]s? financi[eè]res?|litige|proc[eè]s|sanction/.test(s)) return 'risque';
  const mapped = TYPE_FAMILY[(type || '').toLowerCase()];
  if (mapped) return mapped;
  // Repli pour un ancien `type` ou "autre" : ne classer en presence (jamais
  // prioritaire) que si aucun mot-clé fort n'indique un fait significatif.
  if (/churn/.test(s)) return 'churn';
  if (/risque|alerte|d[ée]part/.test(s)) return 'risque';
  if (/lev[ée]e|fund|financement|croissance|recrut|expansion|embauche|hiring/.test(s)) return 'croissance';
  if (/rachat|acquisition|fusion|m&a|cession|prise de participation|controle/.test(s)) return 'marche';
  if (/nomination|promotion|nouveau (dg|ceo|directeur)|arriv[ée]e|mobilit/.test(s)) return 'mobilite';
  if (/partenariat|contrat|lancement|produit|opportunit|appel d'offres|linkedin|positionnement/.test(s)) return 'levier';
  return 'presence';
}

type NewsResult = { items: any[]; error: string | null; sample?: string };

async function newsForCompany(ctx: SearchContext, name: string, domain: string | null): Promise<NewsResult> {
  const prompt = `Recherche les ÉVÉNEMENTS PUBLICS récents (12 derniers mois) sur l'entreprise "${name}"${domain ? ` (site ${domain})` : ''} susceptibles d'avoir un impact réel sur une relation commerciale avec elle.
Sources : presse, LinkedIn (page entreprise et prises de parole publiques de ses dirigeants), communiqués, registres (BODACC/Pappers), site web de l'entreprise.
Cherche, par ordre d'intérêt :
- levée de fonds / financement ;
- acquisition, fusion, changement d'actionnariat ;
- arrivée ou départ d'un décideur, nomination ;
- recrutement important ou vague de recrutements ;
- lancement d'un produit, service ou nouvelle offre ;
- partenariat annoncé ;
- ouverture / fermeture de bureaux ou nouvelle implantation géographique ;
- activité LinkedIn ou prise de parole publique RÉELLEMENT significative (pas une publication routinière) ;
- évolution notable du site web ou du positionnement ;
- résultats financiers ou signaux de croissance/difficulté rendus publics ;
- mouvement concurrentiel ou de marché susceptible d'impacter cette entreprise ;
- litige, procédure, risque (défaillance, plan social, fermeture).

Ne retiens QUE les événements qui pourraient créer une opportunité commerciale, un risque relationnel, ou une raison légitime de reprendre contact — écarte toute actualité neutre, anecdotique ou sans impact business identifiable. Mieux vaut renvoyer moins d'items que du bruit.

Réponds UNIQUEMENT par un tableau JSON (max 4 items, les plus significatifs/récents), sans texte autour :
[{"type":"levee_fonds|acquisition|dirigeant|recrutement|produit|partenariat|implantation|activite_publique|positionnement|resultats|marche|risque|autre","title":"titre court factuel","summary":"1-2 phrases factuelles, en quoi c'est pertinent pour la relation commerciale","source":"Presse|LinkedIn|Registres|Web","source_url":"url si dispo sinon null","date":"AAAA-MM ou AAAA-MM-JJ si connu sinon null"}]
Règle stricte : n'invente RIEN. Si aucun événement significatif et fiable trouvé, renvoie [].`;
  try {
    const result = await runWebSearch(ctx.keys, ctx.settings, [
      { role: 'system', content: 'Veille B2B factuelle. Données publiques vérifiables uniquement, avec source. Aucune hallucination. Réponds en JSON strict.' },
      { role: 'user', content: prompt },
    ]);
    if ('error' in result) return { items: [], error: result.error };
    const content = result.content;
    // Tableau d'objets (ou vide) — évite de capturer des renvois de citation type "[1]".
    const m = content.match(/\[\s*\{[\s\S]*\}\s*\]|\[\s*\]/);
    if (!m) {
      console.warn(`[monitor-company-news] réponse sans JSON pour ${name}: ${content.slice(0, 150)}`);
      return { items: [], error: 'no_json_in_response' };
    }
    const arr = JSON.parse(m[0]);
    return { items: Array.isArray(arr) ? arr : [], error: null, sample: content.slice(0, 160) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[monitor-company-news] échec pour ${name}: ${message}`);
    return { items: [], error: message.slice(0, 120) };
  }
}

type Company = { id: string; name: string; domain: string | null; organization_id: string };

async function processCompany(supabase: any, ctx: SearchContext, c: Company): Promise<{ inserted: any[]; error: string | null; found: number; sample?: string }> {
  const { items, error: newsError, sample } = await newsForCompany(ctx, c.name, c.domain);
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
      family: classifyFamily(it.type, `${it.type} ${it.title} ${it.summary ?? ''}`),
      title: String(it.title).slice(0, 300),
      summary: it.summary ? String(it.summary).slice(0, 800) : null,
      source: it.source ?? 'Web',
      source_url: it.source_url ?? null,
      observed_at: observedAt,
      // Échelle 0-1 : company_signals.confidence est numeric(3,2) (plafond ~9.99),
      // pensé pour une fraction — PAS le 0-100 utilisé ailleurs dans l'app
      // Les autres confiances produit utilisent parfois 0-100. Ne pas « corriger » vers 60 sans
      // migrer la colonne : ça produit une erreur numeric field overflow.
      confidence: 0.6,
      status: 'candidate',
      updated_at: new Date().toISOString(),
    });
  }
  let inserted: any[] = [];
  if (rows.length) {
    const { data, error } = await supabase
      .from('company_signals')
      .upsert(rows, { onConflict: 'organization_id,company_id,title', ignoreDuplicates: true })
      .select('id, family, title, summary, company_id, organization_id');
    if (error) {
      console.error(`[monitor-company-news] insertion signaux ${c.name}: ${error.message}`);
      return { inserted: [], error: `db:${error.message}`.slice(0, 120), found: rows.length };
    }
    inserted = data ?? [];
  }
  // Ne pas marquer un compte « surveillé » quand la recherche a échoué : il sera retenté au prochain passage.
  if (!newsError) await supabase.from('companies').update({ last_monitored_at: new Date().toISOString() }).eq('id', c.id);
  return { inserted, error: newsError, found: rows.length, sample };
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

  const keys = readWebSearchKeys();
  const settings = await getWebSearchSettings(supabase);
  if (!keys.openrouter && !(settings.perplexityDirect && keys.perplexity)) {
    return jsonResponse({ error: 'Veille indisponible : OPENROUTER_API_KEY manquante (ou Perplexity direct activé sans clé).', code: 'NO_KEY' }, 500);
  }
  const ctx: SearchContext = { keys, settings };

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
    let query = supabase
      .from('companies')
      .select('id, name, domain, organization_id, last_monitored_at')
      .eq('is_tracked', true);
    query = body.organizationId
      ? query.eq('organization_id', body.organizationId)
      : query.or(`last_monitored_at.is.null,last_monitored_at.lt.${cutoff}`);
    const { data } = await query.order('last_monitored_at', { ascending: true, nullsFirst: true }).limit(25);
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
      .eq('is_tracked', true)
      .order('tracked_at', { ascending: false, nullsFirst: false })
      .limit(limit);
    companies = (data ?? []) as Company[];
  }

  if (!companies.length) return jsonResponse({ success: true, inserted: 0, scanned: 0, message: 'Aucun compte à surveiller.' });

  const allInserted: any[] = [];
  const companyName = new Map<string, string>();
  const failures: { company: string; error: string }[] = [];
  const empty: { company: string; sample?: string }[] = [];
  for (const c of companies) {
    companyName.set(c.id, c.name);
    const { inserted, error, found, sample } = await processCompany(supabase, ctx, c);
    if (error) failures.push({ company: c.name, error });
    else if (!found) empty.push({ company: c.name, sample });
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

  return jsonResponse({ success: true, inserted: allInserted.length, scanned: companies.length, notified, engine: settings.perplexityDirect ? 'perplexity+openrouter' : `openrouter:${settings.model}`, failed: failures.length, failures: failures.slice(0, 5), empty: empty.slice(0, 3), mode: isCron ? 'cron' : 'user' });
});
