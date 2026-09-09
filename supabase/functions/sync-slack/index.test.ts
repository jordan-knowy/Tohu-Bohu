import { beforeEach, describe, expect, it, vi } from 'vitest'
const harness = vi.hoisted(() => ({ db: null as any, handler: null as any, analyze: vi.fn(), persist: vi.fn() }))
vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({ createClient: () => harness.db }))
vi.mock('../_shared/behavior-analysis.ts', () => ({ analyze: harness.analyze, persistContactProfile: harness.persist, sanitizeBody: (text: string) => text }))
let rows: Record<string, any[]>
function query(table: string) {
  let mode = 'select', payload: any, single = false, count = false
  const filters: Array<(row: any) => boolean> = []
  const q: any = {
    select: (_?: string, opts?: any) => { count = opts?.count; return q },
    eq: (key: string, value: any) => { filters.push(row => row[key] === value); return q },
    gt: (key: string, value: any) => { filters.push(row => row[key] > value); return q },
    lt: (key: string, value: any) => { filters.push(row => row[key] < value); return q },
    single: () => { single = true; return q }, maybeSingle: () => { single = true; return q },
    update: (value: any) => { mode = 'update'; payload = value; return q },
    insert: (value: any) => { mode = 'insert'; payload = value; return q },
    upsert: (value: any) => { mode = 'upsert'; payload = value; return q },
    delete: () => { mode = 'delete'; return q },
    then: (resolve: any) => {
      const all = rows[table] ??= []
      let found = all.filter(row => filters.every(filter => filter(row)))
      if (mode === 'update') found.forEach(row => Object.assign(row, structuredClone(payload)))
      if (mode === 'delete') rows[table] = all.filter(row => !found.includes(row))
      if (mode === 'insert' || mode === 'upsert') {
        const key = payload.external_message_id ? 'external_message_id' : payload.external_thread_id ? 'external_thread_id' : 'id'
        const existing = mode === 'upsert' && all.find(row => payload[key] && row[key] === payload[key])
        if (existing) { Object.assign(existing, structuredClone(payload)); found = [existing] }
        else { const row = { id: `${table}-${all.length}`, ...structuredClone(payload) }; all.push(row); found = [row] }
      }
      return Promise.resolve(resolve({ data: structuredClone(single ? found[0] ?? null : found), error: null, ...(count ? { count: found.length } : {}) }))
    },
  }
  return q
}
async function call() {
  return harness.handler(new Request('https://example.test/sync', { method: 'POST', headers: { Authorization: 'Bearer jwt', 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: 'O1' }) }))
}
function page(messages: any[], cursor = '') {
  return new Response(JSON.stringify({ ok: true, messages, response_metadata: { next_cursor: cursor } }))
}
const msg = { user: 'U2', ts: '100.000001', text: 'Project update' }
beforeEach(async () => {
  vi.clearAllMocks()
  rows = {
    memberships: [{ id: 'member', organization_id: 'O1', user_id: 'owner' }],
    connectors: [{ id: 'connector', organization_id: 'O1', user_id: 'owner', provider: 'slack', status: 'connected', scopes: ['channels:read', 'channels:history'], metadata: { team_id: 'T1', slack_user_id: 'U1', share_public: true } }],
    connector_sync_state: [{ connector_id: 'connector', state: { phase: 'history', cursor: '', users: { U2: { email: 'person@example.com', name: 'Person' } }, channels: [{ id: 'C1', name: 'Project', private: false }], index: 0, threads: {}, since: '0', until: '200', messages: 0, jobId: 'job' } }],
    sync_jobs: [{ id: 'job' }], contacts: [{ id: 'person', full_name: 'Person', company_id: 'company' }],
    companies: [{ id: 'company', organization_id: 'O1', normalized_domain: 'example.com' }],
  }
  harness.db = { from: query, auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) }, rpc: vi.fn((name: string) => {
    if (name === 'claim_connector_sync') return Promise.resolve({ data: true, error: null })
    if (name === 'get_oauth_tokens_server') return Promise.resolve({ data: [{ access_token: 'token' }], error: null })
    if (name === 'resolve_contact_identity') return { maybeSingle: async () => ({ data: { contact_id: 'person' }, error: null }) }
    return Promise.resolve({ data: null, error: null })
  }) }
  // Simulate the lease in this adapter, without weakening handler ownership checks.
  const rpc = harness.db.rpc
  harness.db.rpc = vi.fn((name: string, args: any) => {
    if (name === 'claim_connector_sync') rows.connector_sync_state[0].lease_id = args.p_lease_id
    return rpc(name, args)
  })
  harness.analyze.mockResolvedValue({ cognitive_profile_data: {} })
  harness.persist.mockResolvedValue({ profileId: 'profile' })
  vi.stubGlobal('Deno', { env: { get: () => 'https://example.test' }, serve: (handler: any) => { harness.handler = handler } })
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => url.includes('chat.getPermalink') ? new Response(JSON.stringify({ ok: true, permalink: 'https://test.slack.com/archives/C1/p100000001' })) : page([msg])))
  vi.resetModules()
  await import('./index')
})
describe('Slack synchronization handler', () => {
  it('rejects a different organization before reading tokens or Slack', async () => {
    rows.memberships = []
    expect((await call()).status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
    expect(harness.db.rpc).not.toHaveBeenCalled()
  })
  it('stores provenance and reuses identity and profile services for public messages', async () => {
    expect((await call()).status).toBe(200)
    expect(harness.analyze).toHaveBeenCalledTimes(1)
    expect(harness.persist).toHaveBeenCalledWith(harness.db, expect.objectContaining({ contactId: 'person', signalSource: 'slack', updatedFrom: ['slack'] }))
    expect(rows.communication_messages[0]).toMatchObject({ contact_id: 'person', body_text: null, source_owner_user_id: null, metadata: { company_id: 'company', slack_analyzed: true, team_id: 'T1', ts: msg.ts } })
  })
  it.each([true, false])('isolates private channels and unshared public channels (private=%s)', async isPrivate => {
    rows.connector_sync_state[0].state.channels[0].private = isPrivate
    rows.connectors[0].metadata.share_public = false
    await call()
    expect(harness.analyze).not.toHaveBeenCalled()
    expect(harness.persist).not.toHaveBeenCalled()
    expect(rows.communication_messages[0]).toMatchObject({ contact_id: null, source_owner_user_id: 'owner', body_text: null })
    expect(JSON.stringify(rows)).not.toContain(msg.text)
  })
  it('replaying a successful message does not duplicate storage or enrichment', async () => {
    const checkpoint = structuredClone(rows.connector_sync_state[0].state)
    await call()
    rows.connector_sync_state[0].state = checkpoint
    await call()
    expect(rows.communication_messages).toHaveLength(1)
    expect(harness.persist).toHaveBeenCalledTimes(1)
  })
  it('preserves pagination and resumes old threads on incremental synchronization', async () => {
    rows.connector_sync_state[0].state.threads = { C1: ['50.000001'] }
    rows.connector_sync_state[0].state.since = '90'
    rows.connector_sync_state[0].state.watermarks = { C1: '90' }
    vi.mocked(fetch).mockResolvedValueOnce(page([], 'next==')).mockResolvedValue(page([]))
    await call()
    expect(rows.connector_sync_state[0].state.cursor).toBe('next==')
    await call()
    expect(rows.connector_sync_state[0].state.phase).toBe('replies')
    await call()
    const [url, options] = vi.mocked(fetch).mock.calls.at(-1)!
    expect(url).toContain('conversations.replies')
    expect((options!.body as URLSearchParams).get('ts')).toBe('50.000001')
    expect((options!.body as URLSearchParams).get('oldest')).toBe('90')
  })
  it('does not advance the cursor or watermark on rate limits', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '60' } }))
    expect(await (await call()).json()).toMatchObject({ pending: true, retryAfter: 60 })
    expect(rows.connector_sync_state[0].state).toMatchObject({ cursor: '', since: '0', until: '200', index: 0 })
    await call()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('imports history for a newly joined channel after an earlier sync', async () => {
    rows.connector_sync_state[0].state.since = '90'
    rows.connector_sync_state[0].state.watermarks = { OTHER: '90' }
    await call()
    const [, options] = vi.mocked(fetch).mock.calls[0]!
    expect((options!.body as URLSearchParams).get('oldest')).toBe('0')
    expect(rows.connector_sync_state[0].state.watermarks.C1).toBe('200')
  })
  it('does not analyze the connected user as the recipient of an outbound message', async () => {
    vi.mocked(fetch).mockImplementation((url: any) => String(url).includes('chat.getPermalink') ? new Response(JSON.stringify({ ok: true, permalink: 'https://test.slack.com/archives/C1/p100000001' })) : page([{ ...msg, user: 'U1', text: '<@U2> Project update' }]))
    await call()
    expect(rows.communication_messages[0]).toMatchObject({ contact_id: 'person', direction: 'outbound' })
    expect(harness.analyze).not.toHaveBeenCalled()
  })
  it('requires reconnection after token revocation', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'token_revoked' })))
    expect((await call()).status).toBe(500)
    expect(rows.connectors[0].status).toBe('needs_reauth')
  })
})

