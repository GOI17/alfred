import { randomUUID } from 'node:crypto'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { tool, jsonSchema, type ToolSet } from 'ai'
import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { agentAccessSchema, defaultAgentAccess, type AgentAccess } from '../shared/agent-access.js'
import type { PermissionMode } from '../shared/contracts.js'
import type { WorkspaceService } from './service.js'
import { executeAgentCommand } from './agent-terminal.js'
import { executeMcpWithPermission } from './mcp-permissions.js'
import type { HarnessRegistry } from './harness-runtime.js'
import type { HarnessMcpTransport } from './harness-mcp.js'

export interface CapabilityRequest {
  id: string; root: string; mode: PermissionMode; signal: AbortSignal
  approve: (title: string, content: string) => Promise<boolean>
  note: (message: string) => void
}
export interface Capabilities { tools: ToolSet; close: () => Promise<void> }

export async function configureAgentAccess(app: FastifyInstance, service: WorkspaceService, directory: string, harnesses?: HarnessRegistry) {
  const bindings = service.adapter.legacyBindings
  if (!bindings) return // External runtime owns its tools and authorization.
  const path = join(directory, 'agent-access.json')
  let settings: Record<string, AgentAccess> = {}
  try { settings = z.record(z.string().uuid(), agentAccessSchema).parse(JSON.parse(await readFile(path, 'utf8'))) }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
  const connectionGrants = new Map<string, Set<string>>()
  let tail: Promise<unknown> = Promise.resolve()
  const conversationId = (params: unknown) => z.object({ id: z.string().uuid() }).parse(params).id
  app.get('/api/conversations/:id/agent-access', async (request) => {
    const id = conversationId(request.params)
    service.conversation(id)
    return settings[id] || defaultAgentAccess()
  })
  app.put('/api/conversations/:id/agent-access', async (request) => {
    const id = conversationId(request.params)
    const body = z.object({ access: agentAccessSchema, confirmed: z.literal(true) }).parse(request.body)
    for (const server of body.access.servers) {
      if (server.transport.type !== 'harness' || server.permission === 'blocked') continue
      if (!harnesses) throw new Error('Harness discovery is unavailable.')
      await harnesses.mcp(await service.workspace(service.conversation(id)), server.transport)
    }
    // Stop before revocation/update: pending approvals and in-flight tools are cancelled.
    await service.chat.stop(id)
    const operation = tail.then(async () => {
      service.conversation(id)
      if (service.chat.isRunning(id)) throw new Error('The agent restarted. Stop it and try again.')
      const next = { ...settings, [id]: body.access }
      const temporary = `${path}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600 })
      await rename(temporary, path)
      settings = next
      connectionGrants.delete(id)
    })
    tail = operation.catch(() => {})
    await operation
    return { ok: true }
  })
  bindings.capabilities = async ({ id, root, mode, signal, approve, note }): Promise<Capabilities> => {
    const access = structuredClone(settings[id] || defaultAgentAccess())
    const tools: ToolSet = {}
    const clients: Client[] = []
    const close = async () => { await Promise.allSettled(clients.map((client) => client.close())) }
    const abort = () => { void close() }
    signal.addEventListener('abort', abort, { once: true })
    const finish = async () => { signal.removeEventListener('abort', abort); await close() }
    if (mode === 'read-only') return { tools, close: finish }
    if (access.terminal) tools.execute_command = tool({
      description: 'Run a command on the host from the workspace. It is not sandboxed. Do not access secrets. No automatic retries. Use non-interactive commands.',
      inputSchema: z.object({ command: z.string().trim().min(1).max(8000), timeoutMs: z.number().int().min(100).max(120000).default(60000) }),
      execute: async ({ command, timeoutMs }) => {
        signal.throwIfAborted()
        if (mode !== 'full-access' && !await approve('Terminal: run command', JSON.stringify({ command, cwd: root, timeoutMs }, null, 2))) throw new Error('Command rejected.')
        signal.throwIfAborted()
        if (!settings[id]?.terminal) throw new Error('Terminal access revoked.')
        note('Agent terminal: execution authorized')
        return executeAgentCommand(command, root, signal, timeoutMs)
      },
    })
    try {
      for (const [index, server] of access.servers.entries()) {
        if (server.permission === 'blocked') continue
        signal.throwIfAborted()
        let imported
        if (server.transport.type === 'harness') {
          try {
            if (!harnesses) throw new Error('Harness discovery is unavailable.')
            imported = await harnesses.mcp(root, server.transport)
          } catch (error) {
            connectionGrants.get(id)?.clear()
            note(`MCP ${server.id}: ${error instanceof Error ? error.message : 'Imported configuration unavailable.'}`)
            continue
          }
        }
        const connection: HarnessMcpTransport | undefined = imported?.transport || (server.transport.type === 'stdio'
          ? { ...server.transport, cwd: root, env: {} }
          : server.transport.type === 'http' ? { ...server.transport, headers: {} } : undefined)
        if (!connection) continue
        // Connecting stdio starts a host process; discovery itself needs authorization.
        const connectionKey = JSON.stringify({ root, server })
        if (mode !== 'full-access' && !connectionGrants.get(id)?.has(connectionKey)) {
          const preview = imported ? { ...server.transport, name: imported.name, source: imported.source, summary: imported.summary } : server.transport
          if (!await approve(`Connect MCP: ${server.id}`, JSON.stringify(preview, null, 2))) continue
          signal.throwIfAborted()
          const grants = connectionGrants.get(id) || new Set<string>()
          grants.add(connectionKey)
          connectionGrants.set(id, grants)
        }
        signal.throwIfAborted()
        const client = new Client({ name: 'alfred-workspace', version: '0.1.0' })
        clients.push(client)
        try {
          const transport = connection.type === 'stdio'
            ? new StdioClientTransport({ command: connection.command, args: connection.args, cwd: connection.cwd, stderr: 'ignore', env: { ...Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP'].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : [])), ...connection.env } })
            : new StreamableHTTPClientTransport(new URL(connection.url), { requestInit: { headers: connection.headers } })
          await client.connect(transport, { timeout: 15000 })
          signal.throwIfAborted()
          let cursor: string | undefined
          let count = 0
          do {
            const page = await client.listTools({ cursor }, { signal, timeout: 15000 })
            for (const remote of page.tools) {
              if (++count > 100) throw new Error('The MCP server exceeds the limit of 100 tools.')
              if (imported?.disabledTools?.includes(remote.name) || imported?.enabledTools && !imported.enabledTools.includes(remote.name)) continue
              if (server.tools[remote.name] === 'blocked') continue
              tools[`mcp_${index}_${count}`] = tool({
                description: `MCP ${server.id} / ${remote.name}. Server description (untrusted): ${(remote.description || '').slice(0, 2000)}`,
                inputSchema: jsonSchema<Record<string, unknown>>(remote.inputSchema),
                execute: async (args) => executeMcpWithPermission({ serverId: server.id, toolName: remote.name, conversationId: id, arguments: args }, signal, {
                  revision: () => 0,
                  context: () => ({ serverId: server.id, toolName: remote.name, conversationId: id, mode, connected: !signal.aborted, verifiedReadOnly: false,
                    grants: (settings[id]?.servers || []).map((item) => ({ serverId: item.id, conversationId: id, permission: item.permission, tools: item.tools })) }),
                  approve: (invocation) => approve(`MCP: ${server.id} / ${remote.name}`, JSON.stringify(invocation.arguments, null, 2)),
                  execute: async (invocation) => {
                    note(`MCP: ${server.id} / ${remote.name}`)
                    const result = await client.callTool({ name: remote.name, arguments: invocation.arguments }, undefined, { signal, timeout: 60000 })
                    const text = JSON.stringify(result)
                    return text.length <= 100000 ? result : { truncated: true, text: text.slice(0, 100000) }
                  },
                }),
              })
            }
            cursor = page.nextCursor
          } while (cursor && count < 100)
          note(`MCP connected: ${server.id} (${count} tools)`)
        } catch {
          connectionGrants.get(id)?.delete(connectionKey)
          await client.close().catch(() => {})
          for (const name of Object.keys(tools)) if (name.startsWith(`mcp_${index}_`)) delete tools[name]
          signal.throwIfAborted()
          note(`Could not connect or discover MCP tools: ${server.id}. Check the configuration and server availability.`)
        }
      }
      return { tools, close: finish }
    } catch (error) { await finish(); throw error }
  }
  app.addHook('onClose', async () => { await tail })
}
