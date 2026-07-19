/**
 * enrich-contact v2 — Pipeline 2-phases avec désambiguïsation homonymes
 *
 * Phase 1 (parallèle DB) : Recherche l'organisation via le domaine email
 * Phase 2 (séquentielle)  : Recherche la personne avec ancre domaine + anti-homonymes
 * LLM Gemini              : Profil cognitif enrichi du contexte web
 *
 * RGPD-safe: métadonnées uniquement, jamais le contenu des emails.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'google/gemini-2.5-flash-lite';
const PERPLEXITY_API = 'https://api.perplexity.ai/chat/completions';
const PERPLEXITY_MODEL = 'sonar-pro';

// ── Name parsing ──────────────────────────────────────────────────────────────

const FR_PARTICLES = new Set(['de','du','des','le','la','les','van','von','au','aux','el','al','da','di','dos','das']);

function capitalizeToken(w: string, isFirst: boolean): string {
  const l = w.toLowerCase();
  if (!isFirst && FR_PARTICLES.has(l)) return l;
  return l.charAt(0).toUpperCase() + l.slice(1);
}

/** Nettoie les artefacts générés par la découverte mail (ex: "Ambre Perrochaud Via LinkedIn") */
function cleanContactName(raw: string): string {
  return raw
    .replace(/\s+via\s+[\w\s]{2,30}$/gi, '')    // "Via LinkedIn", "Via Gmail"…
    .replace(/\s*\(via\s+[^)]+\)/gi, '')          // "(via Outlook)"
    .replace(/\s*\[[^\]]*\]/g, '')                 // "[external]"
    .replace(/\s*\([^)]{0,40}\)/g, '')             // "(info)"
    .replace(/^(mr\.?\s+|mme\.?\s+|dr\.?\s+|m\.\s+)/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "liam.desousatoudret" → "Liam De Sousa Toudret" */
function parseHumanName(raw: string): string {
  const cleaned = cleanContactName(raw);
  if (cleaned.includes(' ')) return cleaned;
  const tokens = cleaned.split(/[._-]+/).filter(Boolean);
  if (tokens.length === 1) return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return tokens.map((t, i) => capitalizeToken(t, i === 0)).join(' ');
}

// ── Domain analysis ───────────────────────────────────────────────────────────

const PERSONAL_DOMAINS = new Set([
  'gmail.com','hotmail.com','outlook.com','yahoo.com','yahoo.fr',
  'icloud.com','me.com','live.com','live.fr','laposte.net',
  'orange.fr','free.fr','sfr.fr','wanadoo.fr','protonmail.com','pm.me',
]);

const DOMAIN_TLDS = new Set(['com','fr','org','net','edu','io','co','uk','de','es','it','be','ch','ca','au','app','ai']);

const EDU_PATTERNS = [
  'lycee','ecole','univ','iut','ens','sup','college','academie',
  'institut','school','edu','campus','formation','limayrac','cesi',
  'epita','epitech','efrei','insa','isep','hec','polytechnique',
];

type DomainType = 'personal' | 'edu' | 'startup' | 'company_fr' | 'company_intl';

interface DomainAnalysis {
  domain: string;
  username: string;
  orgName: string;
  domainType: DomainType;
  isEdu: boolean;
}

function analyzeDomain(email: string): DomainAnalysis {
  const atIdx = email.indexOf('@');
  const username = atIdx > 0 ? email.slice(0, atIdx) : email;
  const domain = atIdx > 0 ? email.slice(atIdx + 1).toLowerCase() : '';

  if (!domain || PERSONAL_DOMAINS.has(domain)) {
    return { domain, username, orgName: '', domainType: 'personal', isEdu: false };
  }

  const parts = domain.split('.');
  const tld = parts[parts.length - 1] ?? '';
  const significant = parts.filter(p => !DOMAIN_TLDS.has(p));
  const orgName = significant.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');

  const isEdu = tld === 'edu' || parts.some(p => EDU_PATTERNS.some(kw => p.includes(kw)));
  if (isEdu) return { domain, username, orgName, domainType: 'edu', isEdu: true };

  if (['io','ai','app'].includes(tld)) return { domain, username, orgName, domainType: 'startup', isEdu: false };
  if (tld === 'fr') return { domain, username, orgName, domainType: 'company_fr', isEdu: false };
  return { domain, username, orgName, domainType: 'company_intl', isEdu: false };
}

interface SearchCtx {
  displayName: string;
  organization: string;
  analysis: DomainAnalysis;
}

function buildSearchCtx(rawName: string, email: string, companyName: string | null): SearchCtx {
  const displayName = parseHumanName(rawName);
  const analysis = analyzeDomain(email);
  const organization = companyName || analysis.orgName;
  return { displayName, organization, analysis };
}

// ── Perplexity helper ─────────────────────────────────────────────────────────

async function perplexityCall(userContent: string, maxTokens: number): Promise<string | null> {
  const key = Deno.env.get('PERPLEXITY_API_KEY');
  if (!key) return null;
  try {
    const res = await fetch(PERPLEXITY_API, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: PERPLEXITY_MODEL,
        messages: [
          {
            role: 'system',
            content: `Tu es un investigateur professionnel expert en OSINT et recherche de profils B2B.
RÈGLES ABSOLUES :
1. Ne retourne QUE des informations vérifiées avec sources URL citées.
2. Si une information n'est pas trouvée, écris explicitement "Non trouvé" — jamais d'invention.
3. Fournis des données PRÉCISES et ACTIONNABLES : noms exacts, URLs LinkedIn, titres de poste, dates, chiffres.
4. Effectue plusieurs requêtes de recherche avec différentes formulations pour maximiser les résultats.
5. Priorise les sources primaires : site officiel, LinkedIn, registres d'entreprises, presse économique.
6. Pour les entreprises françaises : pappers.fr, societe.com, infogreffe.fr sont OBLIGATOIRES.
7. Pour les startups : crunchbase.com, wellfound.com, maddyness.com, lesechos.fr.
Texte brut structuré, pas de markdown superflu.`,
          },
          { role: 'user', content: userContent },
        ],
        max_tokens: maxTokens,
        temperature: 0.1,
        search_recency_filter: 'month',
      }),
    });
    if (!res.ok) {
      console.error('Perplexity error:', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const content: string = data.choices?.[0]?.message?.content ?? '';
    if (!content || content.trim().length < 40) return null;
    return content.trim();
  } catch (e) {
    console.error('Perplexity call error:', e);
    return null;
  }
}

