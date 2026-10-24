import { expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { WorkspaceService } from '../src/server/service.js'
import { configureAgentAccess } from '../src/server/agent-access.js'
import type { SessionPort } from '../src/server/session-port.js'

it('delegates execution to the injected port without installing legacy tools or loading their settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-port-'))
  const session: SessionPort = {
    states: () => ({}), partials: () => ({}), isRunning: () => false,
    start: vi.fn(async () => {}), stop: vi.fn(async () => {}), resume: vi.fn(async () => {}),
    removeQueued: vi.fn(async () => {}), decide: vi.fn(), setPermission: vi.fn(async () => {}),
    setHarness: vi.fn(async () => {}), compact: vi.fn(async () => {}),
    stopProvider: vi.fn(async () => {}), close: vi.fn(async () => {}),
  }
  const service = await WorkspaceService.open(directory, undefined, () => ({
    session,
    describe: async () => ({ id: 'test-runtime', name: 'Test runtime',
      capabilities: { resume: true, cancel: true, compact: false, permissions: true },
      commands: [], skills: null, mcpServers: null }),
  }))
  const app = Fastify()
  try {
    await configureAgentAccess(app, service, directory)
    expect(service.chat).toBe(session)
    expect(service.adapter.legacyBindings).toBeUndefined()
    expect('capabilities' in session).toBe(false)
    expect((await app.inject('/api/conversations/test/agent-access')).statusCode).toBe(404)
    await service.chat.start('conversation', 'hello', 'openai')
    expect(session.start).toHaveBeenCalledExactlyOnceWith('conversation', 'hello', 'openai')
    expect(await service.adapter.describe()).toMatchObject({ skills: null, commands: [] })
    expect(service.state().agents).toEqual({})
  } finally {
    await app.close()
    await service.close()
    await rm(directory, { recursive: true, force: true })
  }
  expect(session.close).toHaveBeenCalledOnce()
})
