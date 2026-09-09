import { describe, expect, it, vi } from 'vitest'
import { authoredMessage, conversationTypes, isPrivateConversation, messageKey, slackApi, SlackError } from '../../../supabase/functions/_shared/slack'
import { buildHistory, sourceTypeLabel } from '../../person-detail/mapping'

describe('Slack API and provenance', () => {
  it('uses only conversation types with both granted read and history scopes', () => {
    expect(conversationTypes(['channels:read', 'channels:history', 'groups:read', 'im:history'])).toBe('public_channel')
    expect(conversationTypes([])).toBe('')
  })
  it('treats private, direct, group-direct and unknown channels as private', () => {
    for (const channel of [{}, { is_private: true }, { is_private: false, is_im: true }, { is_private: false, is_mpim: true }]) expect(isPrivateConversation(channel)).toBe(true)
    expect(isPrivateConversation({ is_private: false, is_channel: true })).toBe(false)
  })
  it('does not attribute bot messages or system events to people', () => {
    const msg = { user: 'U1', ts: '1700000000.123456', text: 'Hello' }
    expect(authoredMessage(msg)).toBe(true)
    expect(authoredMessage({ ...msg, thread_ts: '1699999999.000001' })).toBe(true)
    expect(authoredMessage({ ...msg, bot_id: 'B1' })).toBe(false)
    expect(authoredMessage({ ...msg, subtype: 'channel_join' })).toBe(false)
    expect(authoredMessage({ ...msg, ts: 'not-a-date' })).toBe(false)
  })
  it('keeps microsecond identifiers distinct across teams and channels', () => {
    const ids = [messageKey('T1', 'C1', '1700000000.000001'), messageKey('T1', 'C1', '1700000000.000002'), messageKey('T2', 'C1', '1700000000.000001'), messageKey('T1', 'C2', '1700000000.000001')]
    expect(new Set(ids).size).toBe(4)
  })
  it('passes pagination cursors verbatim and keeps tokens out of URLs', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, response_metadata: { next_cursor: 'next==' } })))
    const page = await slackApi('secret', 'users.list', { cursor: 'cursor+==' }, fetcher)
    expect(page.response_metadata.next_cursor).toBe('next==')
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://slack.com/api/users.list')
    expect(fetcher.mock.calls[0]?.[1].body.get('cursor')).toBe('cursor+==')
    expect(fetcher.mock.calls[0]?.[1].headers.Authorization).toBe('Bearer secret')
  })
  it('honors Retry-After without sleeping inside the edge function', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '87' } }))
    await expect(slackApi('token', 'conversations.replies', {}, fetcher)).rejects.toMatchObject({ code: 'ratelimited', retryAfter: 87 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('recognizes HTTP-200 Slack errors and transient HTTP failures', async () => {
    await expect(slackApi('token', 'users.list', {}, vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'token_revoked' }))))).rejects.toBeInstanceOf(SlackError)
    await expect(slackApi('token', 'users.list', {}, vi.fn().mockResolvedValue(new Response('', { status: 503 })))).rejects.toMatchObject({ retryAfter: 30 })
  })
  it('labels Slack evidence and message history correctly', () => {
    expect(sourceTypeLabel('slack')).toBe('Slack')
    const history = buildHistory([], [{ id: '1', provider: 'slack', sent_at: '2026-09-08T12:00:00Z', subject: 'Projet', direction: 'inbound' }], [], [], [])
    expect(history[0]).toMatchObject({ description: 'Message Slack', sourceLabel: 'Slack' })
  })
})
