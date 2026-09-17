import { describe, expect, it } from 'vitest'
import {
  accountTier, buildAccountRows, buildAccountScoreSeries, buildTickerItems,
  durationLabel, evolutionPercents, latestContactScore, monthsBetween,
  type AccountListRaw, type PortfolioPoint,
} from '../mapping'

const NOW = new Date('2026-07-17T12:00:00Z')

function raw(overrides: Partial<AccountListRaw> = {}): AccountListRaw {
  return {
    companies: [], contacts: [], scoreHistory: [], settings: [], preferences: [],
    watch: [], meetings: [], messageContactIds: new Set(), signals: [],
    profileNames: new Map(), accountScores: new Map(), visions: [], now: NOW,
    ...overrides,
  }
}

describe('accountTier — bandes de score persisté, jamais de score inventé', () => {
  it('classe selon les seuils affichés (couleurs du graphique)', () => {
    expect(accountTier(null)).toBe('À qualifier')
    expect(accountTier(42)).toBe('Critique')
    expect(accountTier(55)).toBe('Sous tension')
    expect(accountTier(64)).toBe('À traiter')
    expect(accountTier(72)).toBe('Stables')
  })
})

describe('buildAccountRows — agrégation de scores persistés', () => {
  const companies = [{ id: 'a', name: 'Oxalis', industry: 'SaaS', public_context: {}, is_tracked: true }]
  it('ne moyenne pas les anciens scores contacts', () => {
    const rows = buildAccountRows(raw({
      companies,
      contacts: [
        { id: 'c1', company_id: 'a', cognitive_profiles: [{ engagement_score: 80, updated_at: '2026-07-01' }] },
        { id: 'c2', company_id: 'a', cognitive_profiles: [{ engagement_score: 60, updated_at: '2026-07-01' }] },
      ],
    }))
    expect(rows[0]?.score).toBeNull()
    expect(rows[0]?.tier).toBe('À qualifier')
    expect(rows[0]?.contactCount).toBe(2)
  })
  it('sans aucune donnée : score null, tier À qualifier, canaux éteints', () => {
    const rows = buildAccountRows(raw({ companies, contacts: [{ id: 'c1', company_id: 'a' }] }))
    expect(rows[0]?.score).toBeNull()
    expect(rows[0]?.tier).toBe('À qualifier')
    expect(rows[0]?.channels).toEqual({ email: false, visio: false, linkedin: false, phone: false })
    expect(rows[0]?.relationType).toBeNull()
  })
  it('canaux réels : email via messages, visio via réunions, tél via enrichment', () => {
    const rows = buildAccountRows(raw({
      companies,
      contacts: [{ id: 'c1', company_id: 'a', enrichment_data: { phone: '+336' } }],
      meetings: [{ company_id: 'a', platform: 'teams', starts_at: '2026-06-01' }],
      messageContactIds: new Set(['c1']),
    }))
    expect(rows[0]?.channels).toEqual({ email: true, visio: true, linkedin: false, phone: true })
  })
  it('owner : réglage compte prioritaire, sinon owner majoritaire des contacts', () => {
    const rows = buildAccountRows(raw({
      companies,
      contacts: [
        { id: 'c1', company_id: 'a', owner_user_id: 'u1' },
        { id: 'c2', company_id: 'a', owner_user_id: 'u1' },
        { id: 'c3', company_id: 'a', owner_user_id: 'u2' },
      ],
      profileNames: new Map([['u1', 'Léa'], ['u2', 'Max']]),
    }))
    expect(rows[0]?.ownerName).toBe('Léa')
    const withSettings = buildAccountRows(raw({
      companies,
      contacts: [{ id: 'c1', company_id: 'a', owner_user_id: 'u1' }],
      settings: [{ company_id: 'a', primary_owner_user_id: 'u2' }],
      profileNames: new Map([['u1', 'Léa'], ['u2', 'Max']]),
    }))
    expect(withSettings[0]?.ownerName).toBe('Max')
  })
  it('relation depuis : réglage sinon première réunion réelle', () => {
    const rows = buildAccountRows(raw({
      companies,
      meetings: [{ company_id: 'a', starts_at: '2024-07-17T10:00:00Z' }, { company_id: 'a', starts_at: '2025-01-01T10:00:00Z' }],
    }))
    expect(rows[0]?.relationSinceMonths).toBe(23)
    expect(durationLabel(rows[0]?.relationSinceMonths ?? null)).toBe('2 ans')
  })
})