// ── Phase 1a : Organisation research (parallel with DB queries) ───────────────

async function researchOrganization(analysis: DomainAnalysis): Promise<string | null> {
  if (analysis.domainType === 'personal' || !analysis.orgName) return null;

  // Domaines appartenant à des géants tech → les contacts sont probablement UTILISATEURS pas employés
  const MEGACORP_DOMAINS = new Set(['linkedin.com','google.com','microsoft.com','apple.com','amazon.com','meta.com','facebook.com','twitter.com','x.com']);
  if (MEGACORP_DOMAINS.has(analysis.domain)) {
    // Retourne infos générales sur l'entreprise sans longue recherche
    return `NOM_OFFICIEL: ${analysis.orgName}\nTYPE: Grande entreprise technologique internationale\nNOTE: Contact probablement utilisateur/partenaire de la plateforme, pas forcément employé.`;
  }

  let registryHint: string;
  if (analysis.domainType === 'company_fr') {
    registryHint = `SOURCES OBLIGATOIRES (dans l'ordre) :
1. pappers.fr — cherche "${analysis.orgName}" : SIREN, forme juridique, capital, dirigeants inscrits (noms + rôles exacts), date création, adresse siège
2. societe.com — confirme les dirigeants et l'objet social
3. infogreffe.fr — informations légales complémentaires
4. linkedin.com/company/${analysis.domain.split('.')[0]} — page LinkedIn de l'entreprise
5. ${analysis.domain} — site officiel, page "Équipe" ou "À propos"`;
  } else if (analysis.domainType === 'startup') {
    registryHint = `SOURCES OBLIGATOIRES (dans l'ordre) :
1. crunchbase.com — cherche "${analysis.orgName}" : fondateurs, montants levées, investisseurs, stade
2. wellfound.com (ex AngelList) — profil startup
3. ${analysis.domain}/about et ${analysis.domain}/team — équipe fondatrice
4. maddyness.com ou lesechos.fr — articles de presse sur la startup
5. linkedin.com/company — page LinkedIn, nombre d'employés actuels`;
  } else if (analysis.domainType === 'edu') {
    registryHint = `SOURCES :
1. ${analysis.domain} — type d'établissement, localisation, programmes, corps enseignant
2. Wikipedia — historique, accréditations, classements
3. LinkedIn — page établissement, anciens élèves notables`;
  } else {
    registryHint = `SOURCES (dans l'ordre) :
1. ${analysis.domain} — site officiel, pages "Équipe", "Leadership", "À propos"
2. linkedin.com/company — taille, secteur, employés
3. Registres d'entreprise locaux selon le pays
4. Presse économique — actualités récentes`;
  }

  return perplexityCall(`Recherche COMPLÈTE sur l'organisation "${analysis.orgName}" (domaine : ${analysis.domain}).

${registryHint}

FORMAT DE RÉPONSE OBLIGATOIRE :

NOM_OFFICIEL: [Raison sociale exacte ou "Non trouvé"]
TYPE: [SAS / SARL / SA / startup / école / association / etc.]
SECTEUR: [Secteur d'activité précis]
ACTIVITE: [Description de l'activité principale en 1-2 phrases]
LOCALISATION: [Ville, Pays — adresse complète si possible]
SIREN: [Numéro SIREN si entreprise française, sinon "N/A"]
CREATION: [Année de création]
EFFECTIFS: [Fourchette d'effectifs]
CA: [Chiffre d'affaires ou valorisation si startup — "Non public" si inconnu]
DIRIGEANTS:
- [Prénom Nom] | [Titre exact : CEO, PDG, DG, Fondateur…] | depuis [année si connu]
- [répéter pour chaque dirigeant principal]
ACTUALITES_RECENTES: [Levées, acquisitions, partenariats, nouveaux produits des 12 derniers mois]
SOURCES: [URLs des pages consultées]

Pour chaque champ introuvable, écrire "Non trouvé" — jamais de données inventées.`, 600);
}

// ── Phase 1b : LinkedIn deep dive (parallel with org research + DB queries) ───

async function researchLinkedIn(ctx: SearchCtx, role: string, email: string): Promise<string | null> {
  const { displayName, organization, analysis } = ctx;

  // Email personnel sans organisation connue → on cherche quand même via le prénom/nom
  const username = analysis.username; // partie avant @email
  const nameParts = displayName.split(' ').filter(Boolean);
  const firstName = nameParts[0] ?? '';
  const lastName = nameParts.slice(1).join(' ');

  // Construire toutes les variantes URL LinkedIn à tester
  const slugVariants = [
    `${firstName.toLowerCase()}-${lastName.toLowerCase().replace(/\s+/g, '-')}`,
    `${firstName.toLowerCase()}${lastName.toLowerCase().replace(/\s+/g, '')}`,
    `${lastName.toLowerCase()}-${firstName.toLowerCase()}`,
    username.toLowerCase().replace(/[._]/g, '-'),
  ].filter((v, i, a) => v.length > 2 && a.indexOf(v) === i);

  const orgAnchor = organization
    ? `actuellement ou récemment affilié(e) à "${organization}" (domaine email : ${analysis.domain})`
    : (role ? `avec le rôle "${role}"` : '');

  const disambiguationRule = organization
    ? `⚠️ DÉSAMBIGUÏSATION STRICTE :
Il peut exister plusieurs "${displayName}" sur LinkedIn. La SEULE personne qui nous intéresse est celle liée à "${organization}" / ${analysis.domain}.
Ignore ABSOLUMENT tous les homonymes sans lien avec cette organisation.
L'email ${email} PROUVE l'appartenance à ${analysis.domain}.`
    : `Cherche la personne qui correspond le mieux au profil : ${role || 'professionnel(le)'}.`;

  return perplexityCall(`MISSION : Trouver et analyser le profil LinkedIn de "${displayName}" ${orgAnchor}.
Email professionnel : ${email}${role ? `\nRôle connu : ${role}` : ''}

${disambiguationRule}

STRATÉGIE DE RECHERCHE (effectue TOUTES ces requêtes) :
1. Accède directement aux URLs LinkedIn :${slugVariants.map(s => `\n   - linkedin.com/in/${s}`).join('')}
2. Recherche Google : "${displayName}" site:linkedin.com${organization ? ` "${organization}"` : ''}
3. Recherche Google : "${displayName}" "${organization || analysis.domain}" LinkedIn profil
4. Recherche : "${firstName} ${lastName}" ${organization ? `"${organization}"` : ''} LinkedIn poste "${role || ''}"
5. Si profil trouvé : lis INTÉGRALEMENT la section À propos, le parcours, les posts récents

FORMAT DE RÉPONSE OBLIGATOIRE (respecte exactement ces labels) :

LINKEDIN_URL: [URL complète https://linkedin.com/in/... OU "Non trouvé après 5 tentatives"]
LINKEDIN_HEADLINE: [Titre professionnel exact affiché sur le profil]
POSTE_ACTUEL: [Titre exact du poste] | [Entreprise] | depuis [mois/année]
PARCOURS_PRO:
- [Titre] | [Entreprise] | [date début] → [date fin ou "présent"] | [durée] | [missions clés si visibles]
FORMATION:
- [Diplôme] | [École] | [années]
COMPETENCES_CLES: [Top 5-10 compétences endorsées]
A_PROPOS: [Texte complet de la section About si visible]
POSTS_RECENTS:
- [Sujet du post] | [Ton : analytique/inspirationnel/sectoriel/commercial] | [engagement : nb likes/comments]
FREQUENCE_PUBLICATION: [Fréquence estimée : quotidien/hebdo/mensuel/rare/inactif]
CONNEXIONS: [Nb de connexions si visible : 500+, 1000+, etc.]
CERTIFICATIONS: [Certifications professionnelles listées]
LANGUES: [Langues mentionnées sur le profil]

Si LINKEDIN_URL est "Non trouvé", indique malgré tout toutes les données trouvées ailleurs (autres réseaux, site perso, interviews).`, 900);
}

