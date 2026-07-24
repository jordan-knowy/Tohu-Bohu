// Agent de recherche B2B (personne/société) — remplace le workflow n8n
// "Tohu-Bohu — Enrichissement IA (OpenRouter + Perplexity)".
//
// Le node "AI Agent" de n8n n'était qu'une boucle ReAct standard (le LLM décide
// d'appeler l'outil de recherche, reçoit le résultat, décide de continuer ou de
// conclure) tournant sur une instance à mémoire partagée et fragile : un pic sur
// UNE exécution pouvait faire crasher toutes les autres en vol. Cette version
// reproduit fidèlement le même prompt système et le même budget de recherche,
// mais en appels directs (chaque invocation d'Edge Function est isolée — plus de
// mémoire partagée à faire tomber) et avec une sortie structurée forcée via
// tool-calling natif (plus fiable qu'un output parser qui "répare" du JSON après
// coup). La vraie protection de charge est le sémaphore global
// (acquire_enrichment_slot / release_enrichment_slot, cf. migration
// 20260724120000_enrichment_slots.sql) — appelé par le code qui invoque cet agent.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'anthropic/claude-haiku-4.5';
const PERPLEXITY_API = 'https://api.perplexity.ai/chat/completions';
const PERPLEXITY_MODEL = 'sonar';
const MAX_ITERATIONS = 6;
const CALL_TIMEOUT_MS = 30000;
const SLOT_ACQUIRE_TIMEOUT_MS = 60000;
const SLOT_POLL_INTERVAL_MS = 1200;

export type EnrichmentInput = {
  entityType: string;
  fullName: string;
  email: string;
  company: string;
  domain: string;
  linkedinUrl: string;
  knownLinkedinUrl: string;
  tier: string;
  domainType: string;
  sourceHints: string | null;
  companyContext: string | null;
  skipCompanyResearch: boolean;
  alreadyKnown: unknown;
  /** Le nom actuel est un pseudo/local-part d'email (ex. "Fxravet81"), pas un vrai
   *  nom — priorité absolue à la recherche du vrai prénom/nom avant tout le reste. */
  nameLooksLikePlaceholder: boolean;
};

export type EnrichmentProfile = {
  entityType?: string;
  fullName?: string;
  fullNameConfidence?: 'confirmed' | 'to_confirm';
  currentRole?: string | null;
  currentCompany?: string | null;
  roleConfidence?: 'confirmed' | 'to_confirm';
  roleStartedAt?: string | null;
  seniority?: string | null;
  linkedinUrl?: string | null;
  location?: string | null;
  summary?: string | null;
  recentActivity?: Array<{ title: string; date?: string | null; source?: string | null; url?: string | null }>;
  company?: {
    name?: string | null; domain?: string | null; industry?: string | null; size?: string | null; hq?: string | null;
    description?: string | null;
    recentNews?: Array<{ title: string; date?: string | null; source?: string | null; url?: string | null }>;
  } | null;
  relatedPeople?: Array<{ name: string; role?: string | null; why?: string | null }>;
  talkingPoints?: string[];
  sources?: string[];
  confidence?: number;
};

