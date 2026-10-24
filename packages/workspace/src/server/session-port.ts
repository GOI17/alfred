import type { AgentState, Message, PermissionMode, ProviderId } from '../shared/contracts.js'
import type { Attachment } from '../shared/attachments.js'
import type { HarnessSelection } from '../shared/harnesses.js'

/** Application-facing port. Implementations own execution, tools and recovery.
 * No model SDK, MCP client or shell belongs in the workspace service.
 * Provider/harness selection is retained for compatibility with the current API.
 */
export interface SessionPort {
  notice?: (id: string, kind: 'completed' | 'error' | 'approval') => void
  states(): Record<string, AgentState>
  partials(): Record<string, Message>
  isRunning(id: string): boolean
  start(id: string, text: string, provider: ProviderId, attachments?: Attachment[], mode?: 'queue' | 'interrupt'): Promise<void>
  stop(id: string): Promise<void>
  resume(id: string): Promise<void>
  removeQueued(id: string, messageId: string): Promise<void>
  decide(id: string, approvalId: string, accepted: boolean): void
  setPermission(id: string, mode: PermissionMode): Promise<void>
  setHarness(id: string, selection: HarnessSelection | undefined): Promise<void>
  compact(id: string, provider: ProviderId, reduction: 30 | 50 | 70): Promise<void>
  stopProvider(provider: ProviderId): Promise<void>
  close(): Promise<void>
}

/** Reported by a runtime, never inferred from locally discovered files.
 * null means undisclosed; [] means the runtime reported an empty catalog.
 */
export interface RuntimeDescriptor {
  id: string
  name: string
  version?: string
  capabilities: {
    resume: boolean
    cancel: boolean
    compact: boolean
    permissions: boolean
  }
  commands: { name: string; description?: string }[] | null
  skills: { name: string; description?: string }[] | null
  mcpServers: { name: string; status?: string }[] | null
}
