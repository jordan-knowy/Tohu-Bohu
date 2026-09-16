// Feature flags — mécanisme de rollout réel (§11). Valeurs conservatrices par défaut.
// Un flag OFF = comportement legacy inchangé. Le rollout permet staff → orgs → all.

export type FlagKey =
  | 'account_facts_engine'
  | 'scoring_v6_shadow'
  | 'scoring_v6_ui'
  | 'relevance_engine_v1'
  | 'account_brain_v2'

export interface FeatureFlag {
  key: FlagKey
  enabled: boolean
  rollout: { mode?: 'off' | 'staff' | 'orgs' | 'all'; org_ids?: string[]; user_ids?: string[] }
}

export interface FlagContext { userId?: string | null; organizationId?: string | null; isStaff?: boolean }

/** Décision PURE (testable) : ce flag est-il actif pour ce contexte ? Conservateur :
 *  OFF si le flag est absent ou désactivé. */
export function isFlagEnabled(flag: FeatureFlag | undefined | null, ctx: FlagContext): boolean {
  if (!flag || !flag.enabled) return false
  const mode = flag.rollout?.mode ?? 'off'
  switch (mode) {
    case 'all': return true
    case 'staff': return !!ctx.isStaff
    case 'orgs': return !!ctx.organizationId && (flag.rollout.org_ids ?? []).includes(ctx.organizationId)
    case 'off':
    default:
      // repli : autorisé si l'utilisateur est listé explicitement
      return !!ctx.userId && (flag.rollout.user_ids ?? []).includes(ctx.userId)
  }
}

let cache: { at: number; flags: Map<string, FeatureFlag> } | null = null
const TTL_MS = 60_000

/** Charge les flags depuis la table public.feature_flags (cache 60 s). Import
 *  dynamique de supabase pour rester utilisable côté pur (tests n'appellent pas ceci). */
export async function loadFlags(): Promise<Map<string, FeatureFlag>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.flags
  const { getSupabase } = await import('./supabase')
  const { data } = await getSupabase().from('feature_flags').select('key, enabled, rollout')
  const flags = new Map<string, FeatureFlag>()
  for (const row of data ?? []) flags.set(String(row.key), { key: row.key as FlagKey, enabled: !!row.enabled, rollout: (row.rollout ?? {}) as FeatureFlag['rollout'] })
  cache = { at: Date.now(), flags }
  return flags
}

export async function flagEnabled(key: FlagKey, ctx: FlagContext): Promise<boolean> {
  const flags = await loadFlags()
  return isFlagEnabled(flags.get(key), ctx)
}