const SYSTEM_PROMPT = `Tu es un analyste de recherche B2B senior pour un CRM relationnel (Tohu-Bohu). Objectif : un profil enrichi PRÉCIS, PROFOND et ACTIONNABLE sur une personne ou une société, à partir de recherches web réelles — au budget de recherche le plus serré possible.

LANGUE DE SORTIE (IMPÉRATIF) : RÉDIGE TOUS les champs textuels EN FRANÇAIS — summary, description, talkingPoints, recentActivity[].title, company.description, company.recentNews[].title, relatedPeople[].role et relatedPeople[].why, etc. MÊME si les sources web sont en anglais, TRADUIS et reformule en français naturel et professionnel. Ne laisse JAMAIS une phrase en anglais. Conserve uniquement en l'état : noms propres, raisons sociales, intitulés de poste usuels (ex. « CEO »), URLs et noms de sources.

BUDGET DE RECHERCHE (IMPÉRATIF — chaque appel à l'outil "web_search" a un coût réel) :
- Palier A (recherche complète) : 2 à 3 appels MAXIMUM. 1 sur la personne/LinkedIn, 1 optionnel sur son actualité récente, 1 optionnel sur l'entreprise UNIQUEMENT si aucun "CONTEXTE ENTREPRISE DÉJÀ CONNU" n'est fourni ci-dessus.
- Palier B (vérification légère) : 1 SEUL appel maximum, ciblé sur "y a-t-il un changement de poste ou une actualité récente" — pas de recherche exhaustive.
- Si un CONTEXTE ENTREPRISE DÉJÀ CONNU est fourni, N'INTERROGE PAS l'outil sur l'entreprise elle-même — réutilise ce contexte tel quel dans le champ "company".
- N'effectue JAMAIS plus d'appels que ce budget. Si l'information n'est pas trouvée dans ce budget, renseigne "to_confirm" ou null plutôt que de continuer à chercher.

RÉSOLUTION DU VRAI NOM (impératif quand le message signale "NOM ACTUEL PROBABLEMENT UN PSEUDO") : un nom dérivé d'un email (ex. "Fxravet81", "jdupont42") n'est PAS un vrai nom. Dans ce cas, ta priorité n°1 pour le premier appel "web_search" est de trouver le vrai prénom et nom de famille (LinkedIn en priorité, puis web). Renseigne le résultat dans "fullName" avec "fullNameConfidence" :
- "confirmed" seulement si LinkedIn nominatif clair ou DEUX sources concordent sur le même prénom/nom.
- "to_confirm" si une seule source, plausible mais non recoupée.
- Si rien trouvé, renvoie "fullName" EXACTEMENT identique à la valeur donnée dans "Nom :" ci-dessous (recopie-la telle quelle, ne la restructure PAS) et "fullNameConfidence" à "to_confirm" — n'invente jamais un nom, et ne prends JAMAIS le nom de la société ou du domaine pour un nom de famille.
FORMAT DU CHAMP "fullName" (uniquement quand un vrai prénom ET nom de famille de la PERSONNE ont été trouvés) : prénom en minuscules, NOM DE FAMILLE EN MAJUSCULES, dans cet ordre — ex. "françois-xavier RAVET", "julie MARTIN".

ROUTAGE DES SOURCES : suis STRICTEMENT les "SOURCES PRIORITAIRES POUR CE DOMAINE" transmises dans le message plutôt que d'improviser — ce routage est déjà déterminé (registre légal pour une entreprise française, Crunchbase pour une startup, etc.).

ANTI-HOMONYMES (important) : le domaine email de la personne PROUVE son appartenance à l'organisation citée. Ignore tout résultat concernant un homonyme sans lien avéré avec cette organisation.

ANTI-RÉPÉTITION (important) : les blocs "DÉJÀ CONNU" listent ce que l'utilisateur a déjà. NE les répète PAS tel quel. Apporte du NOUVEAU, du plus récent, ou comble les manques. Si rien de neuf, ne réinvente rien.

DOCTRINE ZÉRO-HALLUCINATION (impératif) :
- N'invente JAMAIS une donnée (poste, tél, taille, email). Non vérifiable → null, roleConfidence="to_confirm".
- Poste actuel affirmé (roleConfidence="confirmed") seulement si DEUX sources concordent, ou si le contexte entreprise déjà connu le confirme. Sinon "to_confirm".
- Cite les URLs réelles dans "sources". Préfère sources primaires : LinkedIn, site officiel, presse éco, registres.

SORTIE : appelle l'outil "emit_profile" une seule fois, avec TOUS LES TEXTES EN FRANÇAIS. talkingPoints = 2-4 angles concrets et personnalisés (en français) pour engager la relation maintenant. recentActivity = faits datés avec source (titres en français). relatedPeople = personnes pertinentes de l'entreprise, uniquement si palier A et pertinent, avec un 'why' actionnable en français.`;

function buildUserPrompt(input: EnrichmentInput): string {
  return `Type d'entité : ${input.entityType}
Nom : ${input.fullName}
Email : ${input.email}
Société : ${input.company}
Domaine : ${input.domain}
LinkedIn connu : ${input.knownLinkedinUrl || input.linkedinUrl}
Palier de recherche : ${input.tier} (${input.tier === 'A' ? 'recherche complète' : 'vérification légère'})
Type de domaine : ${input.domainType}
${input.nameLooksLikePlaceholder ? '\n⚠️ NOM ACTUEL PROBABLEMENT UN PSEUDO (dérivé de l\'email, pas un vrai nom) — voir RÉSOLUTION DU VRAI NOM ci-dessus, priorité n°1.\n' : ''}
=== SOURCES PRIORITAIRES POUR CE DOMAINE ===
${input.sourceHints || 'Aucune source spécifique — recherche générale.'}

=== CONTEXTE ENTREPRISE DÉJÀ CONNU (ne PAS re-rechercher l'entreprise si ce contexte est présent) ===
${input.companyContext || 'Aucun contexte entreprise fourni.'}

=== DÉJÀ CONNU SUR LA PERSONNE (ne PAS répéter — base de référence) ===
${JSON.stringify(input.alreadyKnown)}

Mène une recherche web ciblée, dans le budget d'appels imposé par ton palier, et renvoie le profil structuré. Concentre-toi en priorité sur les informations NOUVELLES, récentes ou manquantes par rapport au déjà-connu.`;
}

