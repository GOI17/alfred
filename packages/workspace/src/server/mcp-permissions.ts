import { resolveMcpPermission, type McpPermissionContext } from '../shared/mcp-permissions.js'

export interface McpInvocation {
  serverId: string
  toolName: string
  conversationId: string
  arguments: Record<string, unknown>
}
export interface McpExecutionDependencies<T> {
  // Must read current backend state, not user/model-supplied permission fields.
  context: () => McpPermissionContext
  // Increment on connection, tool catalogue, classification or grant changes.
  revision: () => number
  approve: (invocation: McpInvocation, signal: AbortSignal) => Promise<boolean>
  execute: (invocation: McpInvocation, signal: AbortSignal) => Promise<T>
}

/** Single execution gate for future MCP transports; never retries side effects. */
export async function executeMcpWithPermission<T>(
  invocation: McpInvocation,
  signal: AbortSignal,
  dependencies: McpExecutionDependencies<T>,
): Promise<T> {
  signal.throwIfAborted()
  // Keep approval and execution bound to exactly the same immutable arguments.
  const captured = structuredClone(invocation)
  const decision = () => {
    const context = dependencies.context()
    if (context.serverId !== captured.serverId || context.toolName !== captured.toolName ||
      context.conversationId !== captured.conversationId) throw new Error('Invalid MCP context.')
    return resolveMcpPermission(context)
  }
  const revision = dependencies.revision()
  const permission = decision()
  if (permission === 'blocked') throw new Error('Herramienta MCP bloqueada.')
  if (permission === 'ask') {
    const accepted = await dependencies.approve(structuredClone(captured), signal)
    signal.throwIfAborted()
    if (!accepted) throw new Error('MCP execution rejected.')
  }
  signal.throwIfAborted()
  const current = decision()
  if (dependencies.revision() !== revision || current !== permission) {
    throw new Error('MCP permissions or connection changed. Request a new execution.')
  }
  return dependencies.execute(captured, signal)
}
