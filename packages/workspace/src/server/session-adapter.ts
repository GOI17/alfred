import type { LanguageModel } from 'ai'
import { Chat } from './chat.js'
import type { SessionPort, RuntimeDescriptor } from './session-port.js'
import type { Store } from './store.js'
import type { Vault } from './vault.js'
import type { Capabilities, CapabilityRequest } from './agent-access.js'
import type { HarnessRegistry } from './harness-runtime.js'

/** Temporary compatibility bindings for the legacy execution adapter only.
 * External runtimes must own their tools; these bindings must not be installed
 * on them. Remove once the legacy tool configuration UI/API is migrated.
 */
export interface LegacySessionBindings {
  capabilities?: (request: CapabilityRequest) => Promise<Capabilities>
  harnesses?: HarnessRegistry
}
export interface SessionAdapter {
  session: SessionPort
  describe(): Promise<RuntimeDescriptor>
  legacyBindings?: LegacySessionBindings
}
export interface SessionAdapterContext {
  store: Store
  vault: Vault
  changed: () => void
  model?: LanguageModel
  chatgptModel: () => Promise<LanguageModel>
}
export type SessionAdapterFactory = (context: SessionAdapterContext) => SessionAdapter

/** Compatibility adapter, not the identity of Alfred Workspace. */
export const createLegacySessionAdapter: SessionAdapterFactory = (context) => {
  const session = new Chat(context.store, context.vault, context.changed, context.model, context.chatgptModel)
  return { session, legacyBindings: session, describe: async () => ({
    id: 'legacy', name: 'Legacy execution adapter',
    capabilities: { resume: true, cancel: true, compact: true, permissions: true },
    commands: null, skills: null, mcpServers: null,
  }) }
}