const ACTIVITY_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    date: { type: ['string', 'null'] },
    source: { type: ['string', 'null'] },
    url: { type: ['string', 'null'] },
  },
  required: ['title'],
};

const EMIT_PROFILE_PARAMETERS = {
  type: 'object',
  properties: {
    entityType: { type: 'string', enum: ['person', 'company'] },
    fullName: { type: 'string', description: 'Prénom en minuscules, NOM DE FAMILLE EN MAJUSCULES (ex. "françois-xavier RAVET").' },
    fullNameConfidence: { type: 'string', enum: ['confirmed', 'to_confirm'] },
    currentRole: { type: ['string', 'null'] },
    currentCompany: { type: ['string', 'null'] },
    roleConfidence: { type: 'string', enum: ['confirmed', 'to_confirm'] },
    roleStartedAt: { type: ['string', 'null'], description: 'AAAA-MM-JJ si connu' },
    seniority: { type: ['string', 'null'] },
    linkedinUrl: { type: ['string', 'null'] },
    location: { type: ['string', 'null'] },
    summary: { type: ['string', 'null'] },
    recentActivity: { type: 'array', items: ACTIVITY_ITEM_SCHEMA },
    company: {
      type: ['object', 'null'],
      properties: {
        name: { type: ['string', 'null'] },
        domain: { type: ['string', 'null'] },
        industry: { type: ['string', 'null'] },
        size: { type: ['string', 'null'] },
        hq: { type: ['string', 'null'] },
        description: { type: ['string', 'null'] },
        recentNews: { type: 'array', items: ACTIVITY_ITEM_SCHEMA },
      },
    },
    relatedPeople: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, role: { type: ['string', 'null'] }, why: { type: ['string', 'null'] } },
        required: ['name'],
      },
    },
    talkingPoints: { type: 'array', items: { type: 'string' } },
    sources: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
  },
  required: ['entityType', 'fullName', 'fullNameConfidence', 'roleConfidence'],
};

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Recherche web ciblée — une seule question précise à la fois (personne, société, actualité récente, profil LinkedIn).',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Requête de recherche précise et ciblée.' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'emit_profile',
      description: "Renvoie le profil enrichi final structuré. À appeler une seule fois, quand la recherche (dans le budget imparti) est terminée.",
      parameters: EMIT_PROFILE_PARAMETERS,
    },
  },
];

type ChatMessage = Record<string, unknown>;

