// Fraîcheur d'un score persisté (SPEC-06 §14 / §18) : une valeur calculée
// depuis longtemps ne doit jamais être présentée comme à jour sans le
// signaler. `computedAt` absent ne peut jamais être déduit comme "à jour" ou
// "périmé" : l'appelant garde alors son état existant (score présent ou non).

export type ScoreFreshness = 'ready' | 'stale'

const DEFAULT_STALE_AFTER_HOURS = 48

export function scoreFreshness(computedAt: string | null, now: Date, staleAfterHours = DEFAULT_STALE_AFTER_HOURS): ScoreFreshness {
  if (!computedAt) return 'ready'
  const computed = new Date(computedAt).getTime()
  if (!Number.isFinite(computed)) return 'ready'
  const ageHours = (now.getTime() - computed) / 3_600_000
  return ageHours > staleAfterHours ? 'stale' : 'ready'
}
