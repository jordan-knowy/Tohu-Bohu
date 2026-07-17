import { describe, expect, it } from 'vitest'
import {
  accountTier, buildAccountRows, buildPortfolioSeries, buildTickerItems,
  durationLabel, evolutionPercents, latestContactScore, monthsBetween,
  type AccountListRaw,
} from '../mapping'

const NOW = new Date('2026-07-17T12:00:00Z')

function raw(overrides: Partial<AccountListRaw> = {}): AccountListRaw {
  return {
    companies: [], contacts: [], scoreHistory: [], settings: [], preferences: [],
    watch: [], meetings: [], messageContactIds: new Set(), signals: [],
    profileNames: new Map(), now: NOW,
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
  it('moyenne des derniers scores contacts (cognitive_profiles)', () => {
    const rows = buildAccountRows(raw({
      companies,
      contacts: [
        { id: 'c1', company_id: 'a', cognitive_profiles: [{ engagement_score: 80, updated_at: '2026-07-01' }] },
        { id: 'c2', company_id: 'a', cognitive_profiles: [{ engagement_score: 60, updated_at: '2026-07-01' }] },
      ],
    }))
    expect(rows[0]?.score).toBe(70)
    expect(rows[0]?.tier).toBe('Stables')
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

describe('buildPortfolioSeries / evolutionPercents — série mensuelle réelle', () => {
  it('moyenne par compte puis par mois, mois vides null (jamais interpolés)', () => {
    const contacts = [{ id: 'c1', company_id: 'a' }, { id: 'c2', company_id: 'b' }]
    const history = [
      { contact_id: 'c1', score: 60, snapshot_date: '2026-06-10' },
      { contact_id: 'c1', score: 70, snapshot_date: '2026-06-25' },
      { contact_id: 'c2', score: 50, snapshot_date: '2026-06-25' },
      { contact_id: 'c1', score: 80, snapshot_date: '2026-07-01' },
    ]
    const series = buildPortfolioSeries(history, contacts, 3, NOW)
    expect(series.map((point) => point.score)).toEqual([null, 60, 80])
  })
  it('évolutions % uniquement quand les points existent', () => {
    const series = [
      { monthKey: '2026-05', score: 50 },
      { monthKey: '2026-06', score: 60 },
      { monthKey: '2026-07', score: 66 },
    ]
    const result = evolutionPercents(series)
    expect(result.m1).toBe(10)
    expect(result.m3).toBeNull()
    expect(result.m12).toBeNull()
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