// ── Phase 1c : Recherche complémentaire — présence web globale ────────────────

async function researchWebPresence(ctx: SearchCtx, role: string, email: string): Promise<string | null> {
  const { displayName, organization, analysis } = ctx;
  if (analysis.domainType === 'personal' && !organization && !role) return null;

  const orgCtx = organization || 'leur secteur';

  return perplexityCall(`Recherche la présence web et les traces professionnelles de "${displayName}"${organization ? ` (${organization})` : ''}.
Email : ${email}${role ? `\nRôle : ${role}` : ''}

SOURCES À CONSULTER :
1. ${analysis.domain !== '' ? `Site officiel ${analysis.domain} — pages équipe, about, blog` : ''}
2. Presse économique : Les Echos, BFM Business, Le Monde, TechCrunch, Maddyness, Forbes
3. Interviews, podcasts, conférences (recherche "${displayName}" ${orgCtx} interview OR conférence)
4. GitHub si profil tech : github.com/${analysis.username}
5. Twitter/X : @${analysis.username} ou "${displayName}" twitter
6. Publications, articles de blog, tribunes

RETOURNE :
PRESSE: [Articles mentionnant cette personne — titre, source, date, URL]
INTERVIEWS: [Podcasts, vidéos, conférences — sujet, date, URL]
RESEAUX_SOCIAUX: [Twitter/X, GitHub, autres — handles et activité]
CITATIONS_NOTABLES: [Citations directes trouvées en ligne]
PROJETS_PUBLICS: [Projets, publications, travaux visibles en ligne]

Si rien trouvé : "Aucune trace publique trouvée."`, 500);
}

// ── Phase 2 : Person research with disambiguation ─────────────────────────────

