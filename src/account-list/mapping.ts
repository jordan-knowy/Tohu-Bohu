// Liste Comptes — mapping pur des lignes Supabase vers le modèle d'affichage.
// Aucun score n'est calculé ici : on agrège uniquement des scores persistés
// (moyenne des derniers scores contacts du moteur backend), comme la Home.

export type Row = Record<string, unknown>

export const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
export const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
export const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null
export const num = (value: unknown): number | null => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null

export type AccountTier = 'Critique' | 'Sous tension' | 'À traiter' | 'Stables' | 'À qualifier'

export type AccountListRow = {
  id: string
  name: string
  meta: string | null
  favorite: boolean
  watchEnabled: boolean
  relationType: string | null
  relationSinceMonths: number | null
  score: number | null
  trend: 'up' | 'down' | 'flat' | null
  contactCount: number
  channels: { email: boolean; visio: boolean; linkedin: boolean; phone: boolean }
  ownerId: string | null
  ownerName: string | null
  tier: AccountTier
  tracked: boolean
}

export type PortfolioPoint = { monthKey: string; score: number | null }

export type TickerItem = { src: 'ext' | 'int'; tag: string; account: string; summary: string }

export type TeamMember = { id: string; name: string; avatarUrl: string | null }

export const TIER_COLORS: Record<AccountTier, string> = {
  Critique: '#D94F63', 'Sous tension': '#C97A20', 'À traiter': '#6E50C8', Stables: '#2EA86A', 'À qualifier': '#8C86A8',
}

export const RELATION_COLORS: Record<string, string> = {
  Prospect: '#2896A8', Client: '#2EA86A', Partenaire: '#6E50C8', 'Fournisseur / Prestataire': '#C97A20',
  Investisseur: '#D94F63', Interne: '#8C86A8', 'Réseau': '#3B2E7E',
}

export const LOGO_COLORS = ['#D94F63', '#C97A20', '#2896A8', '#6E50C8', '#2EA86A', '#3B2E7E', '#5A3EAA']

export function accountTier(score: number | null): AccountTier {
  if (score === null) return 'À qualifier'
  if (score < 50) return 'Critique'
  if (score < 60) return 'Sous tension'
  if (score < 70) return 'À traiter'
  return 'Stables'
}

export function scoreColor(score: number | null): string {
  if (score === null) return 'var(--t3)'
  return score >= 60 ? '#2EA86A' : score >= 50 ? '#C97A20' : '#D94F63'
}

export function logoColor(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 997
  return LOGO_COLORS[hash % LOGO_COLORS.length]!
}

export function monthsBetween(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const start = new Date(iso)
  if (!Number.isFinite(start.getTime())) return null
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / (30.44 * 86_400_000)))
}

export function durationLabel(months: number | null): string {
  if (months === null) return 'À confirmer'
  if (months < 1) return '< 1 mois'
  if (months < 12) return `${months} mois`
  const years = months / 12
  const rounded = Math.round(years * 2) / 2
  return `${rounded % 1 === 0 ? rounded : rounded.toFixed(1).replace('.', ',')} an${rounded >= 2 ? 's' : ''}`
}

/** Dernier score persisté d'un contact : cognitive_profiles, sinon dernier point d'historique. */
export function latestContactScore(contact: Row, historyByContact: Map<string, Row[]>): number | null {
  const profiles = rows(contact.cognitive_profiles)
    .filter((profile) => num(profile.engagement_score) !== null)
    .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
  const fromProfile = num(profiles[0]?.engagement_score)
  if (fromProfile !== null) return fromProfile
  const history = historyByContact.get(String(contact.id)) ?? []
  return num(history[0]?.score)
}

export type AccountListRaw = {
  companies: Row[]
  contacts: Row[]
  scoreHistory: Row[]
  settings: Row[]
  preferences: Row[]
  watch: Row[]
  meetings: Row[]
  messageContactIds: Set<string>
  signals: Row[]
  profileNames: Map<string, string>
  now: Date
}

