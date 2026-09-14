import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({ createClient: () => ({}) }))

let normalizeMicrosoftEvent: typeof import('./index')['normalizeMicrosoftEvent']

beforeEach(async () => {
  vi.stubGlobal('Deno', { env: { get: () => undefined }, serve: () => undefined })
  vi.resetModules()
  ;({ normalizeMicrosoftEvent } = await import('./index'))
})

const OWN_EMAIL = 'jordan@tohu.co'

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    subject: 'Point client',
    isAllDay: false,
    isCancelled: false,
    start: { dateTime: '2026-10-20T06:00:00.000' },
    end: { dateTime: '2026-10-20T10:00:00.000' },
    organizer: { emailAddress: { address: OWN_EMAIL } },
    attendees: [{ emailAddress: { address: 'maxime@optee.io', name: 'Maxime Weinstein' } }],
    isOnlineMeeting: false,
    ...overrides,
  }
}

describe('normalizeMicrosoftEvent', () => {
  it('ignores all-day events', () => {
    expect(normalizeMicrosoftEvent(baseEvent({ isAllDay: true }), OWN_EMAIL)).toBeNull()
  })

  it('ignores events without an id', () => {
    expect(normalizeMicrosoftEvent(baseEvent({ id: undefined }), OWN_EMAIL)).toBeNull()
  })

  it('maps isCancelled to status "cancelled"', () => {
    const event = normalizeMicrosoftEvent(baseEvent({ isCancelled: true }), OWN_EMAIL)
    expect(event?.status).toBe('cancelled')
  })

  it('sets meetingUrl only for a genuine Teams-for-business online meeting', () => {
    const notTeams = normalizeMicrosoftEvent(baseEvent({ isOnlineMeeting: true, onlineMeetingProvider: 'skypeForConsumer', onlineMeeting: { joinUrl: 'https://join.skype.com/x' } }), OWN_EMAIL)
    expect(notTeams?.platform).toBe('calendar_only')
    expect(notTeams?.meetingUrl).toBeNull()

    const isTeams = normalizeMicrosoftEvent(baseEvent({ isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness', onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/x' } }), OWN_EMAIL)
    expect(isTeams?.platform).toBe('teams')
    expect(isTeams?.meetingUrl).toBe('https://teams.microsoft.com/l/meetup-join/x')
  })

  it('adds self explicitly when absent from attendees', () => {
    const event = normalizeMicrosoftEvent(baseEvent(), OWN_EMAIL)
    expect(event?.attendees.some((a) => a.self && a.email === OWN_EMAIL)).toBe(true)
  })

  it('prefixes the external event id by provider', () => {
    const event = normalizeMicrosoftEvent(baseEvent({ id: 'raw-id-456' }), OWN_EMAIL)
    expect(event?.externalEventId).toBe('microsoft:raw-id-456')
  })
})
