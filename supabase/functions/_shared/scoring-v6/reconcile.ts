// Canonical V6 module: shared by browser and edge.
// Règle de réconciliation (miroir pur des RPC public.reconcile_*). Un fait promu
// dont la source (moment/engagement) n'existe plus est ORPHELIN → à rendre obsolète
// (jamais supprimé : audit conservé, sort du scoring/vues actives).

export interface ReconcilableFact {
  id: string
  producer: string
  status: string
  sourceRef: { person_key_moment_id?: string; person_memory_entry_id?: string } | null
}

export function factSourceId(f: ReconcilableFact): string | null {
  return f.sourceRef?.person_key_moment_id ?? f.sourceRef?.person_memory_entry_id ?? null
}

/** Un fait est orphelin s'il est promu d'une source qui n'existe plus. */
export function isFactOrphaned(f: ReconcilableFact, existingSourceIds: Set<string>): boolean {
  if (f.status === 'obsolete') return false
  if (f.producer !== 'promote_moments' && f.producer !== 'promote_commitments') return false
  const sid = factSourceId(f)
  return sid !== null && !existingSourceIds.has(sid)
}

/** Sépare faits à rendre obsolètes vs conservés. Idempotent (un obsolète reste obsolète). */
export function reconcileFacts(facts: ReconcilableFact[], existingSourceIds: Set<string>): { obsolete: string[]; keep: string[] } {
  const obsolete: string[] = []
  const keep: string[] = []
  for (const f of facts) (isFactOrphaned(f, existingSourceIds) ? obsolete : keep).push(f.id)
  return { obsolete, keep }
}
