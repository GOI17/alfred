import { describe, expect, it, vi } from 'vitest'
import { resolveMcpPermission, type McpPermissionContext } from '../src/shared/mcp-permissions.js'
import { executeMcpWithPermission } from '../src/server/mcp-permissions.js'

const conversationId = '00000000-0000-4000-8000-000000000001'
function context(overrides: Partial<McpPermissionContext> = {}): McpPermissionContext {
  return {
    serverId: 'generic-server', toolName: 'action', conversationId,
    mode: 'full-access', connected: true, verifiedReadOnly: false,
    grants: [{ serverId: 'generic-server', permission: 'allow', tools: {} }],
    ...overrides,
  }
}
const invocation = { serverId: 'generic-server', toolName: 'action', conversationId, arguments: { value: 1 } }

describe('generic MCP permissions', () => {
  it('does not authorize unconfigured servers through YOLO', () => {
    expect(resolveMcpPermission(context({ grants: [] }))).toBe('blocked')
    expect(resolveMcpPermission(context({ connected: false }))).toBe('blocked')
  })
  it('requires local read-only verification', () => {
    expect(resolveMcpPermission(context({ mode: 'read-only' }))).toBe('blocked')
    expect(resolveMcpPermission(context({ mode: 'read-only', verifiedReadOnly: true }))).toBe('allow')
  })
  it('asks in approval mode and allows ask grants in full access', () => {
    expect(resolveMcpPermission(context({ mode: 'approval' }))).toBe('ask')
    expect(resolveMcpPermission(context({ grants: [{ serverId: 'generic-server', permission: 'ask', tools: {} }] }))).toBe('allow')
  })
  it('honors conversation and tool restrictions', () => {
    const base = context()
    base.grants = [...base.grants, { serverId: 'generic-server', conversationId, permission: 'allow', tools: { action: 'blocked' } }]
    expect(resolveMcpPermission(base)).toBe('blocked')
  })
  it('fails closed for duplicate grants and blocked servers', () => {
    const base = context()
    expect(resolveMcpPermission({ ...base, grants: [...base.grants, ...base.grants] })).toBe('blocked')
    expect(resolveMcpPermission(context({ grants: [{ serverId: 'generic-server', permission: 'blocked', tools: { action: 'allow' } }] }))).toBe('blocked')
  })
  it('does not treat inherited object properties as permissions', () => {
    expect(resolveMcpPermission(context({ toolName: 'toString' }))).toBe('allow')
  })
})

describe('MCP execution gate', () => {
  it('executes allowed calls exactly once without approval', async () => {
    const execute = vi.fn().mockResolvedValue('ok')
    const approve = vi.fn()
    await expect(executeMcpWithPermission(invocation, new AbortController().signal, {
      context: () => context({ grants: [{ serverId: 'generic-server', permission: 'ask', tools: { action: 'ask' } }] }), revision: () => 1, approve, execute,
    })).resolves.toBe('ok')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(approve).not.toHaveBeenCalled()
  })
  it('rejects revoked approval and does not execute', async () => {
    let revision = 1
    const execute = vi.fn()
    await expect(executeMcpWithPermission(invocation, new AbortController().signal, {
      context: () => context({ mode: 'approval' }), revision: () => revision,
      approve: async () => { revision++; return true }, execute,
    })).rejects.toThrow('changed')
    expect(execute).not.toHaveBeenCalled()
  })
  it('rejects cancellation during approval', async () => {
    const controller = new AbortController()
    const execute = vi.fn()
    await expect(executeMcpWithPermission(invocation, controller.signal, {
      context: () => context({ mode: 'approval' }), revision: () => 1,
      approve: async () => { controller.abort(); return true }, execute,
    })).rejects.toThrow()
    expect(execute).not.toHaveBeenCalled()
  })
  it('binds execution to the original arguments', async () => {
    const execute = vi.fn().mockResolvedValue('ok')
    await executeMcpWithPermission(invocation, new AbortController().signal, {
      context: () => context({ mode: 'approval' }), revision: () => 1,
      approve: async (shown) => { shown.arguments.value = 99; return true }, execute,
    })
    expect(execute.mock.calls[0][0].arguments).toEqual({ value: 1 })
  })
  it('never retries a failed remote execution', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('Transport failed'))
    await expect(executeMcpWithPermission(invocation, new AbortController().signal, {
      context: () => context(), revision: () => 1, approve: vi.fn(), execute,
    })).rejects.toThrow('Transport failed')
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
