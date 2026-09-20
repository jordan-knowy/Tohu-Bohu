import { describe, expect, it } from 'vitest'
import { gmailBeforeCursor, microsoftBackfillState } from './backfill-cursors'

describe('provider backfill cursors', () => {
  it('resumes Gmail within the same day, including the boundary second', () => {
    expect(gmailBeforeCursor('2026-09-17T12:34:56.789Z')).toBe('1789648497')
  })

  it('keeps independent Graph folder dates when one folder is older', () => {
    const state = microsoftBackfillState(
      { truncated: true, oldestSentAt: '2023-03-23T09:06:38Z' },
      { truncated: true, oldestSentAt: '2024-01-10T08:00:00Z' },
      false, false,
    )
    expect(state.truncated).toBe(true)
    expect(state.cursorPatch.ms_backfill_inbox_before).toBe('2023-03-23T09:06:38Z')
    expect(state.cursorPatch.ms_backfill_sent_before).toBe('2024-01-10T08:00:00Z')
  })

  it('does not revisit an exhausted folder while the other continues', () => {
    const state = microsoftBackfillState(
      { truncated: false, oldestSentAt: null },
      { truncated: true, oldestSentAt: '2022-08-01T00:00:00Z' },
      true, false,
    )
    expect(state.truncated).toBe(true)
    expect(state.cursorPatch.ms_backfill_inbox_done).toBe(true)
    expect(state.cursorPatch.ms_backfill_sent_done).toBe(false)
  })

  it('rejects a truncated folder without a resume timestamp', () => {
    expect(() => microsoftBackfillState(
      { truncated: true, oldestSentAt: null },
      { truncated: false, oldestSentAt: null },
      false, false,
    )).toThrow('cursor missing')
  })
})
