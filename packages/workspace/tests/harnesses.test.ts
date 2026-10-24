import { afterEach, expect, it, vi } from 'vitest'
import { chmod, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { MockLanguageModelV4 } from 'ai/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { gitFixture } from './fixtures.js'
import { discoverHarnesses } from '../src/server/harness-discovery.js'
import { HarnessRegistry, expandTemplate } from '../src/server/harness-runtime.js'
import { parseHarnessMcp } from '../src/server/harness-mcp.js'
import { createApp } from '../src/server/app.js'
import type { HarnessCatalog } from '../src/shared/harnesses.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const action of cleanup.splice(0).reverse()) await action() })
async function fixture() {
  const files = await gitFixture()
  cleanup.push(() => rm(files.root, { recursive: true, force: true }))
  const home = join(files.root, 'home'), bin = join(home, 'bin')
  await mkdir(bin, { recursive: true })
  const put = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text) }
  const options = { home, env: { PATH: bin, TEST_MCP_KEY: 'synthetic-private-secret' } }
  const scan = () => discoverHarnesses(files.repository, options)
  return { ...files, home, bin, put, options, scan }
}

it('discovers all four harnesses, real formats, scoped overrides and source paths without executing a CLI', async () => {
  const f = await fixture()
  await f.put(join(f.bin, 'codex'), '#!/bin/sh\nexit 99\n')
  await chmod(join(f.bin, 'codex'), 0o700)
  await f.put(join(f.home, '.agents/skills/shared/SKILL.md'), '---\nname: shared\ndescription: |\n  Shared multiline\n  description\n---\nUse the shared skill.')
  await f.put(join(f.home, '.codex/config.toml'), '[mcp_servers.docs]\nurl="https://example.invalid/mcp"\nbearer_token_env_var="TEST_MCP_KEY"\n')
  await f.put(join(f.home, '.codex/agents/reviewer.toml'), 'name="reviewer"\ndescription="Review code"\ndeveloper_instructions="""Find regressions."""\n')
  await f.put(join(f.home, '.claude/commands/review.md'), 'Global review $ARGUMENTS')
  await f.put(join(f.repository, '.claude/commands/review.md'), '---\ndescription: Local review\n---\nProject review $ARGUMENTS')
  await f.put(join(f.repository, '.claude/agents/qa.md'), '---\nname: qa\ndescription: QA role\n---\nCheck the implementation.')
  await f.put(join(f.repository, '.mcp.json'), JSON.stringify({ mcpServers: { local: { command: 'example-mcp', env: { SECRET: '${TEST_MCP_KEY}' } } } }))
  await f.put(join(f.repository, 'opencode.jsonc'), '{ // supported JSONC\n "command": {"lint":{"template":"Check $1"}}, "agent":{"architect":{"prompt":"Design first"}}, "mcp":{"remote":{"type":"remote","url":"https://example.invalid/mcp","oauth":false}}, }')
  await f.put(join(f.home, '.pi/agent/prompts/summary.md'), '---\ndescription: Summarize\n---\nSummarize $@')
  await f.put(join(f.repository, 'AGENTS.md'), 'Root instructions')
  const { catalog } = await f.scan()
  expect(catalog.harnesses.find((item) => item.id === 'codex')?.installed).toBe(true)
  expect(catalog.harnesses.find((item) => item.id === 'claude')?.installed).toBe(false)
  for (const [harness, kind, name] of [['codex', 'agent', 'reviewer'], ['claude', 'agent', 'qa'], ['opencode', 'command', 'lint'], ['opencode', 'agent', 'architect'], ['pi', 'command', 'summary']]) {
    expect(catalog.resources.some((item) => item.harness === harness && item.kind === kind && item.name === name)).toBe(true)
  }
  const reviews = catalog.resources.filter((item) => item.harness === 'claude' && item.kind === 'command')
  expect(reviews.find((item) => item.scope === 'user')?.shadowedBy).toBe(reviews.find((item) => item.scope === 'workspace')?.id)
  expect(reviews.find((item) => item.scope === 'workspace')?.invocation).toBe('/claude:review')
  expect(catalog.resources.find((item) => item.name === 'shared')?.description).toContain('Shared multiline\ndescription')
  expect(JSON.stringify(catalog)).not.toContain('synthetic-private-secret')
  expect(catalog.issues).toEqual([])
})