async function researchPerson(
  ctx: SearchCtx,
  role: string,
  email: string,
  orgInfo: string | null,
): Promise<string | null> {
  const { displayName, organization, analysis } = ctx;
  const orgCtx = organization || 'leur organisation';
  const orgInfoSection = orgInfo ? `\n\nINFOS ORGANISATION (déjà confirmées) :\n${orgInfo}` : '';

  let prompt: string;

  const nameParts = displayName.split(' ').filter(Boolean);
  const firstName = nameParts[0] ?? '';
  const lastName = nameParts.slice(1).join(' ');

  if (analysis.domainType === 'personal') {
    prompt = `RECHERCHE PROFESSIONNELLE — "${displayName}"
Email personnel : ${email}${role ? `\nRôle connu : ${role}` : ''}
${orgInfoSection}

STRATÉGIE :
1. Cherche "${displayName}" linkedin.com + "${role || ''}"
2. Cherche "${displayName}" ${role ? `"${role}"` : ''} interview OR conférence OR article
3. Cherche "${firstName} ${lastName}" ${role ? `"${role}"` : ''} entreprise
4. Cherche sur GitHub, Twitter, blog perso

FORMAT RÉPONSE :
NOM_CONFIRME: [Nom complet exact trouvé]
TITRE_ACTUEL: [Poste actuel]
EMPLOYEUR_ACTUEL: [Entreprise actuelle]
PARCOURS_RECENT: [2-3 dernières expériences]
LINKEDIN_URL: [URL ou "Non trouvé"]
SPECIALITES: [Domaines d'expertise]
SOURCES: [URLs]

Si rien trouvé : AUCUN_RÉSULTAT_CONFIRMÉ : profil sans présence web publique détectable`;

  } else if (analysis.domainType === 'edu') {
    prompt = `RECHERCHE CIBLÉE — "${displayName}" à ${orgCtx} (${analysis.domain})
Email institutionnel confirmé : ${email} → affiliation certaine.${orgInfoSection}

STRATÉGIE (effectue toutes ces recherches) :
1. Annuaire ${analysis.domain}/annuaire, /equipe, /enseignants, /chercheurs
2. Publications : scholar.google.com "${displayName}", researchgate.net
3. LinkedIn : "${displayName}" "${orgCtx}"
4. "${firstName} ${lastName}" ${orgCtx} site:${analysis.domain}

FORMAT RÉPONSE :
NOM_CONFIRME: [Nom complet exact]
ROLE_INSTITUTIONNEL: [Statut exact : Professeur / Maître de conf / Chercheur / Étudiant / Personnel / etc.]
DEPARTEMENT: [Département ou laboratoire]
SPECIALITE: [Domaine de spécialité]
PUBLICATIONS: [Travaux ou thèses notables]
LINKEDIN_URL: [URL ou "Non trouvé"]
SOURCES: [URLs]`;

  } else {
    let registrySearch: string;
    if (analysis.domainType === 'company_fr') {
      registrySearch = `REGISTRES LÉGAUX (OBLIGATOIRES) :
a. pappers.fr — recherche "${displayName}" : est-il dirigeant, associé, président, gérant inscrit ?
b. societe.com — confirmation du rôle légal
c. infogreffe.fr — extrait Kbis, liste des mandataires
d. ${analysis.domain}/equipe, /leadership, /about — page officielle de l'entreprise

PRESSE ET RÉSEAUX :
e. "${displayName}" "${orgCtx}" Les Echos OR BFM Business OR La Tribune OR Le Monde
f. LinkedIn filtre entreprise "${orgCtx}" + nom "${displayName}"
g. "${displayName}" "${orgCtx}" interview OR conférence`;
    } else if (analysis.domainType === 'startup') {
      registrySearch = `SOURCES STARTUP (dans l'ordre) :
a. crunchbase.com/person/${analysis.username} et recherche "${displayName}" ${orgCtx}
b. wellfound.com — profil fondateur/équipe
c. ${analysis.domain}/about, /team, /founders, /leadership
d. maddyness.com, frenchweb.fr, lesechos.fr, lefigaro.fr — articles sur ${orgCtx} + "${displayName}"
e. LinkedIn "${displayName}" "${orgCtx}"
f. ProductHunt, GitHub, Twitter — pour profils tech`;
    } else {
      registrySearch = `SOURCES :
a. ${analysis.domain}/equipe, /about, /contact
b. LinkedIn "${displayName}" "${orgCtx}"
c. Presse : "${displayName}" "${orgCtx}" OR "${analysis.domain}"
d. Registres d'entreprise locaux`;
    }

    prompt = `TÂCHE DE DÉSAMBIGUÏSATION STRICTE ET EXHAUSTIVE

CIBLE : "${displayName}" — affilié(e) à "${orgCtx}" (domaine email : ${analysis.domain})
${role ? `Rôle connu : ${role}` : ''}
Email professionnel : ${email} (PREUVE d'appartenance à ${analysis.domain})${orgInfoSection}

⚠️ RÈGLE ABSOLUE ANTI-HOMONYMES :
Il PEUT exister plusieurs "${displayName}" sur internet.
La SEULE personne qui nous intéresse est celle PROUVABLEMENT liée à ${orgCtx} / ${analysis.domain}.
IGNORE tout résultat concernant un homonyme sans lien avec ${orgCtx}.
Si tu n'es pas certain à 100% que le résultat concerne la bonne personne → ne le retourne PAS.

STRATÉGIE DE RECHERCHE :
${registrySearch}

FORMAT DE RÉPONSE OBLIGATOIRE :

IDENTITE_CONFIRMEE: [Nom complet exact + source de confirmation]
PREUVE_AFFILIATION: [Comment tu as confirmé le lien avec ${orgCtx} : page équipe URL, registre, article…]
ROLE_EXACT: [Titre de poste exact + département + date de prise de poste si trouvé]
ANCIENNETE: [Depuis quand dans l'organisation]
PARCOURS_ANTERIEUR:
- [Poste] | [Entreprise] | [période] | [contexte]
FORMATION: [Diplômes, écoles — si trouvés]
PROFIL_ACTIONNABLE: [3 phrases synthétisant qui est cette personne, son background, ses enjeux professionnels]
RESEAUX_CONFIRMES: [LinkedIn URL, Twitter, GitHub — uniquement si confirmés pour CETTE personne]
SOURCES_EXACTES: [URLs complètes utilisées pour chaque information]

Si aucun résultat confirmé : AUCUN_RÉSULTAT_CONFIRMÉ : [raison précise]`;
  }

  const result = await perplexityCall(prompt, 900);
  if (!result) return null;
  if (result.startsWith('AUCUN_RÉSULTAT_CONFIRMÉ')) return null;
  return result;
}

// ── Scoring constants ─────────────────────────────────────────────────────────
const DIM_WEIGHTS = { intensite: 0.40, reciprocite: 0.35, longevite: 0.25 };
const PHASE_DELTA = 8.0;
const HONEYMOON_DAYS = 45;

function clamp(v: number, min = 0, max = 1) { return Math.max(min, Math.min(max, v)); }

function temporalDecay(days: number, depth: number): number {
  const hl = 30 + depth * 150;
  return Math.exp(-(Math.LN2 / hl) * days);
}

function scoreIntensite(s: Stats): number {
  const ef = clamp(s.emailsLast30 / 4);
  const efCapped = (s.initiationRatio > 0.85 || s.initiationRatio < 0.15) ? Math.min(ef, 0.50) : ef;
  const mf = clamp((s.meetingsLast90 / 90) / (1 / 30));
  const richness = s.channelCount >= 3 ? 1.0 : s.channelCount === 2 ? 0.65 : 0.25;
  const depth = clamp(s.avgThreadDepth / 5);
  return efCapped * 0.40 + mf * 0.35 + richness * 0.15 + depth * 0.10;
}

function scoreReciprocite(s: Stats): number {
  const asym = Math.abs(s.initiationRatio - 0.5) * 2;
  const init = Math.max(0.40, 1 - asym * 0.60);
  return init * 0.50 + clamp(s.responseRate) * 0.30 + clamp(s.responseTimeRatio / 2) * 0.20;
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
      consistency = Math.max(0, 1 - Math.sqrt(variance) / mean / 2);
    }
  }
  const qMeetings = s.quartersWithMeetings / 4;
  return { score: (ageScore * 0.45 + consistency * 0.35 + qMeetings * 0.20) * factor, factor };
}

interface Stats {
  emailsLast30: number; meetingsLast90: number; avgThreadDepth: number;
  channelCount: number; initiationRatio: number; responseRate: number;
  responseTimeRatio: number; ageInDays: number; daysSinceLast: number;
  monthlyExchangeCounts: number[]; quartersWithMeetings: number;
  totalInteractions: number; avgResponseHours: number;
}

