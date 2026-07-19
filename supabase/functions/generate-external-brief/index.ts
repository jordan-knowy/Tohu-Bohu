// Spec-38 + Spec-39 — Fiche externe (brief sans inbox) & orchestration email → dossier
// Transforme une adresse email en dossier JSON validé et 100% public (zéro-hallu).
import { corsHeaders, jsonResponse } from './_shared/cors.ts';

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'google/gemini-2.5-flash-lite';
const PERPLEXITY_API = 'https://api.perplexity.ai/chat/completions';
const PERPLEXITY_MODEL = 'sonar';

const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'yahoo.fr', 'free.fr',
  'orange.fr', 'wanadoo.fr', 'icloud.com', 'me.com', 'live.com', 'protonmail.com',
  'laposte.net', 'sfr.fr', 'gmx.com', 'aol.com',
]);

type Intention = 'vente' | 'decouverte' | 'negociation' | 'retention' | 'partenariat';

// ── E1 : résolution identité depuis l'email ──────────────────────────────────
function resolveIdentity(email: string): { name: string; domain: string; isGeneric: boolean; company: string } {
  const [local, domain = ''] = email.trim().toLowerCase().split('@');
  const isGeneric = PERSONAL_DOMAINS.has(domain);
  const name = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  const company = isGeneric ? '' : domain.split('.')[0].replace(/-/g, ' ');
  return { name, domain, isGeneric, company };
}

// ── Recherche publique (Perplexity sonar — web search) ───────────────────────
async function publicResearch(email: string, identity: ReturnType<typeof resolveIdentity>, intention: Intention): Promise<string | null> {
  const key = Deno.env.get('PERPLEXITY_API_KEY');
  if (key === undefined || key === '') return null;

  const prompt = `Recherche 100% PUBLIQUE pour préparer un rendez-vous commercial (intention: ${intention}).
Adresse email du prospect: ${email}
Nom candidat: ${identity.name || 'inconnu'}
Domaine: ${identity.domain}${identity.isGeneric ? ' (domaine générique — entreprise à confirmer)' : ` → entreprise candidate: ${identity.company}`}

Cherche UNIQUEMENT des informations publiques et vérifiables :
1. ENTREPRISE : nom légal, SIREN, forme juridique, effectif, ville, secteur, description, site web officiel. Sources FR : pappers.fr, societe.com, BODACC, INPI.
2. DÉCLENCHEURS "pourquoi maintenant" : levée de fonds, M&A/rachat, changement de dirigeant, croissance/recrutement, actualité presse, réglementaire. Avec DATE et SOURCE.
3. PERSONNE : poste actuel (règle stricte : confirmé seulement si headline LinkedIn = entreprise ET une 2e source corrobore), parcours/CV public (LinkedIn, Viadeo), rôle dans la décision d'achat.

Pour CHAQUE fait, cite la source. Si une info n'est pas trouvable publiquement, écris explicitement "à confirmer". N'invente JAMAIS de coordonnée, SIREN, ou poste.`;

  try {
    const res = await fetch(PERPLEXITY_API, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: PERPLEXITY_MODEL,
        messages: [
          { role: 'system', content: 'Expert en recherche professionnelle B2B publique. Faits vérifiables avec sources uniquement. Aucune hallucination. Texte brut.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 1500,
        temperature: 0.1,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content: string = data.choices?.[0]?.message?.content ?? '';
    return content.trim().length > 40 ? content.trim() : null;
  } catch { return null; }
}

// ── E7 : EOS a priori (Fit / Timing / Pouvoir) ───────────────────────────────
const EOS_WEIGHTS = { fit: 0.35, timing: 0.30, pouvoir: 0.35 };

function computeEosScore(fit: number, timing: number, pouvoir: number): number {
  return Math.round(fit * EOS_WEIGHTS.fit + timing * EOS_WEIGHTS.timing + pouvoir * EOS_WEIGHTS.pouvoir);
}

// ── E8 : structuration LLM → brief_externe_schema ────────────────────────────
async function structureDossier(
  email: string,
  identity: ReturnType<typeof resolveIdentity>,
  intention: Intention,
  sellerCompany: string,
  research: string | null,
): Promise<any> {
  const key = Deno.env.get('OPENROUTER_API_KEY');

  const SYSTEM = `Tu assembles un DOSSIER de brief commercial externe 100% PUBLIC (sans accès à la boîte mail).
Doctrine NON NÉGOCIABLE :
- Zéro-hallucination : tout champ non sourçable = null ou "à confirmer". N'invente JAMAIS coordonnée, SIREN, poste, parcours.
- Règle stricte d'emploi : participant.confirmed=true SEULEMENT si le poste est corroboré par 2 sources publiques. Sinon confirmed=false.
- EOS = score "a priori" (jamais une probabilité validée).
Réponds UNIQUEMENT en JSON valide conforme au schéma demandé.`;

  const USER = `Email déclencheur: ${email}
Nom candidat: ${identity.name || 'à confirmer'}
Domaine: ${identity.domain}${identity.isGeneric ? ' (générique → entreprise à confirmer)' : ''}
Entreprise candidate: ${identity.company || 'à confirmer'}
Entreprise du vendeur: ${sellerCompany}
Intention: ${intention}

RECHERCHE PUBLIQUE DISPONIBLE :
${research ?? '(aucune recherche disponible — remplis avec "à confirmer" et null, ne devine rien)'}

Produis ce JSON (respecte les types, null/"à confirmer" si non sourcé) :
{
  "prospect": {
    "company": { "name", "domain", "siren":null|string, "forme_juridique":null|string, "effectif":null|string, "ca":null|string, "ville":null|string, "secteur":null|string, "description":null|string, "site":null|string, "sources":[string] },
    "triggers": [ { "type":"reglementaire|ma|dirigeant|croissance|presse|autre", "label", "date":null|string, "ampleur":null|string, "source" } ],
    "participants": [ { "name", "title", "linkedin":null|string, "buying_role":"decideur|acheteur_eco|champion|influenceur|utilisateur|gatekeeper|a_confirmer", "confirmed":bool, "parcours":[{"company","title","period":null|string,"source"}], "icebreaker":null|string, "sources":[string] } ]
  },
  "eos": {
    "fit": { "score":0-100, "drivers":[string], "sources":[string] },
    "timing": { "score":0-100, "drivers":[string], "sources":[string] },
    "pouvoir": { "score":0-100, "drivers":[string], "sources":[string] }
  },
  "mode_5min": { "qui":string, "pourquoi_maintenant":string, "angle":string, "premiere_phrase":string, "anti_pattern":string },
  "coverage_score": 0-100
}`;

  if (key === undefined || key === '') {
    return fallbackDossier(identity);
  }

  try {
    const res = await fetch(OPENROUTER_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://knowy.ai',
        'X-Title': 'Knowr External Brief',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: USER },
        ],
        temperature: 0.2,
        max_tokens: 2200,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) return fallbackDossier(identity);
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content ?? '{}';
    let parsed: any = {};
    try { parsed = JSON.parse(raw); }
    catch { const m = raw.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); }
    return parsed;
  } catch {
    return fallbackDossier(identity);
  }
}

