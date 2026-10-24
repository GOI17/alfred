import { z } from 'zod'
import { mcpPermissionSchema } from './mcp-permissions.js'
import { harnessIdSchema, resourceIdSchema } from './harnesses.js'

export const mcpServerSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
  transport: z.discriminatedUnion('type', [
    z.object({ type: z.literal('stdio'), command: z.string().min(1).max(1000), args: z.array(z.string().max(2000)).max(50).default([]) }),
    z.object({ type: z.literal('http'), url: z.string().url().max(4000).refine((value) => {
      const url = new URL(value)
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
    }, 'Use an HTTP(S) URL without credentials or parameters.') }),
    z.object({ type: z.literal('harness'), harness: harnessIdSchema, resourceId: resourceIdSchema, fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }),
  ]),
  permission: mcpPermissionSchema.default('blocked'),
  tools: z.record(z.string().max(200), mcpPermissionSchema).default({}),
})
export const agentAccessSchema = z.object({
  terminal: z.boolean().default(false),
  servers: z.array(mcpServerSchema).max(10).default([]),
}).refine((value) => new Set(value.servers.map((server) => server.id)).size === value.servers.length, 'MCP IDs must be unique.')
export type AgentAccess = z.infer<typeof agentAccessSchema>
export const defaultAgentAccess = (): AgentAccess => ({ terminal: false, servers: [] })

// Import connection conventions without silently dropping unsupported credentials/options.
const importedConnectionSchema = z.union([
  z.object({ command: z.string(), args: z.array(z.string()).optional(), type: z.literal('stdio').optional() }).strict(),
  z.object({ url: z.string(), type: z.enum(['http', 'streamable-http']).optional() }).strict(),
])

export function parseMcpServers(value: unknown): AgentAccess['servers'] {
  const named = (input: unknown) => Object.entries(z.record(z.string(), importedConnectionSchema).parse(input)).map(([id, connection]) => ({
    id,
    transport: 'command' in connection
      ? { type: 'stdio' as const, command: connection.command, args: connection.args ?? [] }
      : { type: 'http' as const, url: connection.url },
    permission: 'ask' as const,
    tools: {},
  }))
  let servers: unknown
  if (Array.isArray(value)) {
    servers = value.flatMap((entry: unknown) => {
      if (entry && typeof entry === 'object' && 'id' in entry) return [mcpServerSchema.parse(entry)]
      return named(entry)
    })
  } else {
    const wrapper = z.object({ mcpServers: z.record(z.string(), importedConnectionSchema) }).strict().parse(value)
    servers = named(wrapper.mcpServers)
  }
  return agentAccessSchema.parse({ servers }).servers
}
