import { describe, expect, it, vi } from 'vitest'
import { agentAccessSchema, defaultAgentAccess, parseMcpServers } from '../src/shared/agent-access.js'
import { executeAgentCommand } from '../src/server/agent-terminal.js'

const server = { id: 'example', transport: { type: 'http', url: 'http://localhost:3000/mcp' }, permission: 'ask' }

describe('agent access configuration', () => {
  it('disables terminal and MCP by default', () => {
    expect(agentAccessSchema.parse({})).toEqual(defaultAgentAccess())
    expect(defaultAgentAccess()).toEqual({ terminal: false, servers: [] })
  })
  it('accepts both transports and per-tool overrides', () => {
    const value = agentAccessSchema.parse({ terminal: true, servers: [
      { ...server, tools: { dangerous: 'blocked', inspect: 'allow' } },
      { id: 'local', transport: { type: 'stdio', command: 'example-mcp', args: ['--stdio'] } },
    ] })
    expect(value.servers[0].tools.dangerous).toBe('blocked')
    expect(value.servers[1].permission).toBe('blocked')
  })
  it('rejects duplicate ids, invalid permissions and credential-bearing URLs', () => {
    expect(agentAccessSchema.safeParse({ servers: [server, server] }).success).toBe(false)
    expect(agentAccessSchema.safeParse({ servers: [{ ...server, permission: 'yolo' }] }).success).toBe(false)
    for (const url of ['file:///tmp/mcp', 'https://user:password@example.org/mcp', 'https://example.org/mcp?token=value', 'https://example.org/mcp#secret']) {
      expect(agentAccessSchema.safeParse({ servers: [{ ...server, transport: { type: 'http', url } }] }).success).toBe(false)
    }
  })
})

// These tests execute only fixed, non-interactive Node commands when run by the user.
const node = (source: string) => `"${process.execPath}" -e "${source}"`
describe('agent terminal', () => {
  it('returns output and exit code', async () => {
    const result = await executeAgentCommand(node('console.log(42);process.exitCode=7'), process.cwd(), new AbortController().signal)
    expect(result.output.trim()).toBe('42')
    expect(result.exitCode).toBe(7)
    expect(result.stopped).toBe(false)
  })
  it('does not spawn when already cancelled', () => {
    const controller = new AbortController()
    controller.abort()
    expect(() => executeAgentCommand(node('console.log(42)'), process.cwd(), controller.signal)).toThrow()
  })
  it('stops a command on timeout', async () => {
    const result = await executeAgentCommand(node('setInterval(()=>{},1000)'), process.cwd(), new AbortController().signal, 100)
    expect(result.stopped).toBe(true)
  })
  it('bounds output and stops the process', async () => {
    const result = await executeAgentCommand(node('process.stdout.write(String.fromCharCode(120).repeat(200000));setInterval(()=>{},1000)'), process.cwd(), new AbortController().signal)
    expect(result.truncated).toBe(true)
    expect(result.stopped).toBe(true)
    expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(100000)
  })
})


describe('MCP configuration imports', () => {
  const connections = { 'chrome-devtools': { command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] } }
  it('accepts common wrapper and named array configurations', () => {
    const expected = [{ id: 'chrome-devtools', transport: { type: 'stdio', ...connections['chrome-devtools'] }, permission: 'ask', tools: {} }]
    expect(parseMcpServers({ mcpServers: connections })).toEqual(expected)
    expect(parseMcpServers([connections])).toEqual(expected)
  })
  it('preserves internal permissions and handles empty configurations', () => {
    expect(parseMcpServers([{ ...server, permission: 'blocked' }])[0].permission).toBe('blocked')
    expect(parseMcpServers([])).toEqual([])
    expect(parseMcpServers({ mcpServers: {} })).toEqual([])
  })
  it('imports Streamable HTTP connections', () => {
    expect(parseMcpServers({ mcpServers: { remote: { url: 'https://example.org/mcp' } } })[0].transport.type).toBe('http')
  })
  it('rejects duplicate names and unsupported options rather than dropping them', () => {
    expect(() => parseMcpServers([connections, connections])).toThrow()
    expect(() => parseMcpServers({ mcpServers: { local: { command: 'npx', env: { KEY: 'value' } } } })).toThrow()
    expect(() => parseMcpServers({ mcpServers: { remote: { url: 'https://example.org/?token=value' } } })).toThrow()
  })
})

it('remembers MCP connection consent per conversation and invalidates it on settings save', async () => {
  const { default: Fastify } = await import('fastify')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { configureAgentAccess } = await import('../src/server/agent-access.js')
  const { WorkspaceService } = await import('../src/server/service.js')
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { randomUUID } = await import('node:crypto')
  const directory = await mkdtemp(join(tmpdir(), 'alfred-access-test-'))
  const app = Fastify()
  const service = await WorkspaceService.open(directory)
  const id = randomUUID()
  const conversation = vi.spyOn(service, 'conversation').mockImplementation(() => ({ id }) as ReturnType<typeof service.conversation>)
  const connect = vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined)
  const list = vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({ tools: [] })
  const close = vi.spyOn(Client.prototype, 'close').mockResolvedValue(undefined)
  try {
    await configureAgentAccess(app, service, directory)
    const save = async () => {
      const result = await app.inject({ method: 'PUT', url: `/api/conversations/${id}/agent-access`, payload: { confirmed: true, access: { servers: [server] } } })
      expect(result.statusCode).toBe(200)
    }
    await save()
    const fullAccessApproval = vi.fn(async () => false)
    const fullAccess = await service.adapter.legacyBindings!.capabilities!({ id, root: directory, mode: 'full-access', signal: new AbortController().signal, approve: fullAccessApproval, note: () => {} })
    await fullAccess.close()
    expect(fullAccessApproval).not.toHaveBeenCalled()
    expect(connect).toHaveBeenCalledTimes(1)
    connect.mockClear()
    const approve = vi.fn(async () => true)
    const run = async () => {
      const result = await service.adapter.legacyBindings!.capabilities!({ id, root: directory, mode: 'approval', signal: new AbortController().signal, approve, note: () => {} })
      await result.close()
    }
    await run()
    await run()
    expect(approve).toHaveBeenCalledTimes(1)
    expect(connect).toHaveBeenCalledTimes(2)
    await save()
    await run()
    expect(approve).toHaveBeenCalledTimes(2)
  } finally {
    conversation.mockRestore(); connect.mockRestore(); list.mockRestore(); close.mockRestore()
    await app.close(); await service.close(); await rm(directory, { recursive: true, force: true })
  }
})
