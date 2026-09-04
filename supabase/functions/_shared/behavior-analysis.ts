// Cœur d'analyse comportementale partagé — source unique du "cerveau" Tohu.
//
// Extrait de sync-email-analysis pour être réutilisé sans duplication par
// l'ingestion manuelle de transcripts (ingest-transcript). Contient : le
// contrat de sortie JSON (schema_version 3), l'appel OpenRouter côté serveur
// (`analyze`), les transformations vers `behavioral_signals`, l'attribution
// des lignes de transcript à un locuteur, et l'écriture (upsert) d'un profil
// cognitif de contact (`persistContactProfile`).
//
// Toute évolution du prompt / du schéma se fait ICI et bénéficie aux deux
// chemins (email + transcript) simultanément.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { logAiUsage } from './ai-usage.ts'

export type RelationshipAxisResult = {
  status?: string
  score?: number | null
  observation?: string | null
  confidence?: number | null
  evidence?: string[]
}

export type AccountRelationResult = {
  status?: string
  category?: string | null
  observation?: string | null
  confidence?: number | null
  evidence?: string[]
}

export type Analysis = {
  executive_summary?: string
  cognitive_mode?: string
  cognitive_mode_confidence?: number
  global_confidence?: number
  behavioral_analysis_data?: Array<{ trait?: string; observation?: string; confidence?: number }>
  communication_style_data?: Record<string, unknown>
  cognitive_profile_data?: Record<string, unknown>
  // Axes du score relationnel PERSONNE (Confiance/Satisfaction) — distincts du
  // profil de style de communication ci-dessus. Nécessitent une lecture du
  // contenu réel des échanges (pas seulement leurs métadonnées), d'où leur
  // extraction ici plutôt que dans score-batch (pur calcul, sans IA).
  trust?: RelationshipAxisResult
  satisfaction?: RelationshipAxisResult
  // Catégorisation COMPTE (Prospect/Client/Partenaire/Fournisseur/Investisseur) :
  // indice par contact, agrégé au niveau compte par score-batch. Uniquement
  // pertinent pour role="contact" (une seule entreprise externe) — toujours
  // "insufficient" pour role="responsable" (auto-profil interne, multi-comptes).
  account_relation?: AccountRelationResult
}

const STATUS_SCHEMA = { type: 'string', enum: ['observed', 'emerging', 'insufficient'] }
const NULLABLE_NUMBER_SCHEMA = { type: ['number', 'null'] }
export const NULLABLE_STRING_SCHEMA = { type: ['string', 'null'] }
const SOURCE_TYPES_SCHEMA = {
  type: 'array',
  items: { type: 'string', enum: ['email', 'meeting_transcript'] },
}

// Catégories inférables du contenu d'échanges B2B — distinctes des catégories
// purement internes (Collègue/Interne/Réseau) qui ne concernent pas un compte
// externe et ne sont donc jamais suggérées ici.
export const ACCOUNT_RELATION_CATEGORIES = ['Prospect', 'Client', 'Partenaire', 'Fournisseur / Prestataire', 'Investisseur'] as const

export function strictObject(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }
}

const INTERPERSONAL_AXIS_SCHEMA = strictObject({
  status: STATUS_SCHEMA,
  score: NULLABLE_NUMBER_SCHEMA,
  label: NULLABLE_STRING_SCHEMA,
  observation: NULLABLE_STRING_SCHEMA,
  confidence: NULLABLE_NUMBER_SCHEMA,
  evidence_count: { type: 'integer', minimum: 0 },
  source_types: SOURCE_TYPES_SCHEMA,
  evolution: { type: ['string', 'null'], enum: ['rising', 'stable', 'declining', 'mixed', null] },
})

