import { afterEach, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { generateText, type ModelMessage } from 'ai'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import { CopilotError, copilotHeaders, copilotSession } from '../src/server/copilot.js'
import { copilotModel, copilotModels } from '../src/server/copilot-model.js'
import { providerModels } from '../src/server/provider-models.js'
import { providerError } from '../src/server/provider-error.js'
import { WorkspaceService } from '../src/server/service.js'
import { gitFixture } from './fixtures.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const baseURL = 'https://api.business.githubcopilot.com'
const token = 'temporary-copilot-token'
const session = { token, baseURL }
const routes = [
  { id: 'gpt-5.4', endpoint: '/responses' },
  { id: 'claude-sonnet-4.6', endpoint: '/v1/messages' },
  { id: 'gemini-2.5-pro', endpoint: '/chat/completions' },
]
const catalog = routes.map(({ id, endpoint }) => ({ id, name: id, supported_endpoints: [endpoint], model_picker_enabled: true, policy: { state: 'enabled' }, capabilities: { type: 'chat', supports: { tool_calls: true, streaming: true } } }))
const usage = { input_tokens: 10, output_tokens: 2 }

function completion(endpoint: string, id: string, stream: boolean) {
  if (!stream) {
    if (endpoint === '/responses') return json({ id: 'response', model: id, output: [{ type: 'message', id: 'msg', role: 'assistant', content: [{ type: 'output_text', text: 'OK', annotations: [] }] }], usage })
    if (endpoint === '/v1/messages') return json({ id: 'msg', type: 'message', role: 'assistant', model: id, content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', stop_sequence: null, usage })
    return json({ id: 'chat', model: id, choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } })
  }
  const chunks = endpoint === '/responses' ? [
    { type: 'response.created', response: { id: 'response', model: id, created_at: 1 } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg' } },
    { type: 'response.output_text.delta', item_id: 'msg', output_index: 0, delta: 'OK' },
    { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg' } },
    { type: 'response.completed', response: { usage } },
  ] : endpoint === '/v1/messages' ? [
    { type: 'message_start', message: { id: 'msg', model: id, role: 'assistant', usage: { input_tokens: 10 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
    { type: 'message_stop' },
  ] : [
    { id: 'chat', model: id, choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] },
    { id: 'chat', model: id, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } },
  ]
  return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
}

function mockCopilot(models: unknown[] = catalog) {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = []
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    if (url === 'https://api.github.com/copilot_internal/v2/token') {
      expect(headers.get('Authorization')).toBe('Bearer test-github-token')
      return json({ token, endpoints: { api: baseURL } })
    }
    expect(headers.get('Authorization')).toBe(`Bearer ${token}`)
    expect(headers.get('Copilot-Integration-Id')).toBe(copilotHeaders['Copilot-Integration-Id'])
    expect(headers.get('X-GitHub-Api-Version')).toBe(copilotHeaders['X-GitHub-Api-Version'])
    if (url === `${baseURL}/models`) return json({ data: models })
    const body = JSON.parse(String(init?.body))
    requests.push({ url, headers, body })
    const route = routes.find((route) => route.id === body.model)
    if (!route || url !== `${baseURL}${route.endpoint}`) return json({ error: { code: 'unsupported_api_for_model', message: 'Wrong API' } }, 400)
    return completion(route.endpoint, route.id, body.stream === true)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { requests, fetchMock }
}

it.each(routes)('selects and streams $id through its advertised $endpoint API', async ({ id, endpoint }) => {
  const files = await gitFixture()
  cleanup.push(() => rm(files.root, { recursive: true, force: true }))
  const service = await WorkspaceService.open(join(files.root, 'data'))
  cleanup.push(() => service.close())
  const project = await service.addProject(files.repository)
  const conversation = await service.addConversation(project.id, files.repository)
  await service.store.update((db) => { db.providers.push({ id: 'copilot', model: 'gpt-4o', encryptedKey: service.vault.encrypt('test-github-token') }) })
  const app = Fastify()
  providerModels(app, service)
  cleanup.push(() => app.close())
  const { requests } = mockCopilot()
  const selected = await app.inject({ method: 'PUT', url: '/api/providers/copilot/model', payload: { model: id } })
  expect(selected.statusCode).toBe(200)
  await service.chat.start(conversation.id, 'Say OK', 'copilot')
  await expect.poll(() => service.state().agents[conversation.id]?.status).toBe('idle')
  expect(service.conversation(conversation.id).messages.map((message) => message.text)).toEqual(['Say OK', 'OK'])
  expect(requests).toHaveLength(1)
  expect(requests[0].url).toBe(`${baseURL}${endpoint}`)
  expect(requests[0].body).toMatchObject({ model: id, stream: true, tools: expect.any(Array) })
  expect(requests[0].headers.get('X-Initiator')).toBe('user')
  expect(requests[0].headers.get('Openai-Intent')).toBe('conversation-edits')
  expect(requests[0].headers.has('x-api-key')).toBe(false)
  if (endpoint === '/responses') expect(requests[0].body.store).toBe(false)
})

it.each(routes)('preserves tool continuations and vision headers for $id', async ({ id, endpoint }) => {
  const { requests } = mockCopilot()
  const model = await copilotModel('test-github-token', id)
  const messages: ModelMessage[] = [
    { role: 'user', content: [{ type: 'text', text: 'Inspect this image' }, { type: 'image', image: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }] },
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call_1', toolName: 'inspect', input: {} }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call_1', toolName: 'inspect', output: { type: 'text', value: 'Done' } }] },
  ]
  const result = await generateText({ model, messages, maxRetries: 0 })
  expect(result.text).toBe('OK')
  expect(requests[0].headers.get('X-Initiator')).toBe('agent')
  expect(requests[0].headers.get('Copilot-Vision-Request')).toBe('true')
  if (endpoint === '/responses') expect(requests[0].body.store).toBe(false)
})

it('keeps the catalog aligned with enabled, usable models and advertised APIs', async () => {
  mockCopilot([
    ...catalog, catalog[0], { id: 'broken', supported_endpoints: 'invalid' },
    { id: 'disabled', policy: { state: 'disabled' } }, { id: 'not-enabled', policy: { state: 'unconfigured' } },
    { id: 'hidden', model_picker_enabled: false }, { id: 'future-api', supported_endpoints: ['/future'] },
    { id: 'embedding', capabilities: { type: 'embeddings' } },
    { id: 'no-tools', capabilities: { type: 'chat', supports: { tool_calls: false } } },
    { id: 'no-stream', capabilities: { type: 'chat', supports: { streaming: false } } },
  ])
  expect(await copilotModels(session)).toEqual(routes.map((route) => ({ ...route, name: route.id })).sort((a, b) => a.name.localeCompare(b.name)))
  await expect(copilotModel('test-github-token', 'disabled')).rejects.toThrow('not enabled')
})

it('honors explicit Chat Completions metadata even for GPT-5 models', async () => {
  mockCopilot([{ id: 'gpt-5-test', supported_endpoints: ['/chat/completions'] }])
  expect(await copilotModels(session)).toEqual([{ id: 'gpt-5-test', name: 'gpt-5-test', endpoint: '/chat/completions' }])
})

it('uses legacy routing only when endpoint metadata is absent', async () => {
  mockCopilot([{ id: 'gpt-5.4' }, { id: 'gpt-5-mini' }, { id: 'claude-sonnet-4.6' }])
  expect(await copilotModels(session)).toEqual([
    { id: 'claude-sonnet-4.6', name: 'claude-sonnet-4.6', endpoint: '/v1/messages' },
    { id: 'gpt-5-mini', name: 'gpt-5-mini', endpoint: '/chat/completions' },
    { id: 'gpt-5.4', name: 'gpt-5.4', endpoint: '/responses' },
  ])
})

it('supports Individual catalogs that report enabled policies with all picker flags false', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ data: [
    { id: 'enabled', model_picker_enabled: false, policy: { state: 'enabled' } },
    { id: 'disabled', model_picker_enabled: false, policy: { state: 'disabled' } },
  ] })))
  expect((await copilotModels({ token, baseURL: 'https://api.individual.githubcopilot.com' })).map((model) => model.id)).toEqual(['enabled'])
  expect(await copilotModels(session)).toEqual([])
})

