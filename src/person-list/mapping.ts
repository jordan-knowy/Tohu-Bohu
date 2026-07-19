// Liste Personnes — mapping pur des lignes Supabase vers le modèle d'affichage.
// Miroir de account-list/mapping.ts : mêmes tokens de tier/couleur/score/durée,
// réutilisés tels quels pour que les deux listes se comportent à l'identique.

import { accountTier as scoreTier, durationLabel, latestContactScore, logoColor, monthsBetween, RELATION_COLORS, scoreColor, tickerDurationSeconds, TIER_COLORS, type AccountTier, type TeamMember } from '../account-list/mapping'

export { durationLabel, logoColor, RELATION_COLORS, scoreColor, tickerDurationSeconds, TIER_COLORS, type TeamMember }

export type Row = Record<string, unknown>

const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null

export type PersonTier = AccountTier

export type PersonListRow = {
  id: string
  name: string
  avatarUrl: string | null
  jobTitle: string | null
  companyId: string | null
  companyName: string | null
  favorite: boolean
  watchEnabled: boolean
  relationType: string | null
  relationSinceMonths: number | null
  score: number | null
  trend: 'up' | 'down' | 'flat' | null
  lastContactAt: string | null
  channels: { email: boolean; visio: boolean; linkedin: boolean; phone: boolean }
  ownerId: string | null
  ownerName: string | null
  tier: PersonTier
}

export type TickerItem = { src: 'ext' | 'int'; tag: string; person: string; summary: string }

export function lastContactLabel(iso: string | null): string {
  if (!iso) return 'Aucun contact'
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return 'Aucun contact'
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days < 0) return 'Aujourd’hui'
  if (days === 0) return 'Aujourd’hui'
  if (days < 14) return `il y a ${days} j`
  if (days < 60) return `il y a ${Math.round(days / 7)} sem.`
  if (days < 365) return `il y a ${Math.round(days / 30.44)} mois`
  return new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric' }).format(date)
}

export type PersonListRaw = {
  contacts: Row[]
  scoreHistory: Row[]
  settings: Row[]
  userSettings: Row[]
  messages: Row[]
  meetings: Row[]
  profileNames: Map<string, string>
  now: Date
}

export function buildPersonListRows(raw: PersonListRaw): PersonListRow[] {
  const historyByContact = new Map<string, Row[]>()
  for (const row of raw.scoreHistory) {
    const id = String(row.contact_id)
    historyByContact.set(id, [...(historyByContact.get(id) ?? []), row])
  }
  for (const list of historyByContact.values()) list.sort((a, b) => String(b.snapshot_date ?? '').localeCompare(String(a.snapshot_date ?? '')))

  const settingsByContact = new Map(raw.settings.map((row) => [String(row.contact_id), row]))
  const userSettingsByContact = new Map(raw.userSettings.map((row) => [String(row.contact_id), row]))

  const messagesByContact = new Map<string, Row[]>()
  for (const message of raw.messages) {
    const id = text(message.contact_id)
    if (!id) continue
    messagesByContact.set(id, [...(messagesByContact.get(id) ?? []), message])
  }

  const meetingsByCompany = new Map<string, Row[]>()
  for (const meeting of raw.meetings) {
    const companyId = text(meeting.company_id)
    if (!companyId) continue
    meetingsByCompany.set(companyId, [...(meetingsByCompany.get(companyId) ?? []), meeting])
  }

  return raw.contacts.flatMap((contact) => {
    const id = String(contact.id)
    const companyId = text(contact.company_id)
    const company = object(contact.companies)
    const settings = object(settingsByContact.get(id))
    if (settings.archived_at) return []
    const userSettings = object(userSettingsByContact.get(id))
    const messages = messagesByContact.get(id) ?? []
    const meetings = companyId ? meetingsByCompany.get(companyId) ?? [] : []

    const score = latestContactScore(contact, historyByContact)
    const history = historyByContact.get(id) ?? []
    const latest = Number(history[0]?.score ?? NaN)
    const monthAgoKey = new Date(raw.now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10)
    const previous = history.find((row) => String(row.snapshot_date ?? '') <= monthAgoKey)
    const previousScore = previous ? Number(previous.score ?? NaN) : NaN
    const trend: PersonListRow['trend'] = Number.isFinite(latest) && Number.isFinite(previousScore)
      ? (latest - previousScore > 1 ? 'up' : latest - previousScore < -1 ? 'down' : 'flat')
      : null

    const lastMessageAt = messages.map((m) => text(m.sent_at)).filter((v): v is string => v !== null).sort().at(-1) ?? null
    const lastSnapshotAt = rows(contact.relationship_snapshots).map((r) => text(r.last_contact_at)).filter((v): v is string => v !== null).sort().at(-1) ?? null
    const lastContactAt = [lastMessageAt, lastSnapshotAt].filter((v): v is string => v !== null).sort().at(-1) ?? null

    const startedAt = text(contact.tenure_start_date)
      ?? meetings.map((m) => text(m.starts_at)).filter((v): v is string => v !== null).sort()[0]
      ?? messages.map((m) => text(m.sent_at)).filter((v): v is string => v !== null).sort()[0]
      ?? text(contact.created_at)
      ?? null

    const ownerId = text(settings.primary_owner_user_id) ?? text(contact.owner_user_id)

    return [{
      id,
      name: text(contact.full_name) ?? 'Personne',
      avatarUrl: text(contact.avatar_url),
      jobTitle: text(contact.role_title),
      companyId,
      companyName: text(company.name),
      favorite: userSettings.favorite === true,
      watchEnabled: userSettings.watch_enabled === true,
      relationType: text(settings.relationship_type),
      relationSinceMonths: monthsBetween(startedAt, raw.now),
      score,
      trend,
      lastContactAt,
      channels: {
        email: messages.length > 0,
        visio: meetings.length > 0,
        linkedin: text(contact.linkedin_url) !== null,
        phone: text(object(contact.enrichment_data).phone) !== null,
      },
      ownerId,
      ownerName: ownerId ? raw.profileNames.get(ownerId) ?? null : null,
      tier: scoreTier(score),
    }]
  }).sort((a, b) => (a.score ?? 101) - (b.score ?? 101) || a.name.localeCompare(b.name))
}

const SIGNAL_TAGS: Record<string, string> = {
  job_change: 'Mouvement', promotion: 'Promotion', new_role: 'Mouvement', role_change: 'Mouvement',
}

export function buildPersonTickerItems(signals: Row[]): TickerItem[] {
  return signals.flatMap((signal) => {
    const person = text(object(signal.contacts).full_name)
    const summary = text(signal.text) ?? text(signal.inference)
    if (!person || !summary) return []
    const sourceType = String(signal.source_type ?? '')
    const internal = /^email_|meeting|calendar/i.test(sourceType)
    const kind = String(signal.signal_type ?? '').toLowerCase()
    return [{
      src: internal ? 'int' as const : 'ext' as const,
      tag: internal ? 'Interne' : SIGNAL_TAGS[kind] ?? 'Signal',
      person,
      summary,
    }]
  })
}
