import { getSupabase } from '../lib/supabase'

/** Lance l'analyse sur les sources conversationnelles déjà autorisées.
 *  La fonction edge retrouve elle-même les personnes suivies et n'analyse
 *  jamais un contact sous le seuil de trois interactions attribuées. */
export async function triggerBehaviorSyncs(organizationId: string): Promise<void> {
  const client = getSupabase()
  const { data, error } = await client.from('connectors')
    .select('provider,status')
    .eq('organization_id', organizationId)
    .in('provider', ['google', 'microsoft'])
    .eq('status', 'connected')
  if (error) throw error

  const results = await Promise.allSettled((data ?? []).map(({ provider }) =>
    client.functions.invoke('sync-email-analysis', { body: { organizationId, provider } }),
  ))
  const failed = results.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
}