it('respects custom config directories and keeps independent workspaces isolated', async () => {
  const f = await fixture()
  const custom = join(f.home, 'custom-codex')
  await f.put(join(custom, 'prompts/check.md'), 'Custom prompt')
  await f.put(join(f.repository, '.agents/skills/local/SKILL.md'), 'Local only')
  const other = join(f.root, 'other')
  await mkdir(other)
  const options = { home: f.home, env: { ...f.options.env, CODEX_HOME: custom } }
  const first = await discoverHarnesses(f.repository, options)
  const second = await discoverHarnesses(other, options)
  expect(first.catalog.resources.some((item) => item.name === 'check')).toBe(true)
  expect(first.catalog.resources.some((item) => item.name === 'local')).toBe(true)
  expect(second.catalog.resources.some((item) => item.name === 'local')).toBe(false)
})

it('reports malformed files and runtime-only commands while rejecting symlink escapes and secret aliases', async () => {
  const f = await fixture()
  await f.put(join(f.repository, 'opencode.json'), '{invalid')
  await f.put(join(f.repository, '.claude/commands/bad.md'), '---\nname: [broken\n---\nNever load')
  await f.put(join(f.repository, '.claude/commands/dynamic.md'), 'Run !`touch SHOULD_NOT_RUN`')
  await f.put(join(f.home, 'outside/SKILL.md'), 'outside-private-content')
  await mkdir(join(f.repository, '.agents/skills'), { recursive: true })
  await symlink(join(f.home, 'outside'), join(f.repository, '.agents/skills/escape'))
  await f.put(join(f.home, '.codex/auth.json'), 'synthetic-credentials')
  await mkdir(join(f.home, '.agents/skills/alias'), { recursive: true })
  await symlink(join(f.home, '.codex/auth.json'), join(f.home, '.agents/skills/alias/SKILL.md'))
  const scan = await f.scan()
  expect(scan.catalog.issues.length).toBeGreaterThanOrEqual(3)
  expect(scan.catalog.resources.find((item) => item.name === 'dynamic')?.usable).toBe(false)
  expect(JSON.stringify([...scan.entries])).not.toContain('outside-private-content')
  expect(JSON.stringify([...scan.entries])).not.toContain('synthetic-credentials')
})

it('refreshes changed and deleted resources and invalidates changed imported MCP grants', async () => {
  const f = await fixture()
  const source = join(f.repository, '.mcp.json')
  await f.put(source, JSON.stringify({ mcpServers: { test: { command: 'first-mcp' } } }))
  const registry = new HarnessRegistry(f.options)
  const catalog = (await registry.scan(f.repository)).catalog
  const resource = catalog.resources.find((item) => item.kind === 'mcp')!
  const reference = { harness: resource.harness, resourceId: resource.id, fingerprint: resource.fingerprint }
  expect((await registry.mcp(f.repository, reference)).transport?.type).toBe('stdio')
  await f.put(source, JSON.stringify({ mcpServers: { test: { command: 'changed-mcp' } } }))
  await expect(registry.mcp(f.repository, reference)).rejects.toThrow('configuration changed')
  await rm(source)
  await expect(registry.mcp(f.repository, reference)).rejects.toThrow('unavailable')
  expect((await registry.scan(f.repository, true)).catalog.resources.filter((item) => item.kind === 'mcp')).toEqual([])
})

it('expands quoted and positional prompt arguments without running shell input', () => {
  expect(expandTemplate('$1|$2|$ARGUMENTS[0]|${3:-fallback}|${@:2:1}', '"first value" second')).toBe('first value|second|first value|fallback|second')
  expect(expandTemplate('$ARGUMENTS', '$(touch marker)')).toBe('$(touch marker)')
  expect(expandTemplate('Review', 'scope')).toBe('Review\n\nscope')
  expect(() => expandTemplate('$1', '"unfinished')).toThrow('unfinished')
})

