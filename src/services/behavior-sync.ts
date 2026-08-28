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

const MANUAL_ANALYSIS_MAX_CONTACTS = 30
const MANUAL_ANALYSIS_CONCURRENCY = 4

export type ManualCognitiveAnalysisResult = { analyzed: number; failed: number; skipped: number; total: number }

/** Déclenchement manuel (bouton admin) : relecture ciblée par personne — le
 *  même mécanisme fiable que le bouton « relire » d'une fiche, en boucle sur
 *  les personnes suivies, jamais le scan large de découverte.
 *
 *  Pourquoi pas `triggerBehaviorSyncs` (sync-email-analysis sans contactId) :
 *  sans contact ciblé, la fonction relance un scan complet de la boîte mail
 *  (fenêtre de 2 ans) avant de pouvoir analyser qui que ce soit — sur une
 *  boîte réelle, ce scan consomme à lui seul le budget d'exécution de 55s de
 *  la fonction edge, et l'analyse IA (Confiance/Satisfaction) ne se déclenche
 *  jamais (`peopleAnalyzed: 0` constaté en test réel malgré 374 messages
 *  scannés). La relecture ciblée par personne (`contactId`) fait une
 *  recherche directe sur cette seule identité, beaucoup plus rapide.
 *
 *  N'utilise que les connecteurs de L'UTILISATEUR APPELANT (owner/admin qui
 *  clique) : sync-email-analysis résout toujours le connecteur par
 *  `organization_id + user_id + provider` de l'appelant, jamais celui d'un
 *  autre membre de l'équipe — même limite que le bouton « relire » existant. */
export async function triggerManualCognitiveAnalysis(organizationId: string, userId: string): Promise<ManualCognitiveAnalysisResult> {
  const client = getSupabase()
  const [{ data: connectors, error: connectorsError }, { data: contacts, error: contactsError }] = await Promise.all([
    client.from('connectors').select('provider')
      .eq('organization_id', organizationId).eq('user_id', userId).eq('status', 'connected').in('provider', ['google', 'microsoft']),
    client.from('contacts').select('id, cognitive_profiles(trust_score)')
      .eq('organization_id', organizationId).eq('is_tracked', true).is('merged_into_contact_id', null).limit(2000),
  ])
  if (connectorsError) throw connectorsError
  if (contactsError) throw contactsError
  const provider = connectors?.[0]?.provider as string | undefined
  if (!provider) throw new Error('Connecte ton propre compte Google ou Microsoft 365 pour lancer l’analyse (le tien, pas celui d’un autre membre).')

  // Priorité aux personnes jamais analysées (Confiance/Satisfaction encore
  // neutres) — celles déjà mesurées peuvent attendre le prochain cycle cron.
  const prioritized = (contacts ?? [])
    .map((row) => {
      const profiles = row.cognitive_profiles as unknown
      const measured = Array.isArray(profiles) && profiles.some((p) => (p as { trust_score?: number | null })?.trust_score != null)
      return { id: String(row.id), measured }
    })
    .sort((a, b) => Number(a.measured) - Number(b.measured))
  const targets = prioritized.slice(0, MANUAL_ANALYSIS_MAX_CONTACTS)

  let analyzed = 0
  let failed = 0
  let index = 0
  async function next(): Promise<void> {
    const current = index++
    if (current >= targets.length) return
    const contact = targets[current]!
    try {
      const { data, error } = await client.functions.invoke('sync-email-analysis', { body: { organizationId, provider, contactId: contact.id } })
      if (error || (data as { success?: boolean } | null)?.success === false) failed++
      else analyzed++
    } catch {
      failed++
    }
    return next()
  }
  await Promise.all(Array.from({ length: Math.min(MANUAL_ANALYSIS_CONCURRENCY, targets.length) }, () => next()))
  return { analyzed, failed, skipped: Math.max(0, prioritized.length - targets.length), total: prioritized.length }
}