const PRIMARY_AXIS_SCHEMA = strictObject({
  status: STATUS_SCHEMA,
  raw_score: NULLABLE_NUMBER_SCHEMA,
  margin_pts: NULLABLE_NUMBER_SCHEMA,
  trend_pts: NULLABLE_NUMBER_SCHEMA,
  trend_label: { type: ['string', 'null'], enum: ['rising', 'stable', 'declining', null] },
  observation: NULLABLE_STRING_SCHEMA,
  confidence: NULLABLE_NUMBER_SCHEMA,
  evidence: { type: 'array', items: { type: 'string' } },
  evidence_count: { type: 'integer', minimum: 0 },
  source_types: SOURCE_TYPES_SCHEMA,
})

const SECONDARY_AXIS_SCHEMA = strictObject({
  status: STATUS_SCHEMA,
  score: NULLABLE_NUMBER_SCHEMA,
  observation: NULLABLE_STRING_SCHEMA,
  confidence: NULLABLE_NUMBER_SCHEMA,
  evidence_count: { type: 'integer', minimum: 0 },
  source_types: SOURCE_TYPES_SCHEMA,
})

// « Comment aborder cette personne » : scénarios contextuels do/don't déduits des
// preuves (jamais générique). Nourrit les listes À faire / À éviter de la fiche.
const APPROACH_SCENARIO_SCHEMA = strictObject({
  context: { type: 'string' },
  summary: NULLABLE_STRING_SCHEMA,
  do: { type: 'array', items: { type: 'string' } },
  dont: { type: 'array', items: { type: 'string' } },
})

const PRIMARY_AXES_OBJECT_SCHEMA = strictObject({
  rythme: PRIMARY_AXIS_SCHEMA,
  argumentation: PRIMARY_AXIS_SCHEMA,
  engagement: PRIMARY_AXIS_SCHEMA,
  registre: PRIMARY_AXIS_SCHEMA,
  tonalite: PRIMARY_AXIS_SCHEMA,
  espace_parole: PRIMARY_AXIS_SCHEMA,
})

// Axes Confiance/Satisfaction du score relationnel PERSONNE (doc 5-axes) :
// échelle qualité (0=faible, 100=fort), pas une échelle pôle-à-pôle comme les
// axes de style ci-dessus. Nécessitent une preuve datée pour compter.
const RELATIONSHIP_AXIS_SCHEMA = strictObject({
  status: STATUS_SCHEMA,
  score: NULLABLE_NUMBER_SCHEMA,
  observation: NULLABLE_STRING_SCHEMA,
  confidence: NULLABLE_NUMBER_SCHEMA,
  evidence: { type: 'array', items: { type: 'string' } },
  evidence_count: { type: 'integer', minimum: 0 },
  source_types: SOURCE_TYPES_SCHEMA,
})

// Catégorisation COMPTE — même logique de preuve que trust/satisfaction
// (jamais déduite du volume), mais une catégorie plutôt qu'un score continu.
const ACCOUNT_RELATION_SCHEMA = strictObject({
  status: STATUS_SCHEMA,
  category: { type: ['string', 'null'], enum: [...ACCOUNT_RELATION_CATEGORIES, null] },
  observation: NULLABLE_STRING_SCHEMA,
  confidence: NULLABLE_NUMBER_SCHEMA,
  evidence: { type: 'array', items: { type: 'string' } },
  evidence_count: { type: 'integer', minimum: 0 },
  source_types: SOURCE_TYPES_SCHEMA,
})

export const COGNITIVE_PROFILE_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'tohu_cognitive_profile_v3',
    strict: true,
    schema: strictObject({
      executive_summary: NULLABLE_STRING_SCHEMA,
      cognitive_mode: NULLABLE_STRING_SCHEMA,
      cognitive_mode_confidence: { type: 'number', minimum: 0, maximum: 100 },
      global_confidence: { type: 'number', minimum: 0, maximum: 100 },
      trust: RELATIONSHIP_AXIS_SCHEMA,
      satisfaction: RELATIONSHIP_AXIS_SCHEMA,
      account_relation: ACCOUNT_RELATION_SCHEMA,
      cognitive_profile_data: strictObject({
        schema_version: { type: 'integer', const: 3 },
        interpersonal: strictObject({
          assertiveness: INTERPERSONAL_AXIS_SCHEMA,
          warmth: INTERPERSONAL_AXIS_SCHEMA,
        }),
        primary_axes: PRIMARY_AXES_OBJECT_SCHEMA,
        secondary_axes: strictObject({
          orientation: SECONDARY_AXIS_SCHEMA,
          certainty: SECONDARY_AXIS_SCHEMA,
          novelty: SECONDARY_AXIS_SCHEMA,
          initiative: SECONDARY_AXIS_SCHEMA,
        }),
        posture: INTERPERSONAL_AXIS_SCHEMA,
        approach_guidance: { type: 'array', items: APPROACH_SCENARIO_SCHEMA },
      }),
    }),
  },
}