function buildStats(msgs: any[], meets: any[], firstSeen: string | null): Stats {
  const now = Date.now();
  const cut30 = now - 30 * 86400000;
  const cut90 = now - 90 * 86400000;

  const out = msgs.filter(m => m.direction === 'outbound').length;
  const total = msgs.length || 1;
  const initiationRatio = out / total;
  const inbound = msgs.filter(m => m.direction === 'inbound').length;
  const responseRate = total > 1 ? clamp((Math.min(inbound, out) * 2) / total) : 0.3;

  const rts = msgs.filter(m => (m.metadata as any)?.response_time_hours != null)
    .map(m => (m.metadata as any).response_time_hours as number);
  const avgResponseHours = rts.length ? rts.reduce((a, b) => a + b, 0) / rts.length : 24;
  const responseTimeRatio = clamp(24 / Math.max(avgResponseHours, 1), 0, 4) / 4;

  const threadMap = new Map<string, number>();
  for (const m of msgs) { if (m.thread_id) threadMap.set(m.thread_id, (threadMap.get(m.thread_id) || 0) + 1); }
  const avgThreadDepth = threadMap.size ? Array.from(threadMap.values()).reduce((a, b) => a + b, 0) / threadMap.size : 1;

  const ageInDays = firstSeen
    ? Math.round((now - new Date(firstSeen).getTime()) / 86400000)
    : msgs.length > 0 ? Math.round((now - new Date(msgs[msgs.length - 1].sent_at).getTime()) / 86400000) : 0;

  const allDates = [
    ...msgs.map(m => m.sent_at ? new Date(m.sent_at).getTime() : 0),
    ...meets.map(m => m.starts_at ? new Date(m.starts_at).getTime() : 0),
  ].filter(Boolean);
  const daysSinceLast = allDates.length ? Math.round((now - Math.max(...allDates)) / 86400000) : 999;

  const monthlyExchangeCounts = Array.from({ length: 6 }, (_, i) => {
    const start = now - (i + 1) * 30 * 86400000;
    const end = now - i * 30 * 86400000;
    return msgs.filter(m => { const t = m.sent_at ? new Date(m.sent_at).getTime() : 0; return t > start && t <= end; }).length;
  });

  const quartersWithMeetings = [0, 1, 2, 3].filter(q => {
    const start = now - (q + 1) * 90 * 86400000;
    const end = now - q * 90 * 86400000;
    return meets.some(m => { const t = m.starts_at ? new Date(m.starts_at).getTime() : 0; return t > start && t <= end; });
  }).length;

  return {
    emailsLast30: msgs.filter(m => m.sent_at && new Date(m.sent_at).getTime() > cut30).length,
    meetingsLast90: meets.filter(m => m.starts_at && new Date(m.starts_at).getTime() > cut90).length,
    avgThreadDepth, channelCount: (msgs.length > 0 ? 1 : 0) + (meets.length > 0 ? 1 : 0),
    initiationRatio, responseRate, responseTimeRatio,
    ageInDays, daysSinceLast, monthlyExchangeCounts, quartersWithMeetings,
    totalInteractions: msgs.length + meets.length * 4,
    avgResponseHours,
  };
}

function computeScore(s: Stats, prevScore?: number): {
  score: number; phase: 'growth' | 'stagnant' | 'decline'; delta: number;
  si: number; sr: number; sl: number;
} {
  const si = scoreIntensite(s);
  const sr = scoreReciprocite(s);
  const { score: sl, factor } = scoreLongevite(s);

  const weights = factor < 1
    ? { intensite: DIM_WEIGHTS.intensite + DIM_WEIGHTS.longevite * (1 - factor) * 0.54,
        reciprocite: DIM_WEIGHTS.reciprocite + DIM_WEIGHTS.longevite * (1 - factor) * 0.46,
        longevite: DIM_WEIGHTS.longevite * factor }
    : DIM_WEIGHTS;

  const raw = si * weights.intensite + sr * weights.reciprocite + sl * weights.longevite;
  const smoothed = s.ageInDays < HONEYMOON_DAYS
    ? Math.min(raw, 0.45 + (s.ageInDays / HONEYMOON_DAYS) * 0.20)
    : raw;
  const depth = clamp(s.totalInteractions / 500);
  const decayed = clamp(smoothed * temporalDecay(s.daysSinceLast, depth));
  // Floor : si des échanges ont eu lieu, le score ne peut pas tomber à 0
  const floor = s.totalInteractions > 0 ? Math.round(raw * 0.05 * 100) : 0;
  const final = Math.max(floor, Math.round(decayed * 100));

  const prev = prevScore ?? final;
  const delta = final - prev;
  const phase: 'growth' | 'stagnant' | 'decline' =
    delta >= PHASE_DELTA ? 'growth'
    : delta <= -PHASE_DELTA && final <= 70 ? 'decline'
    : 'stagnant';

  return { score: final, phase, delta, si: Math.round(si * 100), sr: Math.round(sr * 100), sl: Math.round(sl * 100) };
}

// ── LLM system prompt ─────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es le moteur d'intelligence cognitive de Knowr.
À partir de données comportementales (métadonnées uniquement — RGPD-safe, jamais le contenu des emails),
tu génères des profils cognitifs précis, actionnables et scientifiquement fondés.

RÈGLES ABSOLUES :
1. Zéro hallucination. Si une donnée n'est pas déductible → inference_level "unavailable" ou "hypothetical". Jamais inventé.
2. Niveaux d'inférence : "observable" > "inferred" > "hypothetical" > "unavailable"
3. Les JTBD viennent du rôle + secteur + patterns comportementaux.
4. Les axes interactionnels viennent des patterns de communication.

FRAMEWORKS :
- Kahneman S1/S2 : temps de réponse rapide + emails courts → S1 dominant
- JTBD Christensen : fonctionnel / social / émotionnel
- Cialdini : signaux d'influence détectables depuis les patterns
- Gilbert & Karahalios : force du lien = intensité + réciprocité + longévité