export function buildAccountRows(raw: AccountListRaw): AccountListRow[] {
  const contactsByCompany = new Map<string, Row[]>()
  for (const contact of raw.contacts) {
    const companyId = text(contact.company_id)
    if (!companyId) continue
    contactsByCompany.set(companyId, [...(contactsByCompany.get(companyId) ?? []), contact])
  }
  const historyByContact = new Map<string, Row[]>()
  for (const row of raw.scoreHistory) {
    const contactId = String(row.contact_id)
    historyByContact.set(contactId, [...(historyByContact.get(contactId) ?? []), row])
  }
  for (const list of historyByContact.values()) list.sort((a, b) => String(b.snapshot_date ?? '').localeCompare(String(a.snapshot_date ?? '')))

  const settingsByCompany = new Map(raw.settings.map((row) => [String(row.company_id), row]))
  const prefsByCompany = new Map(raw.preferences.map((row) => [String(row.company_id), row]))
  const watchByCompany = new Map(raw.watch.map((row) => [String(row.company_id), row]))
  const meetingsByCompany = new Map<string, Row[]>()
  for (const meeting of raw.meetings) {
    const companyId = text(meeting.company_id)
    if (!companyId) continue
    meetingsByCompany.set(companyId, [...(meetingsByCompany.get(companyId) ?? []), meeting])
  }

  return raw.companies.map((company) => {
    const id = String(company.id)
    const context = object(company.public_context)
    const linked = contactsByCompany.get(id) ?? []
    const settings = object(settingsByCompany.get(id))
    const meetings = meetingsByCompany.get(id) ?? []

    const scores = linked.map((contact) => latestContactScore(contact, historyByContact)).filter((value): value is number => value !== null)
    const score = num(context.relationship_score) ?? (scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : null)

    // Tendance : dernier point vs point d'il y a ~30 j dans l'historique persisté.
    const deltas: number[] = []
    for (const contact of linked) {
      const history = historyByContact.get(String(contact.id)) ?? []
      const latest = num(history[0]?.score)
      const monthAgoKey = new Date(raw.now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10)
      const previous = history.find((row) => String(row.snapshot_date ?? '') <= monthAgoKey)
      if (latest !== null && num(previous?.score) !== null) deltas.push(latest - num(previous?.score)!)
    }
    const meanDelta = deltas.length ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : null
    const trend: AccountListRow['trend'] = meanDelta === null ? null : meanDelta > 1 ? 'up' : meanDelta < -1 ? 'down' : 'flat'

    const startedAt = text(settings.relationship_started_at)
      ?? [...meetings.map((meeting) => text(meeting.starts_at))].filter((value): value is string => value !== null).sort()[0]
      ?? null

    const ownerId = text(settings.primary_owner_user_id) ?? mostCommonOwner(linked)
    const emailChannel = linked.some((contact) => raw.messageContactIds.has(String(contact.id)))
    return {
      id,
      name: text(company.name) ?? 'Compte',
      meta: [text(company.industry), text(context.location)].filter(Boolean).join(' · ') || null,
      favorite: object(prefsByCompany.get(id)).favorite === true,
      watchEnabled: object(watchByCompany.get(id)).enabled === true,
      relationType: text(settings.relationship_status) ?? null,
      relationSinceMonths: monthsBetween(startedAt, raw.now),
      score,
      trend,
      contactCount: linked.length,
      channels: {
        email: emailChannel,
        visio: meetings.length > 0,
        linkedin: raw.signals.some((signal) => String(signal.company_id) === id && /linkedin/i.test(String(signal.source ?? ''))),
        phone: linked.some((contact) => text(object(contact.enrichment_data).phone) !== null),
      },
      ownerId,
      ownerName: ownerId ? raw.profileNames.get(ownerId) ?? null : null,
      tier: accountTier(score),
      tracked: company.is_tracked !== false,
    }
  }).sort((a, b) => (a.score ?? 101) - (b.score ?? 101) || a.name.localeCompare(b.name))
}