describe('latestContactScore — profil moteur puis historique', () => {
  it('préfère cognitive_profiles, retombe sur contact_score_history', () => {
    const history = new Map([['c1', [{ score: 55, snapshot_date: '2026-07-01' }]]])
    expect(latestContactScore({ id: 'c1', cognitive_profiles: [{ engagement_score: 70, updated_at: '2026-07-02' }] }, history)).toBe(70)
    expect(latestContactScore({ id: 'c1' }, history)).toBe(55)
    expect(latestContactScore({ id: 'c2' }, history)).toBeNull()
  })
})

describe('buildAccountScoreSeries — même source (account_relationship_score_snapshots) que la carte et le tableau', () => {
  const names = new Map([['a', 'Ac Toulouse'], ['b', 'Limayrac']])
  const active = new Set(['a', 'b'])

  it('un mois sans snapshot pour un compte le laisse absent — jamais de report du dernier score connu ni du score actuel', () => {
    const rows = [
      { company_id: 'a', score: 72, snapshot_month: '2026-06-01' },
      { company_id: 'a', score: 68, snapshot_month: '2026-07-01' },
      { company_id: 'b', score: 50, snapshot_month: '2026-06-01' },
      // b n'a aucun snapshot en juillet : ne doit PAS reporter son score de juin.
    ]
    const series = buildAccountScoreSeries(rows, names, active, 2, NOW)
    expect(series.map((point) => point.monthKey)).toEqual(['2026-06', '2026-07'])
    expect(series[0]?.score).toBe(61) // (72+50)/2
    expect(series[0]?.accounts.map((a) => a.companyId).sort()).toEqual(['a', 'b'])
    expect(series[1]?.score).toBe(68) // b absent ce mois-ci, pas de fabrication → moyenne sur 'a' seul
    expect(series[1]?.accounts.map((a) => a.companyId)).toEqual(['a'])
  })

  it('un mois sans aucun snapshot est null, pas 0 ni interpolé', () => {
    const rows = [{ company_id: 'a', score: 72, snapshot_month: '2026-07-01' }]
    const series = buildAccountScoreSeries(rows, names, active, 3, NOW)
    expect(series.map((point) => point.score)).toEqual([null, null, 72])
  })

  it('un compte hors périmètre actif (archivé) est exclu même s’il a un snapshot', () => {
    const rows = [
      { company_id: 'a', score: 72, snapshot_month: '2026-07-01' },
      { company_id: 'z', score: 10, snapshot_month: '2026-07-01' }, // pas dans `active`
    ]
    const series = buildAccountScoreSeries(rows, names, active, 1, NOW)
    expect(series[0]?.score).toBe(72)
    expect(series[0]?.accounts).toHaveLength(1)
  })

  it('doublon compte+mois : défense en profondeur, ne compte qu’une fois (la première ligne — ordre computed_at desc)', () => {
    const rows = [
      { company_id: 'a', score: 80, snapshot_month: '2026-07-01' }, // la plus récente (computed_at desc)
      { company_id: 'a', score: 40, snapshot_month: '2026-07-01' }, // doublon plus ancien — ignoré
    ]
    const series = buildAccountScoreSeries(rows, names, active, 1, NOW)
    expect(series[0]?.score).toBe(80)
    expect(series[0]?.accounts).toHaveLength(1)
  })
})

describe('evolutionPercents — ancré strictement sur le dernier point de la série (raccord carte ↔ graphique)', () => {
  it('calcule m1/m3/m12 depuis les valeurs réellement affichées dans la série', () => {
    const series: PortfolioPoint[] = [
      { monthKey: '2026-05', score: 50, accounts: [] },
      { monthKey: '2026-06', score: 60, accounts: [] },
      { monthKey: '2026-07', score: 66, accounts: [] },
    ]
    const result = evolutionPercents(series)
    expect(result.m1).toBe(Math.round((66 - 60) / 60 * 100))
    expect(result.m3).toBeNull()
    expect(result.m12).toBeNull()
  })

  it('si le DERNIER mois de la série est null, aucune évolution n’est fabriquée depuis un mois antérieur', () => {
    const series: PortfolioPoint[] = [
      { monthKey: '2026-05', score: 50, accounts: [] },
      { monthKey: '2026-06', score: 60, accounts: [] },
      { monthKey: '2026-07', score: null, accounts: [] }, // mois courant sans snapshot
    ]
    const result = evolutionPercents(series)
    expect(result.m1).toBeNull()
    expect(result.m3).toBeNull()
    expect(result.m12).toBeNull()
  })
})