RÉPONDS UNIQUEMENT EN JSON STRICT selon le schéma fourni. Aucun texte avant ou après.`;

function buildLLMContext(contact: any, stats: Stats, scoring: ReturnType<typeof computeScore>, subjects: string[]): string {
  const channelLabel = stats.channelCount >= 2 ? 'Email + Réunions' : stats.channelCount === 1 ? 'Email seulement' : 'Aucun échange';
  const freqLabel = stats.emailsLast30 === 0 ? 'Aucun email récent'
    : stats.emailsLast30 <= 2 ? 'Faible fréquence (1-2/mois)'
    : stats.emailsLast30 <= 8 ? 'Fréquence modérée (3-8/mois)'
    : 'Haute fréquence (9+/mois)';
  const responseLabel = stats.avgResponseHours <= 2 ? 'Très rapide (<2h)'
    : stats.avgResponseHours <= 8 ? 'Rapide (<8h)'
    : stats.avgResponseHours <= 24 ? 'Dans la journée'
    : stats.avgResponseHours <= 72 ? 'En quelques jours'
    : 'Lent (>3 jours)';
  const initiationLabel = stats.initiationRatio > 0.7 ? "L'utilisateur initie massivement (>70%)"
    : stats.initiationRatio > 0.5 ? "L'utilisateur initie légèrement plus"
    : stats.initiationRatio > 0.3 ? 'Initiation équilibrée'
    : 'Le contact initie massivement';

  return JSON.stringify({
    contact: {
      nom: contact.full_name,
      role: contact.role_title ?? 'Rôle inconnu',
      entreprise: contact.company_name ?? 'Organisation inconnue',
      email: contact.email ?? null,
      anciennete_relation_jours: stats.ageInDays,
    },
    signaux_comportementaux: {
      emails_last_30j: stats.emailsLast30,
      reunions_last_90j: stats.meetingsLast90,
      profondeur_thread_moy: Math.round(stats.avgThreadDepth * 10) / 10,
      canaux: channelLabel, frequence: freqLabel,
      temps_reponse_moy: responseLabel, initiation: initiationLabel,
      taux_reponse_pct: Math.round(stats.responseRate * 100),
      jours_sans_contact: stats.daysSinceLast,
    },
    scoring_relationnel: {
      score_engagement: scoring.score,
      phase: scoring.phase === 'growth' ? 'Développement' : scoring.phase === 'decline' ? 'Déclin' : 'Stable',
      delta_30j: scoring.delta,
      dimension_intensite: scoring.si,
      dimension_reciprocite: scoring.sr,
      dimension_longevite: scoring.sl,
    },
    sujets_emails_observes: subjects.slice(0, 10),
  }, null, 0);
}

const LLM_SCHEMA = `{
  "executive_summary": "<2-3 phrases résumant la relation et le profil. Concret, actionnable.>",
  "cognitive_mode": "s1_dominant|s2_dominant|contextual|unavailable",
  "cognitive_mode_confidence": 0.0,
  "cognitive_mode_signals": ["<signal observable>"],
  "interaction_modes_primary": ["Operator|Validator|Strategist|Challenger|Consensus Builder|Explorer"],
  "interaction_axes": {
    "relation_result": { "value": 0, "inference_level": "observable|inferred|hypothetical|unavailable", "confidence": 0, "signal": "<signal>" },
    "intuition_structure": { "value": 0, "inference_level": "...", "confidence": 0, "signal": "<signal>" },
    "caution_speed": { "value": 0, "inference_level": "...", "confidence": 0, "signal": "<signal>" },
    "consensus_control": { "value": 0, "inference_level": "...", "confidence": 0, "signal": "<signal>" }
  },
  "behavioral_signals": [
    { "signal_type": "communication_style|decision_speed|initiation_pattern|channel_preference|response_pattern",
      "text": "<signal observable précis>", "inference": "<ce que ça signifie>",
      "inference_level": "observable|inferred|hypothetical", "confidence": 0 }
  ],
  "jtbd_data": {
    "functional_job": { "text": "<job fonctionnel>", "confidence": 0.0, "pitch_angle": "<angle d'approche>" },
    "social_job":     { "text": "<job social>",     "confidence": 0.0, "pitch_angle": "<angle d'approche>" },
    "emotional_job":  { "text": "<job émotionnel>", "confidence": 0.0, "pitch_angle": "<angle d'approche>" },
    "qualify_question": "<question de qualification JTBD>"
  },
  "theory_of_mind": {
    "perceived_positioning": "<comment ce contact nous perçoit probablement>",
    "likely_skepticism": "<zone de scepticisme probable>",
    "credibility_gaps": "<lacunes de crédibilité à combler>",
    "confidence": 0.0
  }
}`;

// ── Main handler ──────────────────────────────────────────────────────────────
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
  const { contactId, organizationId, forceRefresh = false } = body;
  if (!contactId || !organizationId) return jsonResponse({ error: 'contactId and organizationId required' }, 400);

  // ── 1. Load contact ───────────────────────────────────────────────────────
  const { data: contact, error: contactErr } = await supabase
    .from('contacts')
    .select('id, full_name, email, role_title, created_at, enrichment_status, last_enriched_at, companies(name, domain)')
    .eq('id', contactId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (contactErr || !contact) return jsonResponse({ error: 'Contact not found', detail: contactErr?.message }, 404);

  const companyName = (contact.companies as any)?.name ?? null;

  // Build search context (parse name, classify domain)
  const searchCtx = buildSearchCtx(
    contact.full_name ?? '',
    contact.email ?? '',
    companyName,
  );

  const contactWithCompany = {
    ...contact,
    company_name: searchCtx.organization || companyName,
    full_name: searchCtx.displayName, // human-readable name for LLM
  };

  // Skip if recently enriched (< 7 days) and not forced
  if (!forceRefresh && contact.enrichment_status === 'done' && contact.last_enriched_at) {
    const age = Date.now() - new Date(contact.last_enriched_at).getTime();
    if (age < 7 * 86400000) return jsonResponse({ status: 'cached', contactId });
  }

  // ── 2. Mark as running ────────────────────────────────────────────────────
  await supabase.from('contacts')
    .update({ enrichment_status: 'running', enrichment_error: null })
    .eq('id', contactId);

  try {
    // ── 3. Phase 1a/1b/1c (Perplexity) + DB queries — TOUT EN PARALLÈLE ────────
    // sonar-pro effectue plusieurs requêtes web → résultats en ~5-8s — overlap avec DB
    const [
      { data: messages },
      { data: meetingParts },
      orgInfo,
      linkedinData,
      webPresenceData,
    ] = await Promise.all([
      supabase.from('communication_messages')
        .select('direction, sent_at, thread_id, metadata, subject')
        .eq('organization_id', organizationId)
        .eq('contact_id', contactId)
        .order('sent_at', { ascending: false })
        .limit(300),
      supabase.from('meeting_participants')
        .select('meetings(id, starts_at, title, actual_duration_minutes)')
        .eq('organization_id', organizationId)
        .eq('contact_id', contactId),
      // Phase 1a : organisation research
      researchOrganization(searchCtx.analysis),
      // Phase 1b : LinkedIn deep dive
      researchLinkedIn(searchCtx, contact.role_title ?? '', contact.email ?? ''),
      // Phase 1c : présence web globale (presse, réseaux, publications)
      researchWebPresence(searchCtx, contact.role_title ?? '', contact.email ?? ''),
    ]);

    const msgs = messages ?? [];
    const meets = (meetingParts ?? []).map((p: any) => p.meetings).filter(Boolean).flat();

    // ── 4. Phase 2 : Désambiguïsation personne avec tout le contexte accumulé ──
    const allWebContext = [orgInfo, linkedinData, webPresenceData].filter(Boolean).join('\n\n---\n\n') || null;
    const personBio = await researchPerson(
      searchCtx,
      contact.role_title ?? '',
      contact.email ?? '',
      allWebContext,
    );

    // Combine toutes les sources en un web_bio structuré (4 sections max)
    const webBio = [
      orgInfo         ? `=== ORGANISATION ===\n${orgInfo}`              : null,
      linkedinData    ? `=== PROFIL LINKEDIN ===\n${linkedinData}`      : null,
      webPresenceData ? `=== PRÉSENCE WEB ===\n${webPresenceData}`      : null,
      personBio       ? `=== PROFIL PROFESSIONNEL ===\n${personBio}`    : null,
    ].filter(Boolean).join('\n\n');

    if (webBio) await supabase.from('contacts').update({ web_bio: webBio }).eq('id', contactId);

    // ── 5. Compute behavioral stats + scoring ─────────────────────────────────
    const stats = buildStats(msgs, meets, contact.created_at);

    const { data: prevSnap } = await supabase
      .from('contact_score_history')
      .select('score')
      .eq('contact_id', contactId)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    const scoring = computeScore(stats, prevSnap?.score);

    const subjects = [...new Set(
      msgs.map(m => m.subject).filter(s => s && s.length > 3 && !s.startsWith('Re:') && !s.startsWith('Fwd:'))
    )].slice(0, 15) as string[];

    // ── 6. Call Gemini with full context ──────────────────────────────────────
    const orgCtx = searchCtx.organization || companyName || '—';

    // Sections contexte web structurées pour le LLM
    const sourcesCount = [orgInfo, linkedinData, webPresenceData, personBio].filter(Boolean).length;
    const webContextSection = webBio ? `