export function cleanEmail(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

export function stripHtml(value: string): string {
  return value.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
}

export function sanitizeBody(value: string): string {
  return stripHtml(value).split('\n').filter((line) => {
    const text = line.trim()
    return text && !text.startsWith('>') && !/^(De|From|À|To|Envoyé|Sent|Objet|Subject)\s*:/i.test(text)
  }).join('\n').slice(0, 1800)
}

export function pct(value: unknown): number {
  const parsed = Number(value ?? 0)
  if (!Number.isFinite(parsed)) return 0
  return Math.round(Math.max(0, Math.min(100, parsed <= 1 ? parsed * 100 : parsed)))
}

export function extractJson(value: string): Analysis {
  const normalized = value.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')

  try { return JSON.parse(normalized) } catch {
    // Certains modèles ajoutent une courte phrase avant/après le JSON. On
    // cherche alors un objet complet en respectant les accolades présentes
    // dans les chaînes, plutôt que de prendre aveuglément de la première à
    // la dernière accolade.
    for (let start = normalized.indexOf('{'); start >= 0; start = normalized.indexOf('{', start + 1)) {
      let depth = 0
      let inString = false
      let escaped = false
      for (let index = start; index < normalized.length; index++) {
        const char = normalized[index]
        if (inString) {
          if (escaped) escaped = false
          else if (char === '\\') escaped = true
          else if (char === '"') inString = false
          continue
        }
        if (char === '"') inString = true
        else if (char === '{') depth++
        else if (char === '}' && --depth === 0) {
          try { return JSON.parse(normalized.slice(start, index + 1)) } catch { break }
        }
      }
    }
    throw new Error('Analyse IA non parsable')
  }
}

export function openRouterContent(data: any): string {
  const content = data?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === 'string' ? part : String(part?.text ?? '')).join('')
  }
  return ''
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>
    return String(value.message ?? value.error_description ?? value.details ?? JSON.stringify(value))
  }
  return String(error ?? 'analyse impossible')
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function maturityFor(interactionCount: number): 'none' | 'emerging' | 'usable' | 'consolidated' | 'refined' {
  if (interactionCount < 3) return 'none'
  if (interactionCount < 10) return 'emerging'
  if (interactionCount < 25) return 'usable'
  if (interactionCount < 50) return 'consolidated'
  return 'refined'
}

export const PRIMARY_AXIS_IDS = [
  'rythme',
  'argumentation',
  'engagement',
  'registre',
  'tonalite',
  'espace_parole',
] as const

export function structuredBehavioralSignals(profile: Record<string, unknown>): Array<{ trait: string; observation: string; confidence: number }> {
  const axes = asRecord(profile.primary_axes)
  return PRIMARY_AXIS_IDS.flatMap((trait) => {
    const axis = asRecord(axes[trait])
    const observation = typeof axis.observation === 'string' ? axis.observation.trim() : ''
    if (!observation || axis.status === 'insufficient') return []
    return [{ trait, observation, confidence: pct(axis.confidence) }]
  })
}

export function assertCurrentCognitiveSchema(profile: Record<string, unknown>): void {
  if (Number(profile.schema_version) !== 3) throw new Error('Le moteur a retourné un profil comportemental dans un ancien format.')
  const axes = asRecord(profile.primary_axes)
  const missing = PRIMARY_AXIS_IDS.filter((axisId) => !axes[axisId] || typeof axes[axisId] !== 'object')
  if (missing.length) throw new Error(`Profil comportemental incomplet : axes manquants (${missing.join(', ')}).`)
}

