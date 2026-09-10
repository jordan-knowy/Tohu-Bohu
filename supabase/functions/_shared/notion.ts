export const NOTION_VERSION = '2026-03-11'

export class NotionError extends Error {
  constructor(public code: string, public status: number, public retryAfter = 0) { super(`Notion : ${code}`) }
}

export async function notionApi(token: string, path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<any> {
  const response = await fetcher(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20000),
  })
  if (response.status === 429) throw new NotionError('rate_limited', 429, Math.max(1, Number(response.headers.get('Retry-After')) || 60))
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new NotionError(String(data.code ?? `http_${response.status}`), response.status, response.status >= 500 ? 30 : 0)
  return data
}

export function richText(value: any): string {
  return Array.isArray(value) ? value.map(item => String(item?.plain_text ?? item?.text?.content ?? '')).join('').trim() : ''
}

export function blockText(block: any): string {
  const payload = block?.[block?.type]
  return richText(payload?.rich_text ?? payload?.caption)
}

export function notionPageUrl(id: string): string { return `https://www.notion.so/${id.replaceAll('-', '')}` }
export const NOTION_REAUTH_ERRORS = ['unauthorized', 'restricted_resource', 'invalid_request_url']
