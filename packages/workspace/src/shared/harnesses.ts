import { z } from 'zod'

export const harnessIdSchema = z.enum(['codex', 'claude', 'opencode', 'pi'])
export type HarnessId = z.infer<typeof harnessIdSchema>
export const harnessNames: Record<HarnessId, string> = { codex: 'Codex', claude: 'Claude Code', opencode: 'OpenCode', pi: 'Pi' }
export const resourceIdSchema = z.string().regex(/^[a-f0-9]{32}$/)
export const harnessSelectionSchema = z.object({
  id: harnessIdSchema,
  agent: resourceIdSchema.optional(),
  instructions: z.boolean().default(true),
})
export type HarnessSelection = z.infer<typeof harnessSelectionSchema>
export type HarnessResourceKind = 'command' | 'skill' | 'agent' | 'instruction' | 'mcp'
export interface HarnessResource {
  id: string
  harness: HarnessId
  kind: HarnessResourceKind
  name: string
  description: string
  source: string
  scope: 'user' | 'workspace'
  fingerprint: string
  usable: boolean
  reason?: string
  invocation?: string
  shadowedBy?: string
  details?: string[]
}
export interface HarnessInfo {
  id: HarnessId
  name: string
  installed: boolean
  executable?: string
  configured: boolean
  roots: string[]
}
export interface HarnessCatalog {
  harnesses: HarnessInfo[]
  resources: HarnessResource[]
  issues: { source: string; message: string }[]
  scannedAt: string
}
export interface HarnessResourcePreview { resource: HarnessResource; content: string }