async function callOpenRouter(apiKey: string, messages: ChatMessage[], forceEmit: boolean) {
  const res = await fetch(OPENROUTER_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      temperature: 0.2,
      messages,
      tools: TOOLS,
      tool_choice: forceEmit ? { type: 'function', function: { name: 'emit_profile' } } : 'auto',
    }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status} : ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function webSearch(apiKey: string, query: string): Promise<string> {
  try {
    const res = await fetch(PERPLEXITY_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: PERPLEXITY_MODEL,
        messages: [
          { role: 'system', content: 'Recherche web factuelle. Réponds de façon concise (5-10 lignes), cite les faits datés et les sources. Aucune invention.' },
          { role: 'user', content: query },
        ],
        max_tokens: 700,
        temperature: 0.1,
        search_recency_filter: 'year',
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    if (!res.ok) return `Recherche indisponible (${res.status}).`;
    const data = await res.json();
    const content: string = data.choices?.[0]?.message?.content ?? '';
    const citations: string[] = Array.isArray(data.citations) ? data.citations : [];
    return citations.length ? `${content}\n\nSources : ${citations.join(', ')}` : content;
  } catch (err) {
    return `Recherche impossible : ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Convention imposée pour tout nom de personne dans l'app : prénom en
 *  minuscules, NOM DE FAMILLE EN MAJUSCULES (ex. "françois-xavier RAVET").
 *  Le dernier "mot" est traité comme le nom de famille — heuristique simple,
 *  suffisante pour l'ordre prénom(s)-puis-nom majoritaire en France. */
export function formatPersonName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return trimmed;
  const parts = trimmed.split(' ');
  if (parts.length === 1) return parts[0].toLowerCase();
  const lastName = parts[parts.length - 1];
  const firstNames = parts.slice(0, -1).join(' ');
  return `${firstNames.toLowerCase()} ${lastName.toUpperCase()}`;
}

function safeParseArgs(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Boucle ReAct bornée (même contrat que le node "AI Agent" n8n qu'elle remplace) :
 *  le modèle décide d'appeler web_search (budget imposé par le prompt système) puis
 *  conclut via emit_profile (sortie forcée par tool-calling natif, pas de réparation
 *  de JSON a posteriori). Renvoie null si aucun profil fiable n'a pu être produit dans
 *  le budget d'itérations — le code appelant doit alors marquer l'enrichissement en échec. */
export async function runEnrichmentAgent(input: EnrichmentInput): Promise<EnrichmentProfile | null> {
  const openrouterKey = Deno.env.get('OPENROUTER_API_KEY');
  const perplexityKey = Deno.env.get('PERPLEXITY_API_KEY');
  if (!openrouterKey || !perplexityKey) throw new Error('OPENROUTER_API_KEY ou PERPLEXITY_API_KEY manquant côté serveur.');

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(input) },
  ];

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    const forceEmit = iteration === MAX_ITERATIONS;
    const data = await callOpenRouter(openrouterKey, messages, forceEmit);
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error('Réponse OpenRouter vide.');
    messages.push(msg);

    const toolCalls = msg.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }> | undefined;
    if (!toolCalls?.length) {
      messages.push({ role: 'user', content: 'Réponds uniquement via l’outil emit_profile.' });
      continue;
    }

    let emitted: EnrichmentProfile | null = null;
    for (const call of toolCalls) {
      if (call.function.name === 'emit_profile') {
        const parsed = safeParseArgs(call.function.arguments);
        if (parsed) {
          emitted = parsed as EnrichmentProfile;
          if (typeof emitted.fullName === 'string' && emitted.fullName) emitted.fullName = formatPersonName(emitted.fullName);
          messages.push({ role: 'tool', tool_call_id: call.id, content: 'OK' });
        } else {
          messages.push({ role: 'tool', tool_call_id: call.id, content: 'JSON invalide, réessaie avec un JSON strictement valide.' });
        }
      } else if (call.function.name === 'web_search') {
        const args = safeParseArgs(call.function.arguments);
        const result = await webSearch(perplexityKey, String(args?.query ?? ''));
        messages.push({ role: 'tool', tool_call_id: call.id, content: result });
      } else {
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'Outil inconnu.' });
      }
    }
    if (emitted) return emitted;
  }
  return null;
}

async function acquireSlot(supabase: SupabaseClient): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < SLOT_ACQUIRE_TIMEOUT_MS) {
    const { data, error } = await supabase.rpc('acquire_enrichment_slot');
    if (error) throw new Error(`Sémaphore d'enrichissement indisponible : ${error.message}`);
    if (typeof data === 'number') return data;
    await new Promise((resolve) => setTimeout(resolve, SLOT_POLL_INTERVAL_MS + Math.random() * 400));
  }
  throw new Error('Charge d’enrichissement trop élevée, réessaie plus tard.');
}

async function releaseSlot(supabase: SupabaseClient, slotId: number): Promise<void> {
  await supabase.rpc('release_enrichment_slot', { p_id: slotId });
}

/** Point d'entrée à utiliser par tout appelant : garantit qu'aucun appel IA ne part
 *  sans être compté dans le sémaphore global. C'est l'absence de cette garantie côté
 *  n8n (cap de concurrence local à chaque invocation, jamais partagé entre elles) qui
 *  a permis à plusieurs invocations simultanées de dépasser le cap et de crasher
 *  l'instance le 2026-07-22. */
export async function runEnrichmentAgentThrottled(supabase: SupabaseClient, input: EnrichmentInput): Promise<EnrichmentProfile | null> {
  const slotId = await acquireSlot(supabase);
  try {
    return await runEnrichmentAgent(input);
  } finally {
    await releaseSlot(supabase, slotId);
  }
}
