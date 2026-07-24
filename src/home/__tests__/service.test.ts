import { describe, expect, it } from 'vitest'
import { buildCoaching, buildScoredAccounts, buildSources, buildTeamMembers, isMissingRpcError, normalizeSyncJobStatus } from '../service'
import type { UserBehaviorProfile } from '../../services/data'

const NOW = new Date('2026-07-15T12:00:00Z')

describe('buildScoredAccounts — consommation des scores persistés (pas de formule parallèle)', () => {
  it('utilise le score persisté du compte quand il existe', () => {
    const [result] = buildScoredAccounts(
      [{ id: 'a', name: 'Oxalis', public_context: { relationship_score: 72 }, is_tracked: true }],
      [],
      true,
      NOW,
    )
    expect(result?.score).toBe(72)
    expect(result?.tracked).toBe(true)
  })
  it("agrège les engagement_score persistés des contacts quand le compte n'a pas de score propre", () => {
    const contacts = [
      { id: 'c1', company_id: 'a', relationship_snapshots: [{ engagement_score: 80, snapshot_date: '2026-07-10', phase: null, last_contact_at: '2026-07-10' }] },
      { id: 'c2', company_id: 'a', relationship_snapshots: [{ engagement_score: 60, snapshot_date: '2026-07-09', phase: null, last_contact_at: '2026-07-01' }] },
    ]
    const [result] = buildScoredAccounts([{ id: 'a', name: 'Oxalis', public_context: {}, is_tracked: true }], contacts, true, NOW)
    expect(result?.score).toBe(70)
    expect(result?.contactCount).toBe(2)
    expect(result?.lastInteractionAt).toBe('2026-07-10')
  })
  it('retombe sur cognitive_profiles.engagement_score quand relationship_snapshots est vide', () => {
    const contacts = [
      { id: 'c1', company_id: 'a', relationship_snapshots: [], cognitive_profiles: [{ engagement_score: 72, score_phase: 'stable', updated_at: '2026-07-10T08:00:00Z' }] },
      { id: 'c2', company_id: 'a', relationship_snapshots: [], cognitive_profiles: [{ engagement_score: 64, score_phase: null, updated_at: '2026-07-09T08:00:00Z' }] },
    ]
    const [result] = buildScoredAccounts([{ id: 'a', name: 'Oxalis', public_context: {}, is_tracked: true }], contacts, true, NOW)
    expect(result?.score).toBe(68)
    expect(result?.phase).toBe('stable')
  })
  it('reste null quand aucune donnée de score n’existe — pas de valeur inventée', () => {
    const [result] = buildScoredAccounts([{ id: 'a', name: 'Oxalis', public_context: { relationship_score: null, confidence_score: null }, is_tracked: true }], [], true, NOW)
    expect(result?.score).toBeNull()
    expect(result?.confidence).toBeNull()
    expect(result?.delta30d).toBeNull()
  })
  it('calcule delta30d uniquement avec un vrai historique de snapshots (≥ 25 j)', () => {
    const contacts = [{
      id: 'c1',
      company_id: 'a',
      relationship_snapshots: [
        { engagement_score: 70, snapshot_date: '2026-07-14', phase: null, last_contact_at: null },
        { engagement_score: 60, snapshot_date: '2026-06-10', phase: null, last_contact_at: null },
      ],
    }]
    const [result] = buildScoredAccounts([{ id: 'a', name: 'Oxalis', public_context: {}, is_tracked: true }], contacts, true, NOW)
    expect(result?.delta30d).toBe(10)
  })
  it('respecte is_tracked quand la colonne existe (scénarios workspace/forfait)', () => {
    const rows = buildScoredAccounts(
      [
        { id: 'a', name: 'A', public_context: {}, is_tracked: true },
        { id: 'b', name: 'B', public_context: {}, is_tracked: false },
      ],
      [],
      true,
      NOW,
    )
    expect(rows.find((row) => row.id === 'a')?.tracked).toBe(true)
    expect(rows.find((row) => row.id === 'b')?.tracked).toBe(false)
  })
  it('considère tout le portefeuille comme suivi en mode dégradé (colonne absente)', () => {
    const rows = buildScoredAccounts([{ id: 'a', name: 'A', public_context: {} }], [], false, NOW)
    expect(rows[0]?.tracked).toBe(true)
  })
})

describe('buildSources — couverture réelle des connecteurs (bloc 4, scénarios 2 et 3)', () => {
  it('retourne une liste vide sans connecteur — aucune fausse source', () => {
    expect(buildSources([])).toHaveLength(0)
  })
  it('expose Mail connecté et Calendrier partiel quand le scope calendrier manque', () => {
    const sources = buildSources([{
      provider: 'microsoft',
      status: 'connected',
      scopes: ['Mail.Read'],
      last_synced_at: '2026-07-15T09:00:00Z',
      metadata: { account_email: 'user@tohu.co' },
    }])
    expect(sources.find((source) => source.provider === 'microsoft:mail')?.status).toBe('connected')
    expect(sources.find((source) => source.provider === 'microsoft:calendar')?.status).toBe('partial')
    expect(sources[0]?.accountEmail).toBe('user@tohu.co')
    expect(sources[0]?.lastSyncedAt).toBe('2026-07-15T09:00:00Z')
  })
  it('marque en erreur un connecteur à reconnecter', () => {
    const sources = buildSources([{ provider: 'google', status: 'needs_reauth', scopes: [], last_synced_at: null, metadata: {} }])
    expect(sources.every((source) => source.status === 'error')).toBe(true)
  })
  it('marque déconnecté un connecteur retiré', () => {
    const sources = buildSources([{ provider: 'google', status: 'disconnected', scopes: [], last_synced_at: null, metadata: {} }])
    expect(sources.every((source) => source.status === 'disconnected')).toBe(true)
  })
})