it('honors disabled skills, user-only invocation and bounded skill references', async () => {
  const f = await fixture()
  const bundle = join(f.repository, '.claude/skills/manual')
  await f.put(join(bundle, 'SKILL.md'), '---\nname: manual\ndisable-model-invocation: true\n---\nOnly run when requested.')
  await f.put(join(bundle, 'references/check.md'), 'Expected reference content')
  await f.put(join(bundle, '.env'), 'synthetic-hidden-value')
  await f.put(join(f.home, 'private.md'), 'outside content')
  await symlink(join(f.home, 'private.md'), join(bundle, 'references/private.md'))
  await f.put(join(f.repository, '.claude/skills/background/SKILL.md'), '---\nname: background\nuser-invocable: false\n---\nBackground context.')
  await f.put(join(f.repository, '.claude/skills/off/SKILL.md'), 'Disabled context.')
  await f.put(join(f.repository, '.claude/settings.local.json'), '{"skillOverrides":{"off":"off"}}')
  const codexSkill = join(f.repository, '.agents/skills/disabled')
  await f.put(join(codexSkill, 'SKILL.md'), 'Do not load this skill.')
  await f.put(join(f.home, '.codex/config.toml'), `[[skills.config]]\npath = ${JSON.stringify(codexSkill)}\nenabled = false`)
  const registry = new HarnessRegistry(f.options)
  const scan = await registry.scan(f.repository)
  const skill = scan.catalog.resources.find((item) => item.harness === 'claude' && item.name === 'manual')!
  expect(scan.catalog.resources.find((item) => item.harness === 'codex' && item.name === 'disabled')?.usable).toBe(false)
  expect(scan.catalog.resources.find((item) => item.harness === 'claude' && item.name === 'off')?.usable).toBe(false)
  expect(scan.catalog.resources.find((item) => item.harness === 'claude' && item.name === 'background')?.invocation).toBeUndefined()
  const selection = { id: 'claude' as const, instructions: true }
  const signal = new AbortController().signal
  const options = { toolCallId: 'harness-read', messages: [], context: {} }
  const before = await registry.context(f.repository, selection, 'Review the project', signal)
  expect(before.instructions).not.toContain('manual')
  await expect(before.tools.read_harness_resource.execute!({ id: skill.id }, options)).rejects.toThrow('explicit user invocation')
  const invoked = await registry.context(f.repository, selection, skill.invocation!, signal)
  expect(invoked.prompt).toContain('Only run when requested.')
  expect(await invoked.tools.read_harness_file.execute!({ id: skill.id, path: 'references/check.md' }, options)).toBe('Expected reference content')
  for (const path of ['../background/SKILL.md', '.env', 'references/private.md']) await expect(invoked.tools.read_harness_file.execute!({ id: skill.id, path }, options)).rejects.toThrow()
  await expect(registry.context(f.repository, selection, '/skill:claude:background', signal)).rejects.toThrow('no longer exists')
  await expect(registry.context(f.repository, selection, '/skill:claude:off', signal)).rejects.toThrow('no longer exists')
})

it('normalizes MCP environments and headers without silently dropping unsupported options', () => {
  const parsed = parseHarnessMcp('codex', { url: 'https://example.invalid/mcp', bearer_token_env_var: 'TOKEN', env_http_headers: { 'X-Key': 'KEY' } }, '/workspace', { TOKEN: 'bearer-secret', KEY: 'header-secret' })
  expect(parsed.transport).toEqual({ type: 'http', url: 'https://example.invalid/mcp', headers: { Authorization: 'Bearer bearer-secret', 'X-Key': 'header-secret' } })
  expect(parsed.summary).not.toContain('secret')
  expect(parseHarnessMcp('claude', { command: 'mcp', env: { KEY: '${MISSING}' } }, '/workspace', {}).reason).toContain('Missing environment variable')
  expect(parseHarnessMcp('opencode', { type: 'remote', url: 'https://example.invalid', oauth: {} }, '/workspace', {}).reason).toContain('OAuth')
  expect(parseHarnessMcp('claude', { command: 'mcp', unknownOption: true }, '/workspace', {}).reason).toContain('Unsupported MCP options')
  expect(parseHarnessMcp('claude', { command: 'mcp', enabled: false }, '/workspace', {}).reason).toContain('Disabled')
})

async function server() {
  const f = await fixture()
  const model = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({ start(controller) {
    controller.enqueue({ type: 'text-start', id: 'reply' })
    controller.enqueue({ type: 'text-delta', id: 'reply', delta: 'Finished.' })
    controller.enqueue({ type: 'text-end', id: 'reply' })
    controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 } } })
    controller.close()
  } }) }) })
  const { app, service } = await createApp({ directory: join(f.root, 'data'), token: 'harness-test-only', serve: false, model, harnessEnvironment: f.options })
  cleanup.push(() => app.close())
  const project = await service.addProject(f.repository)
  const conversation = await service.addConversation(project.id, f.repository)
  const response = await app.inject({ method: 'POST', url: '/api/auth', payload: { code: 'harness-test-only' } })
  const cookie = response.cookies.map((item) => `${item.name}=${item.value}`).join('; ')
  const request = (method: 'GET' | 'PUT' | 'POST', path: string, payload?: unknown) => app.inject({ method, url: `/api/conversations/${conversation.id}/${path}`, headers: { cookie }, ...(payload === undefined ? {} : { payload: JSON.stringify(payload), headers: { cookie, 'content-type': 'application/json' } }) })
  return { ...f, app, service, conversation, model, request }
}

