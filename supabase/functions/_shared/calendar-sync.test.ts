import { describe, expect, it } from 'vitest'
import { corporateDomain, companyNameFromDomain, errorMessage, meetingScopeOf, type NormalizedAttendee } from './calendar-sync'

function attendee(overrides: Partial<NormalizedAttendee> = {}): NormalizedAttendee {
  return { email: 'a@example.com', displayName: null, organizer: false, self: false, ...overrides }
}

describe('meetingScopeOf', () => {
  it('treats a 1:1 (one attendee besides self) as individual', () => {
    const event = { attendees: [attendee({ self: true }), attendee()] }
    expect(meetingScopeOf(event, 5)).toBe('individual')
  })

  it('treats exactly the threshold as individual', () => {
    const others = Array.from({ length: 5 }, (_, i) => attendee({ email: `p${i}@example.com` }))
    const event = { attendees: [attendee({ self: true }), ...others] }
    expect(meetingScopeOf(event, 5)).toBe('individual')
  })

  it('treats one above the threshold as collective', () => {
    const others = Array.from({ length: 6 }, (_, i) => attendee({ email: `p${i}@example.com` }))
    const event = { attendees: [attendee({ self: true }), ...others] }
    expect(meetingScopeOf(event, 5)).toBe('collective')
  })

  it('treats zero external attendees as individual (solo block, e.g. focus time)', () => {
    const event = { attendees: [attendee({ self: true })] }
    expect(meetingScopeOf(event, 5)).toBe('individual')
  })
})

describe('corporateDomain / companyNameFromDomain', () => {
  it('ignores public email domains', () => {
    expect(corporateDomain('someone@gmail.com')).toBeNull()
  })

  it('extracts a corporate domain', () => {
    expect(corporateDomain('maxime@optee.io')).toBe('optee.io')
  })

  it('derives a readable company name from a domain', () => {
    expect(companyNameFromDomain('acme-corp.io')).toBe('Acme Corp')
  })
})

describe('errorMessage', () => {
  it('returns the message of a real Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })

  it('extracts .message from a plain error-shaped object (e.g. PostgrestError)', () => {
    expect(errorMessage({ message: 'no unique constraint', code: '42P10' })).toBe('no unique constraint')
  })

  it('never returns the useless "[object Object]"', () => {
    expect(errorMessage({ code: '42P10' })).not.toBe('[object Object]')
  })
})