export function isRetriableAnalysisError(error: unknown): boolean {
  const message = errorMessage(error)
  return message === 'Analyse IA non parsable'
    || message === 'Le moteur a retourné un profil comportemental dans un ancien format.'
    || message.startsWith('Profil comportemental incomplet :')
}

export type UsageLogContext = { client: Parameters<typeof logAiUsage>[0]; organizationId?: string | null; userId?: string | null }

export async function analyze(
  name: string,
  role: 'responsable' | 'contact',
  excerpts: string[],
  previousProfile: Record<string, unknown> = {},
  interactionCount = excerpts.length,
  usageLog?: UsageLogContext,
): Promise<Analysis> {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY')
  if (!apiKey) throw new Error('OPENROUTER_API_KEY non configurée')
  const model = Deno.env.get('OPENROUTER_ANALYSIS_MODEL') ?? 'google/gemini-3.1-flash-lite'
  const corpus = excerpts.slice(-30).join('\n---\n').slice(0, 16000)
  // Une fiche V1/V2 ne doit servir ni de contrat de sortie ni d'exemple au
  // modèle : il avait tendance à en recopier la structure. Elle sera
  // reconstruite depuis les preuves, puis les prochains calculs V3 pourront
  // de nouveau utiliser la continuité statistique du profil précédent.
  const compatiblePreviousProfile = Number(previousProfile.schema_version) === 3 ? previousProfile : {}
  const previous = Object.keys(compatiblePreviousProfile).length ? JSON.stringify(compatiblePreviousProfile).slice(0, 8000) : '{}'
  const prompt = `Tu construis le profil comportemental évolutif de ${name}, ${role === 'responsable' ? 'responsable de compte connecté' : 'personne suivie'}.
Tu disposes de ${interactionCount} interactions attribuées à cette personne. Analyse uniquement ce qu'elle a réellement rédigé dans les emails ou prononcé dans les passages de réunion explicitement attribués. Le profil précédent sert de mémoire statistique : conserve une tendance si les nouvelles preuves la confirment, nuance-la si elles la contredisent, et ne la remplace jamais sans preuves convergentes.

Règles impératives :
- aucune pathologie, donnée sensible ou personnalité essentialisée ;
- aucune citation mot pour mot ni texte d'exemple dans "observation" — seule "evidence" peut paraphraser un verbatim daté ;
- chaque observation doit être une paraphrase propre à cette personne ;
- les identifiants et axes du schéma sont fixes et doivent tous être présents ;
- status vaut "observed" si plusieurs preuves convergent, "emerging" si la tendance reste fragile, "insufficient" sans preuve ;
- pour "insufficient", tous les champs numériques et textuels de l'axe valent null et "evidence" est vide ;
- pour interpersonal/posture (inchangés) : score et confidence entre 0 et 100, evolution vaut "rising"/"stable"/"declining"/"mixed"/null ; assertiveness conciliant(0)→assertif(100), warmth distant(0)→chaleureux(100) ;
- pour chaque axe primaire (primary_axes) : "raw_score" est la position 0-100 sur l'axe du pôle gauche (0) vers le pôle droit (100) — rythme Posé(0)→Rapide(100), argumentation Récit(0)→Chiffré(100), engagement Implicite(0)→Explicite(100), registre Formel(0)→Direct(100), tonalité Sobre(0)→Chaleureux(100), espace_parole Écoute(0)→Occupe(100) ; "margin_pts" est TON incertitude estimée en points (peu de preuves → marge large, ex. 15-20 ; preuves nombreuses et convergentes → marge étroite, ex. 5-8) ; "trend_pts" est le delta signé de "raw_score" par rapport au profil précédent sur la période récente (null si aucun profil précédent ou axe alors insuffisant), "trend_label" vaut "rising"/"stable"/"declining" en cohérence avec le signe (stable si |trend_pts| <= 3) ; "evidence" contient 2 à 3 items COURTS mélangeant si possible un verbatim paraphrasé daté (jamais mot pour mot), une observation quantifiée (durée, fréquence), et un ratio/compte ;
- pour chaque axe secondaire (secondary_axes) : "score" suit la même échelle 0-100 pôle gauche→droit (orientation Tâche(0)→Relation(100), certainty Prudent(0)→Affirmatif(100), novelty Éprouvé(0)→Exploratoire(100), initiative Suit(0)→Mène(100)) ; pas de champ "evidence" ici, seulement "observation" ;
- evidence_count compte les preuves distinctes ; source_types contient uniquement les valeurs réellement présentes parmi "email" et "meeting_transcript".
- "trust" (Confiance, hors cognitive_profile_data) mesure la FIABILITÉ relationnelle, jamais le volume d'échanges : engagements tenus ou non tenus, réponses effectives aux demandes importantes, continuité, respect des échéances annoncées, stabilité du comportement, ruptures inexpliquées. "score" 0-100 où 100 = très fiable, 0 = peu fiable ; "status":"insufficient" si aucune preuve concrète d'engagement tenu/non tenu n'est disponible (ne jamais déduire la confiance du seul volume d'emails) ; "evidence" cite 1 à 3 faits datés précis (ex. "a confirmé le 12/06 un délai non tenu au 20/06" ou "répond systématiquement sous 24h aux demandes explicites").
- "satisfaction" (hors cognitive_profile_data) mesure la QUALITÉ perçue des interactions, distincte de l'activité : retours positifs, remerciements, validations explicites, résolution d'objections d'un côté ; frustrations répétées, désaccords, demandes non satisfaites, objections récurrentes de l'autre. "score" 0-100 où 100 = très satisfaisant, 0 = insatisfaisant ; "status":"insufficient" si aucun signal de tonalité positive/négative explicite n'apparaît (jamais déduit du seul volume d'échanges — une personne très active peut être mécontente) ; "evidence" cite 1 à 3 faits datés précis.
- "account_relation" (hors cognitive_profile_data) identifie la NATURE de la relation commerciale avec l'organisation externe de cette personne, à partir d'indices CONCRETS dans les échanges — jamais du volume ni d'une supposition générique. "category" vaut exactement l'une de "Prospect" (devis/offre envoyée par nous, pas encore de contrat signé, relance commerciale), "Client" (contrat/facture émise par nous, prestation en cours ou livrée), "Fournisseur / Prestataire" (devis/facture REÇUE, nous sommes l'acheteur), "Partenaire" (collaboration mutuelle, co-organisation, accord réciproque sans facturation dans un sens unique), "Investisseur" (financement, cap table, reporting actionnarial) — ou null si cette personne est le "responsable de compte connecté" (auto-profil interne, pas une relation à un compte externe unique) ou si aucun indice concret ne permet de trancher. "status":"insufficient" tant que "category" est null ; "evidence" cite 1 à 2 faits datés précis (ex. "devis envoyé le 03/04 pour la prestation X", "facture n°123 reçue le 12/05").
- "approach_guidance" : 2 à 4 scénarios CONCRETS et CONTEXTUELS indiquant comment aborder AU MIEUX cette personne, déduits UNIQUEMENT des preuves observées (jamais un conseil générique applicable à n'importe qui). Chaque scénario : "context" = une situation précise et variée ("Avant un rendez-vous", "Par email", "Quand il/elle temporise ou hésite", "Pour obtenir une décision", "Après un désaccord ou une friction", "Pour embarquer sur un nouveau sujet"…) ; "summary" = une phrase expliquant le levier relationnel PROPRE à cette personne dans ce contexte, avec le groupe de mots le plus décisif entouré de ** ** (ex. "Il **structure sa pensée en parlant**, laisse-le dérouler.") — un seul passage souligné par phrase, jamais toute la phrase ; "do" = 1 à 3 actions précises qui fonctionnent avec elle, ancrées sur son style réel (rythme, registre, argumentation, engagement…) et cohérentes avec les axes ci-dessus ; "dont" = 1 à 3 pièges concrets à éviter avec elle. Formulation opérationnelle (impératif), directement utile avant de la contacter ou de la voir. Renvoie une liste vide si les preuves sont insuffisantes pour être pertinent.

Réponds uniquement avec ce JSON strict :
{
  "executive_summary": "synthèse personnalisée ou null",
  "cognitive_mode": "posture dominante personnalisée ou null",
  "cognitive_mode_confidence": 0,
  "global_confidence": 0,
  "trust": {"status":"insufficient","score":null,"observation":null,"confidence":null,"evidence":[],"evidence_count":0,"source_types":[]},
  "satisfaction": {"status":"insufficient","score":null,"observation":null,"confidence":null,"evidence":[],"evidence_count":0,"source_types":[]},
  "account_relation": {"status":"insufficient","category":null,"observation":null,"confidence":null,"evidence":[],"evidence_count":0,"source_types":[]},
  "cognitive_profile_data": {
    "schema_version": 3,
    "interpersonal": {
      "assertiveness": {"status":"insufficient","score":null,"label":null,"observation":null,"confidence":null,"evidence_count":0,"source_types":[],"evolution":null},
      "warmth": {"status":"insufficient","score":null,"label":null,"observation":null,"confidence":null,"evidence_count":0,"source_types":[],"evolution":null}
    },
    "primary_axes": {
      "rythme": {"status":"insufficient","raw_score":null,"margin_pts":null,"trend_pts":null,"trend_label":null,"observation":null,"confidence":null,"evidence":[],"evidence_count":0,"source_types":[]},
      "argumentation": {"status":"insufficient","raw_score":null,"margin_pts":null,"trend_pts":null,"trend_label":null,"observation":null,"confidence":null,"evidence":[],"evidence_count":0,"source_types":[]},
      "engagement": {"status":"insufficient","raw_score":null,"margin_pts":null,"trend_pts":null,"trend_label":null,"observation":null,"confidence":null,"evidence":[],"evidence_count":0,"source_types":[]},
      "registre": {"status":"insufficient","raw_score":null,"margin_pts":null,"trend_pts":null,"trend_label":null,"observation":null,"confidence":null,"evidence":[],"evidence_count":0,"source_types":[]},
      "tonalite": {"status":"insufficient","raw_score":null,"margin_pts":null,"trend_pts":null,"trend_label":null,"observation":null,"confidence":null,"evidence":[],"evidence_count":0,"source_types":[]},
      "espace_parole": {"status":"insufficient","raw_score":null,"margin_pts":null,"trend_pts":null,"trend_label":null,"observation":null,"confidence":null,"evidence":[],"evidence_count":0,"source_types":[]}
    },
    "secondary_axes": {
      "orientation": {"status":"insufficient","score":null,"observation":null,"confidence":null,"evidence_count":0,"source_types":[]},
      "certainty": {"status":"insufficient","score":null,"observation":null,"confidence":null,"evidence_count":0,"source_types":[]},
      "novelty": {"status":"insufficient","score":null,"observation":null,"confidence":null,"evidence_count":0,"source_types":[]},
      "initiative": {"status":"insufficient","score":null,"observation":null,"confidence":null,"evidence_count":0,"source_types":[]}
    },
    "posture": {"status":"insufficient","score":null,"label":null,"observation":null,"confidence":null,"evidence_count":0,"source_types":[],"evolution":null},
    "approach_guidance": [{"context":"Avant un rendez-vous","summary":"phrase ancrée sur son style ou null","do":["action précise"],"dont":["piège à éviter"]}]
  }
}

Profil précédent : ${previous}
Nouveaux extraits :\n${corpus}`
  const requestAnalysis = async (retry: boolean): Promise<Analysis> => {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': Deno.env.get('SITE_URL') ?? 'https://tohu.app', 'X-Title': 'Tohu Email Behavior Analysis' },
      body: JSON.stringify({
        // Modèle dédié à l'analyse comportementale (découplé du chat Ask Tohu).
        // Surchargable via OPENROUTER_ANALYSIS_MODEL sans toucher aux autres fonctions.
        model,
        temperature: retry ? 0 : 0.1,
        response_format: COGNITIVE_PROFILE_RESPONSE_FORMAT,
        // Empêche OpenRouter de choisir un fournisseur qui ignorerait le
        // JSON Schema et retomberait silencieusement sur l'ancien format.
        provider: { require_parameters: true },
        max_tokens: retry ? 7000 : 6000,
        messages: [{
          role: 'user',
          content: retry
            ? `${prompt}\n\nIMPORTANT : la tentative précédente a produit un JSON invalide, tronqué ou dans un ancien schéma. Repars exclusivement du contrat ci-dessus : cognitive_profile_data.schema_version doit valoir 3 et les six primary_axes doivent tous être présents. Réponds de façon compacte, sans Markdown ni commentaire avant ou après l'objet JSON, et ferme impérativement toutes les structures JSON.`
            : prompt,
        }],
      }),
    })
    if (!response.ok) throw new Error(`OpenRouter ${response.status}`)
    const data = await response.json()
    if (usageLog) await logAiUsage(usageLog.client, { organizationId: usageLog.organizationId, userId: usageLog.userId, fn: 'behavior-analysis:analyze', model, usage: data?.usage })
    const content = openRouterContent(data)
    try {
      const result = extractJson(content)
      assertCurrentCognitiveSchema(asRecord(result.cognitive_profile_data))
      return result
    } catch (error) {
      // Ne jamais journaliser `content` : il peut contenir des paraphrases
      // issues des emails. Les métadonnées suffisent au diagnostic.
      console.warn('Réponse comportementale invalide', {
        retry,
        finishReason: data?.choices?.[0]?.finish_reason ?? null,
        contentLength: content.length,
        validationError: errorMessage(error),
      })
      throw error
    }
  }

  try {
    return await requestAnalysis(false)
  } catch (error) {
    if (!isRetriableAnalysisError(error)) throw error
    return await requestAnalysis(true)
  }
}