it('uses selected instructions, commands and profiles in real chat turns, persists selection and preserves read-only permissions', async () => {
  const f = await server()
  await f.put(join(f.repository, 'AGENTS.md'), 'Always explain tradeoffs.')
  await f.put(join(f.repository, '.opencode/commands/check.md'), 'Inspect $1 with $2.')
  await f.put(join(f.repository, '.opencode/agents/reviewer.md'), '---\nname: reviewer\n---\nFind regressions first.')
  await f.put(join(f.repository, '.opencode/skills/testing/SKILL.md'), '---\nname: testing\ndescription: Test changes\n---\nUse focused tests.')
  const catalog: HarnessCatalog = (await f.request('GET', 'harnesses')).json()
  const agent = catalog.resources.find((item) => item.harness === 'opencode' && item.kind === 'agent')!
  expect((await f.app.inject({ url: `/api/conversations/${f.conversation.id}/harnesses` })).statusCode).toBe(401)
  expect((await f.request('PUT', 'harness', { selection: { id: 'opencode', agent: agent.id, instructions: true } })).statusCode).toBe(200)
  await f.service.chat.setPermission(f.conversation.id, 'read-only')
  await f.service.chat.start(f.conversation.id, '/opencode:check "API routes" tests', 'openai')
  await expect.poll(() => f.service.chat.isRunning(f.conversation.id)).toBe(false)
  const call = f.model.doStreamCalls[0]
  expect(JSON.stringify(call.prompt)).toContain('Always explain tradeoffs.')
  expect(JSON.stringify(call.prompt)).toContain('Find regressions first.')
  expect(JSON.stringify(call.prompt)).toContain('Inspect API routes with tests.')
  expect(JSON.stringify(call.tools)).toContain('read_harness_resource')
  expect(JSON.stringify(call.tools)).not.toContain('write_file')
  expect(JSON.stringify(call.tools)).not.toContain('execute_command')
  const disk = JSON.parse(await readFile(join(f.root, 'data/workspace.json'), 'utf8'))
  expect(disk.conversations[0].harness.agent).toBe(agent.id)
  expect(disk.conversations[0].messages[0].text).toBe('/opencode:check "API routes" tests')
})

it('imports MCP references without exposing credentials and discovers tools only on an authorized run', async () => {
  const f = await server()
  await f.put(join(f.repository, '.mcp.json'), JSON.stringify({ mcpServers: { remote: { type: 'http', url: 'https://example.invalid/mcp', headers: { Authorization: 'Bearer synthetic-private-secret' } } } }))
  const connect = vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined)
  const list = vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({ tools: [{ name: 'inspect', inputSchema: { type: 'object' } }] })
  vi.spyOn(Client.prototype, 'close').mockResolvedValue(undefined)
  const response = await f.request('GET', 'harnesses')
  expect(response.body).not.toContain('synthetic-private-secret')
  const catalog: HarnessCatalog = response.json()
  const resource = catalog.resources.find((item) => item.kind === 'mcp')!
  const preview = await f.request('GET', `harnesses/resources/${resource.id}`)
  expect(preview.body).not.toContain('synthetic-private-secret')
  const access = { servers: [{ id: 'imported', permission: 'ask', transport: { type: 'harness', harness: resource.harness, resourceId: resource.id, fingerprint: resource.fingerprint } }] }
  expect((await f.request('PUT', 'agent-access', { confirmed: true, access })).statusCode).toBe(200)
  expect(connect).not.toHaveBeenCalled()
  expect((await f.request('GET', 'agent-access')).body).not.toContain('synthetic-private-secret')
  const approve = vi.fn(async () => true)
  const capabilities = await f.service.adapter.legacyBindings!.capabilities!({ id: f.conversation.id, root: f.repository, mode: 'approval', signal: new AbortController().signal, approve, note: () => {} })
  expect(approve).toHaveBeenCalledOnce()
  expect(JSON.stringify(approve.mock.calls)).not.toContain('synthetic-private-secret')
  expect(connect).toHaveBeenCalledOnce()
  expect(list).toHaveBeenCalledOnce()
  expect(Object.keys(capabilities.tools)).toHaveLength(1)
  await capabilities.close()
  await f.put(join(f.repository, '.mcp.json'), JSON.stringify({ mcpServers: { remote: { type: 'http', url: 'https://changed.invalid/mcp' } } }))
  const note = vi.fn()
  const changed = await f.service.adapter.legacyBindings!.capabilities!({ id: f.conversation.id, root: f.repository, mode: 'full-access', signal: new AbortController().signal, approve, note })
  expect(Object.keys(changed.tools)).toHaveLength(0)
  expect(connect).toHaveBeenCalledOnce()
  expect(JSON.stringify(note.mock.calls)).toContain('configuration changed')
  await changed.close()
})