function mostCommonOwner(contacts: Row[]): string | null {
  const counts = new Map<string, number>()
  for (const contact of contacts) {
    const owner = text(contact.owner_user_id)
    if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

/** Série mensuelle du portefeuille : pour chaque mois, moyenne des derniers
 *  scores mensuels par contact (historique réel), puis moyenne par compte. */
export function buildPortfolioSeries(scoreHistory: Row[], contacts: Row[], months: number, now: Date): PortfolioPoint[] {
  const contactCompany = new Map(contacts.map((contact) => [String(contact.id), text(contact.company_id)]))
  // mois -> compte -> contact -> dernier score du mois
  const byMonth = new Map<string, Map<string, Map<string, { date: string; score: number }>>>()
  for (const row of scoreHistory) {
    const date = text(row.snapshot_date)
    const score = num(row.score)
    const contactId = String(row.contact_id)
    const companyId = contactCompany.get(contactId)
    if (!date || score === null || !companyId) continue
    const monthKey = date.slice(0, 7)
    const companies = byMonth.get(monthKey) ?? new Map()
    const contactsMap = companies.get(companyId) ?? new Map()
    const current = contactsMap.get(contactId)
    if (!current || current.date < date) contactsMap.set(contactId, { date, score })
    companies.set(companyId, contactsMap)
    byMonth.set(monthKey, companies)
  }
  const result: PortfolioPoint[] = []
  for (let index = months - 1; index >= 0; index--) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1))
    const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
    const companies = byMonth.get(monthKey)
    if (!companies) { result.push({ monthKey, score: null }); continue }
    const accountScores = [...companies.values()].map((contactsMap) => {
      const values = [...contactsMap.values()].map((entry) => entry.score)
      return values.reduce((sum, value) => sum + value, 0) / values.length
    })
    result.push({ monthKey, score: Math.round(accountScores.reduce((sum, value) => sum + value, 0) / accountScores.length) })
  }
  return result
}

/** Évolutions % sur 1 mois / trimestre / année, à partir de points persistés uniquement. */
export function evolutionPercents(series: PortfolioPoint[]): { m1: number | null; m3: number | null; m12: number | null } {
  const scored = series.filter((point) => point.score !== null)
  const last = scored.at(-1)?.score ?? null
  const at = (offset: number): number | null => {
    if (last === null) return null
    const target = series.length - 1 - offset
    if (target < 0) return null
    const point = series[target]
    if (!point || point.score === null || point.score === 0) return null
    return Math.round((last - point.score) / point.score * 100)
  }
  return { m1: at(1), m3: at(3), m12: at(12) }
}

const SIGNAL_TAGS: Record<string, string> = {
  gouvernance: 'Direction', dirigeants: 'Direction', recrutements: 'Recrutement', financement: 'Levée',
  presse: 'Presse', legal: 'Légal', 'événements légaux': 'Légal', 'appels d’offres': 'Marché',
  'signaux métier': 'Marché', déménagement: 'Siège',
}

export function buildTickerItems(signals: Row[], companyNames: Map<string, string>): TickerItem[] {
  return signals.flatMap((signal) => {
    const account = companyNames.get(String(signal.company_id)) ?? text(object(signal.companies).name)
    const summary = text(signal.summary) ?? text(signal.title)
    if (!account || !summary) return []
    const family = String(signal.family ?? '').toLowerCase()
    const internal = /outlook|gmail|email|interne|meeting/i.test(String(signal.source ?? ''))
    return [{
      src: internal ? 'int' as const : 'ext' as const,
      tag: internal ? 'Interne' : SIGNAL_TAGS[family] ?? (text(signal.family) ?? 'Signal'),
      account,
      summary,
    }]
  })
}