// ── Attribution des lignes de transcript à un locuteur ────────────────────
// Réutilisé par sync-email-analysis (loadMeetingCorpus) et par l'ingestion
// manuelle de transcript.

export function normalizedSpeaker(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Une transcription n'est utilisée que si le préfixe de locuteur correspond
 * exactement à une identité connue du contact. En cas d'ambiguïté, elle reste
 * visible dans l'historique mais n'alimente pas l'inférence comportementale. */
export function attributedTranscriptExcerpt(transcript: string, identities: string[]): string | null {
  const speakers = new Set(identities
    .flatMap((identity) => {
      const email = cleanEmail(identity)
      return [identity, email.includes('@') ? email.split('@')[0] : '']
    })
    .map(normalizedSpeaker)
    .filter((identity) => identity.length >= 4))
  if (!speakers.size) return null

  const attributed = String(transcript ?? '').split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^(.+?)(?:\s+\(\d{1,2}:\d{2}(?::\d{2})?\))?\s*:\s*(.+)$/)
    if (!match || !speakers.has(normalizedSpeaker(match[1]))) return []
    const content = sanitizeBody(match[2])
    return content ? [content] : []
  })
  if (!attributed.length) return null
  return `[Transcription de réunion]\n${attributed.join('\n')}`.slice(0, 2400)
}

