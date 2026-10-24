import { z } from 'zod'
import type { PermissionMode } from './contracts.js'

export const mcpPermissionSchema = z.enum(['blocked', 'ask', 'allow'])
export type McpPermission = z.infer<typeof mcpPermissionSchema>
export const mcpGrantSchema = z.object({
  serverId: z.string().min(1).max(200),
  conversationId: z.string().uuid().optional(),
  permission: mcpPermissionSchema,
  tools: z.record(z.string(), mcpPermissionSchema).default({}),
})
export type McpGrant = z.infer<typeof mcpGrantSchema>

export interface McpPermissionContext {
  serverId: string
  toolName: string
  conversationId: string
  mode: PermissionMode
  connected: boolean
  // Local classification only. Never populate from server-provided annotations.
  verifiedReadOnly: boolean
  grants: readonly McpGrant[]
}

/** Fail closed: one matching grant per scope; conversation overrides persistent. */
export function resolveMcpPermission(context: McpPermissionContext): McpPermission {
  if (!context.connected) return 'blocked'
  if (context.mode === 'read-only' && !context.verifiedReadOnly) return 'blocked'
  const matching = context.grants.filter((grant) => grant.serverId === context.serverId)
  const local = matching.filter((grant) => grant.conversationId === context.conversationId)
  const persistent = matching.filter((grant) => grant.conversationId === undefined)
  const candidates = local.length ? local : persistent
  if (candidates.length !== 1) return 'blocked'
  const grant = candidates[0]
  // A blocked server cannot be reopened by an individual tool override.
  if (grant.permission === 'blocked') return 'blocked'
  const permission = Object.prototype.hasOwnProperty.call(grant.tools, context.toolName)
    ? grant.tools[context.toolName] : grant.permission
  if (permission === 'blocked') return 'blocked'
  // Approval mode always asks, even for a persistently allowed tool.
  if (context.mode === 'approval') return 'ask'
  // Full access bypasses prompts, but never explicit blocks or missing grants.
  if (context.mode === 'full-access') return 'allow'
  return permission
}
