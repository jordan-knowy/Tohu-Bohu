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

export type Analysis = {
  executive_summary?: string
  cognitive_mode?: string
  cognitive_mode_confidence?: number
  global_confidence?: number
  behavioral_analysis_data?: Array<{ trait?: string; observation?: string; confidence?: number }>
  communication_style_data?: Record<string, unknown>
  cognitive_profile_data?: Record<string, unknown>
}

const STATUS_SCHEMA = { type: 'string', enum: ['observed', 'emerging', 'insufficient'] }
const NULLABLE_NUMBER_SCHEMA = { type: ['number', 'null'] }
export const NULLABLE_STRING_SCHEMA = { type: ['string', 'null'] }
const SOURCE_TYPES_SCHEMA = {
  type: 'array',
  items: { type: 'string', enum: ['email', 'meeting_transcript'] },
}

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
      cognitive_profile_data: strictObject({
        schema_version: { type: 'integer', const: 3 },
        interpersonal: strictObject({
          assertiveness: INTERPERSONAL_AXIS_SCHEMA,
          warmth: INTERPERSONAL_AXIS_SCHEMA,
        }),
        primary_axes: strictObject({
          rythme: PRIMARY_AXIS_SCHEMA,
          argumentation: PRIMARY_AXIS_SCHEMA,
          engagement: PRIMARY_AXIS_SCHEMA,
          registre: PRIMARY_AXIS_SCHEMA,
          tonalite: PRIMARY_AXIS_SCHEMA,
          espace_parole: PRIMARY_AXIS_SCHEMA,
        }),
        secondary_axes: strictObject({
          orientation: SECONDARY_AXIS_SCHEMA,
          certainty: SECONDARY_AXIS_SCHEMA,
          novelty: SECONDARY_AXIS_SCHEMA,
          initiative: SECONDARY_AXIS_SCHEMA,
        }),
        posture: INTERPERSONAL_AXIS_SCHEMA,
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

export async function analyze(
  name: string,
  role: 'responsable' | 'contact',
  excerpts: string[],
  previousProfile: Record<string, unknown> = {},
  interactionCount = excerpts.length,
): Promise<Analysis> {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY')
  if (!apiKey) throw new Error('OPENROUTER_API_KEY non configurée')
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

Réponds uniquement avec ce JSON strict :
{
  "executive_summary": "synthèse personnalisée ou null",
  "cognitive_mode": "posture dominante personnalisée ou null",
  "cognitive_mode_confidence": 0,
  "global_confidence": 0,
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
    "posture": {"status":"insufficient","score":null,"label":null,"observation":null,"confidence":null,"evidence_count":0,"source_types":[],"evolution":null}
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
        model: Deno.env.get('OPENROUTER_ANALYSIS_MODEL') ?? 'google/gemini-3.1-flash-lite',
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
  }, { onConflict: 'organization_id,contact_id,profile_version' }).select('id').single()
  if (profileError || !cognitiveProfile) throw profileError ?? new Error('Profil cognitif non enregistré')
  const signals = structuredSignals.map((item) => ({ organization_id: organizationId, contact_id: contactId, profile_id: cognitiveProfile.id, signal_type: item.trait, text: item.observation, inference: item.trait, inference_level: 'observable', confidence: pct(item.confidence), source_type: signalSource, source_ref: sourceRef, observed_at: observedAt }))
  if (signals.length) {
    const { error: signalsError } = await supabase.from('behavioral_signals').insert(signals)
    if (signalsError) throw signalsError
  }
  return { profileId: cognitiveProfile.id as string, signalCount: signals.length }
}