it.each([
  { data: { token, endpoints: { api: `${baseURL}/` } }, expected: baseURL },
  { data: { token: 'tid=test;proxy-ep=proxy.enterprise.githubcopilot.com;exp=123' }, expected: 'https://api.enterprise.githubcopilot.com' },
  { data: { token }, expected: 'https://api.individual.githubcopilot.com' },
])('uses the credential-specific service address', async ({ data, expected }) => {
  vi.stubGlobal('fetch', vi.fn(async () => json(data)))
  expect((await copilotSession('test-github-token')).baseURL).toBe(expected)
})

it('does not forward credentials to an untrusted service address', async () => {
  const fetchMock = vi.fn(async () => json({ token, endpoints: { api: 'https://githubcopilot.com.attacker.example' } }))
  vi.stubGlobal('fetch', fetchMock)
  await expect(copilotModel('test-github-token', 'gpt-5.4')).rejects.toThrow('invalid service address')
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('reports model rejection without claiming administrator approval is required or exposing upstream data', async () => {
  const { fetchMock } = mockCopilot()
  const model = await copilotModel('test-github-token', 'gpt-5.4')
  fetchMock.mockResolvedValue(json({ error: { code: 'model_not_supported', message: 'sensitive-upstream-data' } }, 400))
  let failure: unknown
  try { await generateText({ model, prompt: 'Hello', maxRetries: 0 }) } catch (error) { failure = error }
  expect(failure).toBeInstanceOf(CopilotError)
  expect(providerError(failure)).toContain('Refresh the model list')
  expect(providerError(failure)).not.toMatch(/sensitive-upstream-data|administrator/)
})
