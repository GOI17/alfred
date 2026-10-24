import { afterEach, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { copilotRoutes, copilotToken } from '../src/server/copilot.js'
import { providerModels } from '../src/server/provider-models.js'
import type { WorkspaceService } from '../src/server/service.js'

const apps: ReturnType<typeof Fastify>[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function setup() {
  const db = { providers: [{ id: 'opencode', model: 'test-model', encryptedKey: 'encrypted' }] as { id: string; model: string; encryptedKey: string }[] }
  const service = {
    store: { get: () => db, update: async (update: (data: typeof db) => void) => update(db) },
    vault: { decrypt: () => 'test-key', encrypt: () => 'encrypted' },
    changed: vi.fn(),
  } as unknown as WorkspaceService
  const app = Fastify()
  apps.push(app)
  copilotRoutes(app, service)
  providerModels(app, service)
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  return { app, db, fetchMock }
}
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })

it('loads and deduplicates the OpenCode Zen catalog', async () => {
  const { app, fetchMock } = setup()
  fetchMock.mockResolvedValue(json({ data: [{ id: 'test-model' }, { id: 'test-model' }, { id: 'claude-test', name: 'Claude' }] }))
  const result = await app.inject('/api/providers/opencode/models')
  expect(result.statusCode).toBe(200)
  expect(result.json()).toHaveLength(2)
  expect(String(fetchMock.mock.calls[0][0])).toBe('https://opencode.ai/zen/v1/models')
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test-key')
})
it('completes GitHub device authorization without returning tokens', async () => {
  const { app, db, fetchMock } = setup()
  let now = 100000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  fetchMock.mockResolvedValueOnce(json({ device_code: 'private-device-code', user_code: 'ABCD-EFGH', expires_in: 900, interval: 5 }))
  const start = await app.inject({ method: 'POST', url: '/api/copilot/authorize' })
  expect(start.statusCode).toBe(200)
  expect(start.body).not.toContain('private-device-code')
  const poll = { method: 'POST' as const, url: '/api/copilot/poll', payload: { id: start.json().id } }
  expect((await app.inject(poll)).json()).toEqual({ connected: false })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  now += 5000
  fetchMock.mockResolvedValueOnce(json({ access_token: 'private-github-token' }))
  fetchMock.mockResolvedValueOnce(json({ token: 'private-copilot-token' }))
  const result = await app.inject(poll)
  expect(result.json()).toEqual({ connected: true })
  expect(db.providers.find((p) => p.id === 'copilot')).toEqual({ id: 'copilot', model: 'gpt-4o', encryptedKey: 'encrypted' })
  expect((await app.inject(poll)).statusCode).toBe(500)
})
it('exchanges credentials and filters Copilot models to chat models', async () => {
  const { app, db, fetchMock } = setup()
  db.providers.push({ id: 'copilot', model: 'gpt-4o', encryptedKey: 'encrypted' })
  fetchMock.mockResolvedValueOnce(json({ token: 'temporary-copilot-token' }))
  fetchMock.mockResolvedValueOnce(json({ data: [
    { id: 'gpt-4o', name: 'GPT-4o', capabilities: { type: 'chat' } },
    { id: 'embedding', capabilities: { type: 'embeddings' } },
  ] }))
  const result = await app.inject('/api/providers/copilot/models')
  expect(result.json()).toEqual([{ id: 'gpt-4o', name: 'GPT-4o' }])
  expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer temporary-copilot-token')
})
it('reports Copilot authorization failure without leaking upstream details', async () => {
  const { fetchMock } = setup()
  fetchMock.mockResolvedValue(new Response('private upstream details', { status: 403 }))
  await expect(copilotToken('test-token')).rejects.toThrow('Could not authorize Copilot')
})
