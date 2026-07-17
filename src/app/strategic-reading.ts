/**
 * Lecture stratégique d'un compte — règles métier pures (testées).
 *
 * La synthèse est générée côté serveur (Edge Function `account-strategic-reading`)
 * uniquement à partir des données persistées du compte, puis stockée dans
 * `account_strategic_readings`. Le front ne fabrique jamais de contenu :
 * sans lecture persistée, il affiche « Lecture en construction ».
 *
 * Règle de suffisance (documentée, appliquée côté client ET côté serveur) :
 * une lecture ne peut être générée que si le compte a au moins un contact lié
 * ET au moins MIN_EVIDENCE éléments de matière (signaux + interactions +
 * messages synchronisés). En dessous, toute synthèse serait de l'invention.
 */

export const MIN_EVIDENCE = 3

export type ReadingCounts = {
  contacts: number
  signals: number
  interactions: number
  /** Messages synchronisés (métadonnées) — connu côté serveur uniquement, 0 côté client. */
  messages: number
}

export function readingSufficiency(counts: ReadingCounts): { sufficient: boolean; missing: string[] } {
  const missing: string[] = []
  if (counts.contacts < 1) missing.push('au moins un contact lié au compte')
  const evidence = counts.signals + counts.interactions + counts.messages
  if (evidence < MIN_EVIDENCE) {
    missing.push(`au moins ${MIN_EVIDENCE} éléments d'historique (signaux, réunions ou échanges) — ${evidence} disponible${evidence > 1 ? 's' : ''}`)
  }
  return { sufficient: missing.length === 0, missing }
}

export type StrategicReading = {
  synthese: string
  forces: string[]
  risques: string[]
  prochainesActions: string[]
  confidence: number | null
  sourceCounts: ReadingCounts
  generatedAt: string | null
  model: string | null
}

type DbRow = Record<string, unknown>

function record(value: unknown): DbRow {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as DbRow
  return {}
}

function stringList(value: unknown, max = 5): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, max)
}

function count(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0
}

/** Mappe une ligne `account_strategic_readings` vers le type front. Retourne null si le contenu est vide. */
export function mapStrategicReading(row: DbRow | null | undefined): StrategicReading | null {
  if (!row) return null
  const content = record(row.content)
  const synthese = String(content.synthese ?? '').trim()
  if (!synthese) return null
  const sources = record(row.source_counts)
  const confidence = Number(row.confidence)
  return {
    synthese,
    forces: stringList(content.forces),
    risques: stringList(content.risques),
    prochainesActions: stringList(content.prochaines_actions),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : null,
    sourceCounts: {
      contacts: count(sources.contacts),
      signals: count(sources.signals),
      interactions: count(sources.interactions),
      messages: count(sources.messages),
    },
    generatedAt: typeof row.generated_at === 'string' ? row.generated_at : null,
    model: typeof row.model === 'string' ? row.model : null,
  }
}

/** Une lecture est considérée à rafraîchir au-delà de 7 jours. */
export function isReadingStale(generatedAt: string | null, now: Date): boolean {
  if (!generatedAt) return true
  const time = new Date(generatedAt).getTime()
  if (!Number.isFinite(time)) return true
  return now.getTime() - time > 7 * 86_400_000
}
