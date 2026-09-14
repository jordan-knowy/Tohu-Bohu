import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({ createClient: () => ({}) }))

let normalizeGoogleEvent: typeof import('./index')['normalizeGoogleEvent']

beforeEach(async () => {
  vi.stubGlobal('Deno', { env: { get: () => undefined }, serve: () => undefined })
  vi.resetModules()
  ;({ normalizeGoogleEvent } = await import('./index'))
})

const OWN_EMAIL = 'jordan@tohu.co'

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    status: 'confirmed',
    summary: 'Point client',
    start: { dateTime: '2026-10-20T06:00:00Z' },
    end: { dateTime: '2026-10-20T10:00:00Z' },
    attendees: [{ email: OWN_EMAIL, self: true }, { email: 'maxime@optee.io', displayName: 'Maxime Weinstein' }],
    ...overrides,
  }
}

describe('normalizeGoogleEvent', () => {
  it('ignores all-day events (no start.dateTime)', () => {
    expect(normalizeGoogleEvent({ id: 'evt-1', start: { date: '2026-10-20' } }, OWN_EMAIL)).toBeNull()
  })

  it('ignores events without an id', () => {
    expect(normalizeGoogleEvent(baseEvent({ id: undefined }), OWN_EMAIL)).toBeNull()
  })

  it('maps a cancelled event to status "cancelled"', () => {
    const event = normalizeGoogleEvent(baseEvent({ status: 'cancelled' }), OWN_EMAIL)
    expect(event?.status).toBe('cancelled')
  })

  it('adds self explicitly when Google omits it from attendees', () => {
    const event = normalizeGoogleEvent(baseEvent({ attendees: [{ email: 'maxime@optee.io' }] }), OWN_EMAIL)
    expect(event?.attendees.some((a) => a.self && a.email === OWN_EMAIL)).toBe(true)
  })

  it('extracts the Meet link from conferenceData entry points', () => {
    const event = normalizeGoogleEvent(baseEvent({
      conferenceData: { conferenceSolution: { key: { type: 'hangoutsMeet' } }, entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }] },
    }), OWN_EMAIL)
    expect(event?.platform).toBe('google_meet')
    expect(event?.meetingUrl).toBe('https://meet.google.com/abc-defg-hij')
  })

  it('falls back to calendar_only when there is no Meet conference', () => {
    const event = normalizeGoogleEvent(baseEvent(), OWN_EMAIL)
    expect(event?.platform).toBe('calendar_only')
    expect(event?.meetingUrl).toBeNull()
  })

  it('prefixes the external event id by provider', () => {
    const event = normalizeGoogleEvent(baseEvent({ id: 'raw-id-123' }), OWN_EMAIL)
    expect(event?.externalEventId).toBe('google:raw-id-123')
  })
})