describe('cohérence carte ↔ graphique ↔ variations (même source, même périmètre de comptes)', () => {
  it('le dernier point du graphique = la moyenne des mêmes derniers scores comptes que la carte', () => {
    const names = new Map([['a', 'Ac Toulouse'], ['b', 'Gre Enr'], ['c', 'Limayrac']])
    const active = new Set(['a', 'b', 'c'])
    // Mêmes lignes account_relationship_score_snapshots que celles utilisées par
    // getAccountsOverview pour construire `accounts[].score` (globalScore).
    const rows = [
      { company_id: 'a', score: 59, snapshot_month: '2026-07-01' },
      { company_id: 'b', score: 65, snapshot_month: '2026-07-01' },
      { company_id: 'c', score: 71, snapshot_month: '2026-07-01' },
    ]
    const series = buildAccountScoreSeries(rows, names, active, 1, NOW)
    const globalScore = Math.round(rows.reduce((sum, r) => sum + r.score, 0) / rows.length)
    expect(series.at(-1)?.score).toBe(globalScore)
    expect(series.at(-1)?.score).toBe(65) // (59+65+71)/3 = 65
  })

  it('la variation M1 affichée dans le tooltip (point courant − point précédent) est cohérente avec evolutionPercents', () => {
    const names = new Map([['a', 'Ac Toulouse']])
    const active = new Set(['a'])
    const rows = [
      { company_id: 'a', score: 74, snapshot_month: '2026-06-01' },
      { company_id: 'a', score: 71, snapshot_month: '2026-07-01' },
    ]
    const series = buildAccountScoreSeries(rows, names, active, 2, NOW)
    const tooltipPointDelta = series[1]!.score! - series[0]!.score! // -3 pts, comme le tooltip
    expect(tooltipPointDelta).toBe(-3)
    const evolutions = evolutionPercents(series)
    expect(evolutions.m1).toBe(Math.round((71 - 74) / 74 * 100))
  })

  it('les filtres de la page (statut/type/owner) ne portent que sur le tableau : carte et graphique partagent le même périmètre `activeCompanyIds`, jamais un sous-ensemble filtré', () => {
    // Documente l'invariant service.ts : `activeCompanyIds` vient de `accounts`
    // (post buildAccountRows), pas de la liste filtrée côté UI (tierFilter/
    // typeFilter/ownerFilter, qui ne s'appliquent qu'au tableau) — carte et
    // graphique ne peuvent donc jamais diverger sur le périmètre de comptes.
    const names = new Map([['a', 'Ac Toulouse'], ['b', 'Gre Enr']])
    const rows = [
      { company_id: 'a', score: 59, snapshot_month: '2026-07-01' },
      { company_id: 'b', score: 65, snapshot_month: '2026-07-01' },
    ]
    const fullScope = new Set(['a', 'b'])
    const series = buildAccountScoreSeries(rows, names, fullScope, 1, NOW)
    // Même si un filtre de tableau ne retenait que 'a', la carte (calculée sur
    // `accounts`, jamais sur la liste filtrée) et le graphique restent sur les 2 comptes.
    expect(series[0]?.accounts).toHaveLength(2)
    expect(series[0]?.score).toBe(62) // (59+65)/2, pas juste 59
  })
})

describe('ticker et libellés', () => {
  it('classe interne/externe selon la source persistée', () => {
    const items = buildTickerItems([
      { company_id: 'a', family: 'financement', title: 'Levée', summary: 'levée de 4 M€', source: 'presse' },
      { company_id: 'a', family: 'signaux métier', title: 'Tension', summary: 'tension trésorerie', source: 'email_outlook' },
      { company_id: 'zz', family: 'presse', title: 'Sans compte', summary: 'ignoré', source: 'presse' },
    ], new Map([['a', 'Norévia']]))
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ src: 'ext', tag: 'Levée', account: 'Norévia' })
    expect(items[1]?.src).toBe('int')
  })
  it('durée et mois formatés', () => {
    expect(durationLabel(null)).toBe('À confirmer')
    expect(durationLabel(0)).toBe('< 1 mois')
    expect(durationLabel(5)).toBe('5 mois')
    expect(durationLabel(30)).toBe('2,5 ans')
    expect(monthsBetween('2026-07-01', NOW)).toBe(0)
  })
})
