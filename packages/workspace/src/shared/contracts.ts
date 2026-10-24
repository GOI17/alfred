import { z } from 'zod'
import { attachmentsSchema } from './attachments.js'
import { harnessProjectionSchema } from './subagents.js'
import { harnessSelectionSchema } from './harnesses.js'

export const apiProviderId = z.enum(['openai', 'anthropic', 'google', 'copilot', 'opencode'])
export type ApiProviderId = z.infer<typeof apiProviderId>
export const providerId = z.enum(['openai', 'anthropic', 'google', 'chatgpt', 'copilot', 'opencode'])
export type ProviderId = z.infer<typeof providerId>
export const permissionModeSchema = z.enum(['read-only', 'approval', 'full-access'])
export type PermissionMode = z.infer<typeof permissionModeSchema>
export const paneSchema = z.object({
  type: z.literal('pane'),
  id: z.string().uuid(),
  kind: z.enum(['chat', 'terminal', 'browser', 'git']),
})
export type Pane = z.infer<typeof paneSchema>
export type Layout =
  | Pane
  | { type: 'split'; id: string; direction: 'row' | 'column'; ratio: number; children: [Layout, Layout] }
export const layoutSchema: z.ZodType<Layout> = z.lazy(() =>
  z.union([
    paneSchema,
    z.object({
      type: z.literal('split'), id: z.string().uuid(), direction: z.enum(['row', 'column']),
      ratio: z.number().min(0.15).max(0.85), children: z.tuple([layoutSchema, layoutSchema]),
    }),
  ]),
)
export function panes(layout: Layout): Pane[] {
  return layout.type === 'pane' ? [layout] : layout.children.flatMap(panes)
}
export const projectSchema = z.object({
  id: z.string().uuid(), name: z.string(), path: z.string(),
  kind: z.enum(['git', 'folder']), createdAt: z.string(),
})
export type Project = z.infer<typeof projectSchema>
// Exact model IDs only; unknown models have no assumed limit.
export function modelContextLimit(model: string): number | undefined {
  const limits: Record<string, number> = {
    'gpt-4o': 128000, 'gpt-4o-2024-08-06': 128000, 'gpt-4o-mini': 128000,
    'gpt-4.1': 1047576, 'gpt-4.1-mini': 1047576, 'gpt-4.1-nano': 1047576,
    'o3': 200000, 'o4-mini': 200000,
    'claude-3-5-sonnet-20241022': 200000, 'claude-3-7-sonnet-20250219': 200000,
  }
  return limits[model]
}
export const contextUsageSchema = z.object({
  provider: providerId, model: z.string(),
  inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(), measuredAt: z.string(),
})
export const messageSchema = z.object({
  id: z.string().uuid(), role: z.enum(['user', 'assistant']), text: z.string(),
  createdAt: z.string(), notes: z.array(z.string()).default([]),
  attachments: attachmentsSchema.optional(),
  segments: z.array(z.object({ kind: z.enum(['activity', 'response', 'result']), text: z.string() })).optional(),
  contextUsage: contextUsageSchema.optional(),
  consumedTokens: z.number().int().nonnegative().optional(),
  consumptionIncomplete: z.boolean().optional(),
})
export type Message = z.infer<typeof messageSchema>
export const queuedMessageSchema = z.object({
  id: z.string().uuid(), text: z.string().max(32000), provider: providerId,
  attachments: attachmentsSchema, createdAt: z.string(),
})
export type QueuedMessage = z.infer<typeof queuedMessageSchema>
export const conversationSchema = z.object({
  id: z.string().uuid(), projectId: z.string().uuid(), workspacePath: z.string(),
  title: z.string(), createdAt: z.string(), layout: layoutSchema,
  lastProvider: providerId.optional(),
  permissionMode: permissionModeSchema.optional(),
  harness: harnessSelectionSchema.optional(),
  messages: z.array(messageSchema).default([]),
  subagents: z.array(harnessProjectionSchema).max(10).optional(),
  queue: z.array(queuedMessageSchema).max(20).optional(),
  queuePaused: z.boolean().optional(),
  compaction: z.object({
    summary: z.string(), throughMessageId: z.string().uuid(), createdAt: z.string(),
    reduction: z.union([z.literal(30), z.literal(50), z.literal(70)]),
  }).optional(),
  compactionTokens: z.number().int().nonnegative().optional(),
})
export type Conversation = z.infer<typeof conversationSchema>
export const providerSchema = z.object({
  id: apiProviderId, model: z.string().trim().min(1).max(150), encryptedKey: z.string(),
})
export const databaseSchema = z.object({
  version: z.literal(1), projects: z.array(projectSchema),
  conversations: z.array(conversationSchema), providers: z.array(providerSchema),
  hostId: z.string().optional(),
  pushKeys: z.string().optional(),
  pushSubscriptions: z.array(z.object({ id: z.string(), encrypted: z.string() })).max(100).optional(),
  chatgptAccounts: z.array(z.object({
    id: z.string().uuid(), clientId: z.string(), subject: z.string(), email: z.string(),
    encryptedTokens: z.string().optional(), model: z.string(), welcomed: z.boolean().default(false),
  })).default([]),
  activeChatgptAccount: z.string().optional(),
})
export type Database = z.infer<typeof databaseSchema>
export interface Worktree { path: string; branch: string; main: boolean; locked: boolean }
export interface AgentState {
  status: 'idle' | 'running' | 'waiting' | 'error'
  detail?: string
  approval?: { id: string; path: string; content: string }
}
export interface PublicState {
  worktreeVersion: number
  projects: Project[]
  conversations: Conversation[]
  providers: { id: ProviderId; model: string }[]
  agents: Record<string, AgentState>
  chatgpt: {
    accounts: { id: string; email: string; label: string; connected: boolean; model: string; welcomed: boolean }[]
    active?: string
    error?: string
  }
}
export interface GitCommit { hash: string; shortHash: string; author: string; date: string; subject: string }
export interface GitHistory {
  branch: string
  commits: GitCommit[]
  changes: { status: string; path: string }[]
  hasMore: boolean
}
export const browserInput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'), url: z.string().max(4000), insecure: z.boolean().default(false) }),
  z.object({ type: z.literal('click'), x: z.number().min(0).max(1920), y: z.number().min(0).max(1080) }),
  z.object({ type: z.literal('key'), key: z.string().max(100) }),
  z.object({ type: z.literal('text'), text: z.string().max(10000) }),
  z.object({ type: z.literal('scroll'), x: z.number().min(-5000).max(5000), y: z.number().min(-5000).max(5000) }),
  z.object({ type: z.literal('resize'), width: z.number().int().min(320).max(1920), height: z.number().int().min(240).max(1080) }),
  z.object({ type: z.enum(['back', 'forward', 'reload']) }),
])