function fallbackDossier(identity: ReturnType<typeof resolveIdentity>): any {
  return {
    prospect: {
      company: {
        name: identity.company || 'à confirmer',
        domain: identity.domain,
        siren: null, forme_juridique: null, effectif: null, ca: null,
        ville: null, secteur: null, description: null,
        site: identity.isGeneric ? null : `https://${identity.domain}`,
        sources: [],
      },
      triggers: [],
      participants: identity.name ? [{
        name: identity.name, title: 'à confirmer', linkedin: null,
        buying_role: 'a_confirmer', confirmed: false, parcours: [],
        icebreaker: null, sources: [],
      }] : [],
    },
    eos: {
      fit: { score: 0, drivers: [], sources: [] },
      timing: { score: 0, drivers: [], sources: [] },
      pouvoir: { score: 0, drivers: [], sources: [] },
    },
    mode_5min: null,
    coverage_score: 0,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const body = await req.json().catch(() => null);
  const email: string = body?.trigger_email ?? body?.email ?? '';
  const intention: Intention = body?.intention ?? 'vente';
  const sellerCompany: string = body?.seller_company ?? 'Mon entreprise';

  if (!email || !email.includes('@')) {
    return jsonResponse({ error: 'trigger_email valide requis' }, 400);
  }

  try {
    const identity = resolveIdentity(email);
    const research = await publicResearch(email, identity, intention);
    const dossier = await structureDossier(email, identity, intention, sellerCompany, research);

    const fit = dossier?.eos?.fit?.score ?? 0;
    const timing = dossier?.eos?.timing?.score ?? 0;
    const pouvoir = dossier?.eos?.pouvoir?.score ?? 0;
    const eosScore = computeEosScore(fit, timing, pouvoir);

    const result = {
      seller: { company: sellerCompany, intention },
      trigger_email: email,
      prospect: dossier?.prospect ?? fallbackDossier(identity).prospect,
      eos: {
        fit: dossier?.eos?.fit ?? { score: 0, drivers: [], sources: [] },
        timing: dossier?.eos?.timing ?? { score: 0, drivers: [], sources: [] },
        pouvoir: dossier?.eos?.pouvoir ?? { score: 0, drivers: [], sources: [] },
        agg: 'a_priori',
        score: eosScore,
      },
      mode_5min: dossier?.mode_5min ?? null,
      coverage_score: dossier?.coverage_score ?? 0,
      meta: {
        used_research: Boolean(research),
        used_llm: Boolean(Deno.env.get('OPENROUTER_API_KEY')),
        generic_domain: identity.isGeneric,
        generated_at: new Date().toISOString(),
      },
    };

    return jsonResponse(result);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Erreur génération brief externe' }, 500);
  }
});

