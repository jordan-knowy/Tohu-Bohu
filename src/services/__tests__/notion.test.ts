import { describe, expect, it, vi } from 'vitest'
import { blockText, notionApi, notionPageUrl, richText } from '../../../supabase/functions/_shared/notion'

describe('Notion connector helpers', () => {
  it('authenticates and pins the current API version', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] })))
    await notionApi('secret', '/blocks/meeting_notes/query', { method: 'POST', body: '{}' }, fetcher)
    const call = fetcher.mock.calls[0]!
    expect(call![0]).toBe('https://api.notion.com/v1/blocks/meeting_notes/query')
    expect(call![1].headers).toMatchObject({ Authorization: 'Bearer secret', 'Notion-Version': '2026-03-11' })
  })
  it('extracts block rich text and creates a stable source URL', () => {
    expect(richText([{ plain_text: 'Compte ' }, { plain_text: 'rendu' }])).toBe('Compte rendu')
    expect(blockText({ type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Décision' }] } })).toBe('Décision')
    expect(notionPageUrl('1234-5678')).toBe('https://www.notion.so/12345678')
  })
})