describe('Slack OAuth handler', () => {
  beforeEach(async () => {
    await import('../connect-slack/index')
    rows.connector_oauth_states = [{ nonce: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', organization_id: 'O1', user_id: 'owner', provider: 'slack', expires_at: '2099-01-01T00:00:00Z' }]
  })
  const callback = () => harness.handler(new Request('https://example.test/connect?code=code&state=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'))
  it('consumes OAuth state once, including denied callbacks', async () => {
    const response = await harness.handler(new Request('https://example.test/connect?error=access_denied&state=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'))
    expect(response.status).toBe(302)
    expect(rows.connector_oauth_states).toHaveLength(0)
    expect((await callback()).status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects expired state without exchanging a token', async () => {
    rows.connector_oauth_states[0].expires_at = '2000-01-01T00:00:00Z'
    expect((await callback()).status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rechecks organization membership at callback time', async () => {
    rows.memberships = []
    expect((await callback()).status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not mark the connector connected if encrypted token storage fails', async () => {
    rows.connectors = []
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, team: { id: 'T1', name: 'Team' }, authed_user: { id: 'U1', access_token: 'private-token', scope: 'channels:read' } })))
    const rpc = harness.db.rpc
    harness.db.rpc = vi.fn((name: string, args: any) => name === 'store_oauth_tokens_server' ? Promise.resolve({ error: { message: 'Vault unavailable' } }) : rpc(name, args))
    expect((await callback()).status).toBe(302)
    expect(rows.connectors.every(row => row.status !== 'connected')).toBe(true)
    expect(JSON.stringify(rows)).not.toContain('private-token')
  })
  it('deletes local tokens and state even when Slack revocation fails', async () => {
    rows.oauth_accounts = [{ connector_id: 'connector', encrypted_access_token: 'ciphertext' }]
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    const response = await harness.handler(new Request('https://example.test/connect', { method: 'POST', headers: { Authorization: 'Bearer jwt', 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: 'O1', action: 'disconnect' }) }))
    expect(response.status).toBe(200)
    expect(rows.oauth_accounts).toHaveLength(0)
    expect(rows.connectors[0].status).toBe('disconnected')
    expect(rows.connector_sync_state[0].state).toEqual({})
  })
})