describe('normalizeSyncJobStatus — contrainte réelle sync_jobs', () => {
  it('normalise succeeded en completed pour le contrat UI', () => {
    expect(normalizeSyncJobStatus('succeeded')).toBe('completed')
  })

  it('conserve les états actifs et échoués', () => {
    expect(normalizeSyncJobStatus('queued')).toBe('queued')
    expect(normalizeSyncJobStatus('running')).toBe('running')
    expect(normalizeSyncJobStatus('failed')).toBe('failed')
  })
})

describe('isMissingRpcError — message de migration fiable', () => {
  it('reconnaît uniquement la RPC demandée comme absente du cache PostgREST', () => {
    expect(isMissingRpcError({
      code: 'PGRST202',
      message: 'Could not find the function public.detect_account_candidates in the schema cache',
    }, 'detect_account_candidates')).toBe(true)
  })

  it('ne transforme pas une erreur SQL interne en migration absente', () => {
    expect(isMissingRpcError({
      code: '42703',
      message: 'column contacts.normalized_email does not exist',
    }, 'detect_account_candidates')).toBe(false)
  })

  it("n'attribue pas l'absence d'une autre fonction à la RPC appelée", () => {
    expect(isMissingRpcError({
      code: '42883',
      message: 'function public.some_dependency(uuid) does not exist',
    }, 'detect_account_candidates')).toBe(false)
  })
})

describe('buildTeamMembers — vision d’équipe réelle', () => {
  it('agrège les comptes, contacts et derniers scores par responsable', () => {
    const members = buildTeamMembers(
      [{ user_id: 'u1' }, { user_id: 'u2' }],
      [{ id: 'u1', full_name: 'Alex Martin', avatar_url: null }, { id: 'u2', full_name: 'Sam Lee', avatar_url: null }],
      [
        { owner_user_id: 'u1', company_id: 'a', relationship_snapshots: [{ engagement_score: 70, snapshot_date: '2026-07-14' }] },
        { owner_user_id: 'u1', company_id: 'a', relationship_snapshots: [{ engagement_score: 50, snapshot_date: '2026-07-14' }] },
        { owner_user_id: 'u2', company_id: 'b', relationship_snapshots: [] },
      ],
      NOW,
    )
    expect(members.find((member) => member.userId === 'u1')).toMatchObject({ accounts: 1, contacts: 2, score: 60 })
    expect(members.find((member) => member.userId === 'u2')).toMatchObject({ accounts: 1, contacts: 1, score: null })
  })

  it('n’affiche pas un membre dont le profil n’est pas lisible', () => {
    expect(buildTeamMembers([{ user_id: 'u1' }], [], [], NOW)).toEqual([])
  })
})

function behaviorProfile(overrides: Partial<UserBehaviorProfile> = {}): UserBehaviorProfile {
  return {
    global_confidence: 60,
    executive_summary: 'répond de façon directe (fixture)',
    cognitive_mode: null,
    cognitive_mode_confidence: null,
    behavioral_analysis_data: [{ trait: 'Style', observation: 'Messages courts', confidence: 70 }],
    communication_style_data: {},
    source_message_count: 20,
    updated_from: [],
    updated_at: '2026-07-10T00:00:00Z',
    ...overrides,
  }
}

describe('buildCoaching — style de communication du collaborateur (SPEC-05)', () => {
  it('retourne null sans profil', () => {
    expect(buildCoaching(null, [])).toBeNull()
  })
  it('retourne null sous le seuil minimal d’interactions analysées — jamais un profil forcé', () => {
    expect(buildCoaching(behaviorProfile({ source_message_count: 3 }), [])).toBeNull()
  })
  it('construit les insights avec feedback persisté, jamais un pourcentage de confiance stocké comme label', () => {
    const result = buildCoaching(behaviorProfile({
      behavioral_analysis_data: [
        { trait: 'Style', observation: 'Messages courts', confidence: 70 },
        { trait: 'Relances', observation: 'Relance sous 48h', confidence: 40 },
      ],
    }), [{ insight_id: 'insight-1', feedback_type: 'useful' }])
    expect(result?.insights).toEqual([
      { id: 'insight-0', trait: 'Style', observation: 'Messages courts', confidence: 70, feedback: null },
      { id: 'insight-1', trait: 'Relances', observation: 'Relance sous 48h', confidence: 40, feedback: 'useful' },
    ])
  })
  it('ignore les entrées sans observation exploitable', () => {
    expect(buildCoaching(behaviorProfile({ behavioral_analysis_data: [{ trait: 'Style', observation: '' }] }), [])).toBeNull()
  })
})