=== DONNÉES WEB ENRICHIES (Perplexity sonar-pro — ${sourcesCount} sources croisées) ===
${webBio}
===` : '';

    const userMessage = `Voici les données comportementales ET le profil public du contact à analyser :

${buildLLMContext(contactWithCompany, stats, scoring, subjects)}${webContextSection}

Génère le profil cognitif complet selon ce schéma JSON exact (réponds UNIQUEMENT en JSON, aucun texte autour) :

${LLM_SCHEMA}

Instructions spécifiques :
- Nom du contact : "${searchCtx.displayName}" (utilise CE nom dans executive_summary)
- Organisation : "${orgCtx}" — ${searchCtx.analysis.isEdu ? 'institution éducative' : searchCtx.analysis.domainType === 'startup' ? 'startup/scale-up' : 'entreprise'}
- behavioral_signals : 3 à 5 signaux. Croise les données comportementales (emails) ET le profil LinkedIn si disponible
- interaction_axes : 0 (pôle gauche) → 100 (pôle droit). Si le LinkedIn montre des posts techniques → structure élevée. Si posts inspirationnels → relation élevée
- jtbd : utilise le PARCOURS LINKEDIN (PARCOURS_PRO) et la section A_PROPOS pour inférer des JTBD précis et contextualisés à leur rôle actuel
- cognitive_mode : les POSTS_RECENTS LinkedIn révèlent S1 vs S2 (posts courts/réactifs → S1, threads analytiques → S2)
- executive_summary : 2-3 phrases qui synthétisent QUI est la personne (rôle, expertise, personnalité pro) en intégrant le parcours LinkedIn et les échanges email
- données insuffisantes → "hypothetical" + confidence faible
- Si les données LinkedIn sont absentes ou "Non trouvé" : base-toi uniquement sur les emails et le contexte organisationnel`;

    const llmRes = await fetch(OPENROUTER_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENROUTER_API_KEY')}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://knowy.ai',
        'X-Title': 'Knowr Contact Enrichment',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!llmRes.ok) throw new Error(`LLM error ${llmRes.status}: ${await llmRes.text()}`);

    const llmData = await llmRes.json();
    const rawContent = llmData.choices?.[0]?.message?.content ?? '{}';
    let profile: any = {};
    try { profile = JSON.parse(rawContent); }
    catch {
      try { const m = rawContent.match(/\{[\s\S]*\}/); if (m) profile = JSON.parse(m[0]); }
      catch { console.error('[enrich-contact] LLM JSON parse failed, using empty profile. Raw:', rawContent.slice(0, 200)); }
    }

    // ── 7. Upsert cognitive_profile ───────────────────────────────────────────
    const globalConfidence = stats.totalInteractions > 50 ? 80
      : stats.totalInteractions > 20 ? 65
      : stats.totalInteractions > 5 ? 45
      : 25;

    const { data: savedProfile } = await supabase
      .from('cognitive_profiles')
      .upsert({
        organization_id: organizationId,
        contact_id: contactId,
        profile_version: 1,
        global_confidence: globalConfidence,
        summary: profile.executive_summary ?? null,
        executive_summary: profile.executive_summary ?? null,
        cognitive_mode: profile.cognitive_mode ?? 'unavailable',
        cognitive_mode_confidence: profile.cognitive_mode_confidence ?? 0,
        interaction_modes_data: profile.interaction_modes_primary ?? [],
        jtbd_data: profile.jtbd_data ?? {},
        theory_of_mind_data: profile.theory_of_mind ?? {},
        behavioral_analysis_data: profile.behavioral_signals ?? [],
        engagement_score: scoring.score,
        score_phase: scoring.phase,
        score_intensite: scoring.si,
        score_reciprocite: scoring.sr,
        score_longevite: scoring.sl,
        score_delta: scoring.delta,
        updated_from: ['gmail', 'calendar'].filter(s => s === 'gmail' ? msgs.length > 0 : meets.length > 0),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'organization_id,contact_id,profile_version' })
      .select('id')
      .maybeSingle();

    const profileId = savedProfile?.id;
    const signals: any[] = profile.behavioral_signals ?? [];

    if (profileId) {
      // Interaction axes
      const axisRows = Object.entries(profile.interaction_axes ?? {}).map(([axis, data]: [string, any]) => ({
        organization_id: organizationId,
        profile_id: profileId,
        axis: axis as any,
        value: Math.round(clamp(data.value ?? 50, 0, 100)),
        confidence: Math.round(clamp(data.confidence ?? 50, 0, 100)),
        inference_level: data.inference_level ?? 'unavailable',
        evidence_count: msgs.length + meets.length,
      }));
      if (axisRows.length > 0) {
        await supabase.from('interaction_axis_scores').delete().eq('profile_id', profileId);
        await supabase.from('interaction_axis_scores').insert(axisRows);
      }

      // Interaction modes
      const modes: string[] = profile.interaction_modes_primary ?? [];
      if (modes.length > 0) {
        await supabase.from('interaction_mode_scores').delete().eq('profile_id', profileId);
        await supabase.from('interaction_mode_scores').insert(
          modes.map((mode, i) => ({
            organization_id: organizationId,
            profile_id: profileId,
            mode: mode as any,
            score: Math.max(50, 90 - i * 15),
            confidence: Math.round(profile.cognitive_mode_confidence * 100) || 60,
            evidence_count: msgs.length + meets.length,
          }))
        );
      }

      // Behavioral signals
      if (signals.length > 0) {
        await supabase.from('behavioral_signals').delete().eq('contact_id', contactId).eq('source_type', 'ai_enrichment');
        await supabase.from('behavioral_signals').insert(
          signals.map(s => ({
            organization_id: organizationId,
            contact_id: contactId,
            profile_id: profileId,
            signal_type: s.signal_type ?? 'communication_style',
            text: s.text ?? '',
            inference: s.inference ?? null,
            inference_level: s.inference_level ?? 'hypothetical',
            confidence: Math.round(clamp(s.confidence / 100) * 100),
            source_type: 'ai_enrichment',
            observed_at: new Date().toISOString(),
          }))
        );
      }
    }

    // Score history
    const today = new Date().toISOString().split('T')[0];
    await supabase.from('contact_score_history').upsert({
      organization_id: organizationId,
      contact_id: contactId,
      user_id: user.id,
      score: scoring.score,
      phase: scoring.phase,
      score_intensite: scoring.si,
      score_reciprocite: scoring.sr,
      score_longevite: scoring.sl,
      snapshot_date: today,
    }, { onConflict: 'organization_id,contact_id,user_id,snapshot_date' });

    // Update contact status
    await supabase.from('contacts').update({
      enrichment_status: 'done',
      last_enriched_at: new Date().toISOString(),
      enrichment_error: null,
    }).eq('id', contactId);

    // Recalcule le score relationnel (importance_score) des réunions de ce contact
    try {
      const { data: contactMeetings } = await supabase
        .from('meeting_participants')
        .select('meeting_id')
        .eq('organization_id', organizationId)
        .eq('contact_id', contactId);
      const meetingIds = [...new Set((contactMeetings ?? []).map((r: any) => r.meeting_id))];
      for (const mid of meetingIds) {
        const { data: mparts } = await supabase
          .from('meeting_participants')
          .select('contact_id')
          .eq('meeting_id', mid)
          .eq('is_current_user', false)
          .not('contact_id', 'is', null);
        const partContactIds = [...new Set((mparts ?? []).map((r: any) => r.contact_id).filter(Boolean))];
        if (partContactIds.length === 0) continue;
        const { data: profs } = await supabase
          .from('cognitive_profiles')
          .select('engagement_score')
          .in('contact_id', partContactIds)
          .gt('engagement_score', 0);
        const scores = (profs ?? []).map((p: any) => p.engagement_score);
        if (scores.length > 0) {
          const avg = Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length);
          await supabase.from('meetings').update({ importance_score: avg }).eq('id', mid);
        }
      }
    } catch (_) { /* best-effort */ }

    // Activity event
    const sourceNames = [orgInfo && 'org', linkedinData && 'linkedin', webPresenceData && 'web', personBio && 'person'].filter(Boolean);
    const webLabel = webBio ? ` · Perplexity ✓ (${sourceNames.join('+')})` : '';
    await supabase.from('knowy_activity_events').insert({
      organization_id: organizationId,
      user_id: user.id,
      event_type: 'profile_enriched',
      title: `Profil enrichi — ${searchCtx.displayName}`,
      description: `Score ${scoring.score}/100 · ${scoring.phase === 'growth' ? '+' : ''}${scoring.delta} pts · ${signals.length} signaux cognitifs${webLabel}`,
      entity_link: `/contacts/${contactId}`,
    }).select().maybeSingle();

    return jsonResponse({
      status: 'done',
      contactId,
      engagementScore: scoring.score,
      phase: scoring.phase,
      dimensions: { intensite: scoring.si, reciprocite: scoring.sr, longevite: scoring.sl },
      cognitiveMode: profile.cognitive_mode,
      interactionModes: profile.interaction_modes_primary,
      globalConfidence,
      webEnriched: !!webBio,
      orgResearched: !!orgInfo,
      linkedinFound: !!linkedinData && !linkedinData.includes('LINKEDIN_URL: Non trouvé'),
      webSources: sourceNames.length,
    });

  } catch (err: any) {
    await supabase.from('contacts').update({
      enrichment_status: 'failed',
      enrichment_error: err?.message ?? 'Unknown error',
    }).eq('id', contactId);
    console.error('[enrich-contact] error:', err);
    return jsonResponse({ error: err?.message ?? 'Enrichment failed' }, 500);
  }
});