// ── Écriture du profil cognitif d'un contact ──────────────────────────────

export type PersistContactProfileParams = {
  organizationId: string
  contactId: string
  result: Analysis
  messageCount: number
  meetingCount: number
  interactionCount: number
  updatedFrom: string[]
  signalSource: string
  /** Défaut : `sync:${now}`. Ex. transcript : `transcript:${meetingId}`. */
  sourceRef?: string
  /** Défaut : maintenant. Ex. transcript : date de la réunion. */
  observedAt?: string
}

/** Upsert du profil cognitif v3 d'un contact + insertion de ses signaux
 *  comportementaux dérivés. Source unique de la logique d'écriture, partagée
 *  entre l'analyse email et l'ingestion de transcript. Lève en cas d'échec
 *  pour que l'appelant journalise (les triggers calculent deduplication_key). */
export async function persistContactProfile(
  supabase: SupabaseClient,
  params: PersistContactProfileParams,
): Promise<{ profileId: string; signalCount: number }> {
  const { organizationId, contactId, result, messageCount, meetingCount, interactionCount, updatedFrom, signalSource } = params
  const cognitiveProfileData = asRecord(result.cognitive_profile_data)
  assertCurrentCognitiveSchema(cognitiveProfileData)
  const structuredSignals = structuredBehavioralSignals(cognitiveProfileData)
  const now = new Date().toISOString()
  const observedAt = params.observedAt ?? now
  const sourceRef = params.sourceRef ?? `sync:${now}`
  // Confiance/Satisfaction (score PERSONNE, 5 axes) : "insufficient" ne doit
  // jamais écraser une valeur déjà mesurée par un run précédent qui aurait
  // eu moins de matière — on ne régresse une mesure réelle vers null que si
  // ce run-ci l'a explicitement invalidée en trouvant un statut différent
  // n'est pas possible ici ; on garde donc simplement : mesuré si "observed"
  // ou "emerging" avec un score non nul, sinon null (zéro hallucination).
  const trust = result.trust?.status && result.trust.status !== 'insufficient' && result.trust.score != null ? result.trust : null
  const satisfaction = result.satisfaction?.status && result.satisfaction.status !== 'insufficient' && result.satisfaction.score != null ? result.satisfaction : null
  const accountRelation = result.account_relation?.status && result.account_relation.status !== 'insufficient'
    && result.account_relation.category && (ACCOUNT_RELATION_CATEGORIES as readonly string[]).includes(result.account_relation.category)
    ? result.account_relation : null
  const { data: cognitiveProfile, error: profileError } = await supabase.from('cognitive_profiles').upsert({
    organization_id: organizationId,
    contact_id: contactId,
    profile_version: 1,
    global_confidence: pct(result.global_confidence),
    summary: result.executive_summary ?? null,
    executive_summary: result.executive_summary ?? null,
    cognitive_mode: result.cognitive_mode ?? null,
    cognitive_mode_confidence: pct(result.cognitive_mode_confidence),
    behavioral_analysis_data: structuredSignals,
    communication_style_data: asRecord(cognitiveProfileData.secondary_axes),
    cognitive_profile_data: cognitiveProfileData,
    source_message_count: messageCount,
    source_meeting_count: meetingCount,
    source_interaction_count: interactionCount,
    maturity_level: maturityFor(interactionCount),
    analysis_version: 3,
    last_analyzed_at: now,
    updated_from: updatedFrom,
    updated_at: now,
    ...(trust ? { trust_score: pct(trust.score), trust_reasoning: trust.observation ?? null, trust_analyzed_at: now } : {}),
    ...(satisfaction ? { satisfaction_score: pct(satisfaction.score), satisfaction_reasoning: satisfaction.observation ?? null, satisfaction_analyzed_at: now } : {}),
    ...(accountRelation ? { account_relation_hint: accountRelation.category, account_relation_hint_confidence: pct(accountRelation.confidence), account_relation_hint_reasoning: accountRelation.observation ?? null, account_relation_hint_analyzed_at: now } : {}),
  }, { onConflict: 'organization_id,contact_id,profile_version' }).select('id').single()
  if (profileError || !cognitiveProfile) throw profileError ?? new Error('Profil cognitif non enregistré')
  const signals = structuredSignals.map((item) => ({ organization_id: organizationId, contact_id: contactId, profile_id: cognitiveProfile.id, signal_type: item.trait, text: item.observation, inference: item.trait, inference_level: 'observable', confidence: pct(item.confidence), source_type: signalSource, source_ref: sourceRef, observed_at: observedAt }))
  if (signals.length) {
    const { error: signalsError } = await supabase.from('behavioral_signals').insert(signals)
    if (signalsError) throw signalsError
  }
  return { profileId: cognitiveProfile.id as string, signalCount: signals.length }
}
