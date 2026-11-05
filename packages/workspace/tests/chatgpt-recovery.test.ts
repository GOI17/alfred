import { afterEach, expect, it, vi } from 'vitest'
import { ChatgptOAuth } from '../src/server/chatgpt-oauth.js'
import type { Store } from '../src/server/store.js'
import type { Vault } from '../src/server/vault.js'

// In-memory test doubles only; no real credentials or network access.
afterEach(() => vi.unstubAllGlobals())
function setup() {
  const credentials = {
    access_token: 'old-test-token', refresh_token: 'test-refresh',
    token_type: 'Bearer', expires_in: 3600, expiresAt: Date.now() + 3_600_000,
    scope: 'chatgpt.tokens.use.direct',
  }
  const account = {
    id: 'test', clientId: 'test-client', subject: 'test-subject',
    email: 'test@example.invalid', model: 'test-model', welcomed: true,
    encryptedTokens: JSON.stringify(credentials),
  }
  const db = { chatgptAccounts: [account], activeChatgptAccount: account.id }
  const store = {
    get: () => db,
    update: async (change: (data: typeof db) => void) => { change(db) },
  } as unknown as Store
  const vault = { encrypt: (s: string) => s, decrypt: (s: string) => s } as unknown as Vault
  const oauth = new ChatgptOAuth(store, vault, () => {})
  let refreshes = 0
  const requests: Request[] = []
  const install = (respond: (request: Request) => Response | Promise<Response>, refreshStatus = 200) => {
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      if (request.url.endsWith('/oauth/token')) {
        refreshes++
        return Response.json({ ...credentials, access_token: 'new-test-token' }, { status: refreshStatus })
      }
      requests.push(request)
      return respond(request)
    })
  }
  return { oauth, account, credentials, install, requests, refreshes: () => refreshes }
}
const catalog = () => Response.json({ models: [] })

it('refreshes once for concurrent 401s and reuses the renewed token', async () => {
  const test = setup()
  test.install((request) => request.headers.get('Authorization') === 'Bearer old-test-token'
    ? new Response(null, { status: 401 }) : catalog())
  await Promise.all([test.oauth.models(), test.oauth.models()])
  expect(test.refreshes()).toBe(1)
  expect(test.requests).toHaveLength(4)
  await test.oauth.models()
  expect(test.refreshes()).toBe(1)
  expect(test.requests.at(-1)?.headers.get('Authorization')).toBe('Bearer new-test-token')
})

it('stops after one authentication retry', async () => {
  const test = setup()
  test.install(() => new Response(null, { status: 401 }))
  await expect(test.oauth.models()).rejects.toThrow('Could not load')
  expect(test.refreshes()).toBe(1)
  expect(test.requests).toHaveLength(2)
})

it.each([403, 429, 500])('does not refresh for HTTP %s', async (status) => {
  const test = setup()
  test.install(() => new Response(null, { status }))
  await expect(test.oauth.models()).rejects.toThrow('Could not load')
  expect(test.refreshes()).toBe(0)
  expect(test.requests).toHaveLength(1)
})

it('does not retry ambiguous network failures', async () => {
  const test = setup()
  test.install(() => { throw new TypeError('Network failure') })
  await expect(test.oauth.models()).rejects.toThrow('Network failure')
  expect(test.refreshes()).toBe(0)
  expect(test.requests).toHaveLength(1)
})

it('surfaces failed renewal without resending the model request', async () => {
  const test = setup()
  test.install(() => new Response(null, { status: 401 }), 400)
  await expect(test.oauth.models()).rejects.toThrow('Reconnect your account')
  expect(test.refreshes()).toBe(1)
  expect(test.requests).toHaveLength(1)
})

it('updates credentials for an existing model and preserves the POST on retry', async () => {
  const test = setup()
  const model = await test.oauth.model()
  if (typeof model !== 'object') throw new Error('Expected a model instance')
  test.account.encryptedTokens = JSON.stringify({ ...test.credentials, expiresAt: 0 })
  test.install(() => Response.json({ error: { message: 'test rejection' } }, { status: 401 }))
  await expect(model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Continue' }] }],
  })).rejects.toThrow()
  // Proactive expiry refresh, then one bounded refresh for the rejected token.
  expect(test.refreshes()).toBe(2)
  expect(test.requests).toHaveLength(2)
  expect(test.requests[0].headers.get('Authorization')).toBe('Bearer new-test-token')
  expect(test.requests[1].headers.get('Authorization')).toBe('Bearer new-test-token')
  expect(test.requests[0].method).toBe('POST')
  expect(await test.requests[0].text()).toBe(await test.requests[1].text())
})

it('does not send a request for an already aborted model call', async () => {
  const test = setup()
  const model = await test.oauth.model()
  if (typeof model !== 'object') throw new Error('Expected a model instance')
  test.install(() => catalog())
  const controller = new AbortController()
  controller.abort()
  await expect(model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Continue' }] }],
    abortSignal: controller.signal,
  })).rejects.toThrow()
  expect(test.requests).toHaveLength(0)
  expect(test.refreshes()).toBe(0)
})
