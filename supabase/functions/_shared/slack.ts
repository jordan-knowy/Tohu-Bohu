export const SLACK_SCOPES = ['users:read', 'users:read.email', 'channels:read', 'channels:history', 'groups:read', 'groups:history', 'im:read', 'im:history', 'mpim:read', 'mpim:history']
export class SlackError extends Error {
  constructor(public code: string, public retryAfter = 0) { super(`Slack : ${code}`) }
}
export async function slackApi(token: string, method: string, params: Record<string, string> = {}, fetcher: typeof fetch = fetch): Promise<any> {
  const response = await fetcher(`https://slack.com/api/${method}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params), signal: AbortSignal.timeout(20000),
  })
  if (response.status === 429) throw new SlackError('ratelimited', Math.max(1, Number(response.headers.get('Retry-After')) || 60))
  if (!response.ok) throw new SlackError(`http_${response.status}`, response.status >= 500 ? 30 : 0)
  const data = await response.json()
  if (!data.ok) throw new SlackError(data.error ?? 'invalid_response', data.error === 'ratelimited' ? 60 : 0)
  return data
}
export function conversationTypes(scopes: string[]): string {
  return [['channels', 'public_channel'], ['groups', 'private_channel'], ['im', 'im'], ['mpim', 'mpim']]
    .filter(([scope]) => scopes.includes(`${scope}:read`) && scopes.includes(`${scope}:history`)).map(([, type]) => type).join(',')
}
export function isPrivateConversation(channel: any): boolean {
  // Unknown conversation types are private by default.
  return channel.is_private !== false || channel.is_im === true || channel.is_mpim === true
}
export function messageKey(team: string, channel: string, ts: string): string { return `${team}:${channel}:${ts}` }
export function authoredMessage(message: any): boolean {
  return !!message.user && !message.bot_id && (!message.subtype || message.subtype === 'thread_broadcast') && /^\d+\.\d+$/.test(message.ts ?? '')
}
export const REAUTH_ERRORS = ['invalid_auth', 'token_revoked', 'token_expired', 'account_inactive', 'invalid_refresh_token']
