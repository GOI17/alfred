import { z } from 'zod'
import { providerId } from './providers.js'

const tokens = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const capacity = tokens.refine(value => value > 0, 'Must be positive')
const timestamp = z.string().datetime({ offset: true })
const identity = z.string().min(1)
const metadata = {
  provider: providerId,
  observedAt: timestamp,
  source: z.enum(['provider', 'runtime', 'catalog', 'estimator']),
  quality: z.enum(['measured', 'estimated', 'partial', 'unavailable']),
  freshness: z.enum(['current', 'stale']),
}

/** Occupancy is independent of cumulative, billable usage. */
export const contextSnapshotSchema = z.object({
  ...metadata,
  conversationId: identity,
  model: identity,
  contentRevision: identity,
  basis: z.enum(['last-request', 'next-request-projection']),
  usedTokens: tokens.optional(),
  capacityTokens: capacity.optional(),
  capacitySource: z.enum(['provider', 'runtime', 'catalog']).optional(),
  compactionThresholdTokens: capacity.optional(),
  reserveTokens: tokens.optional(),
}).superRefine((value, ctx) => {
  if ((value.quality === 'unavailable') !== (value.usedTokens === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['usedTokens'], message: 'Availability must match occupancy' })
  }
  if ((value.capacityTokens === undefined) !== (value.capacitySource === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['capacitySource'], message: 'Capacity requires provenance' })
  }
  if (value.basis === 'next-request-projection' && value.quality === 'measured') {
    ctx.addIssue({ code: 'custom', path: ['quality'], message: 'A projection is not a measurement' })
  }
  for (const field of ['compactionThresholdTokens', 'reserveTokens'] as const) {
    if (value[field] !== undefined && value.capacityTokens !== undefined && value[field] > value.capacityTokens) {
      ctx.addIssue({ code: 'custom', path: [field], message: 'Exceeds capacity' })
    }
  }
})
export type ContextSnapshot = z.infer<typeof contextSnapshotSchema>

/** Cache is a subset of input; reasoning is a subset of output. */
export const usageRecordSchema = z.object({
  ...metadata,
  id: identity,
  conversationId: identity,
  turnId: identity,
  model: identity,
  purpose: z.enum(['response', 'compaction', 'subagent', 'auxiliary']),
  parentCallId: identity.optional(),
  inputTokens: tokens.optional(),
  outputTokens: tokens.optional(),
  cacheReadTokens: tokens.optional(),
  cacheWriteTokens: tokens.optional(),
  reasoningTokens: tokens.optional(),
  durationMs: tokens.optional(),
  cost: z.object({
    amount: z.number().finite().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    source: z.enum(['reported', 'estimated']),
    meaning: z.enum(['billed', 'api-equivalent']),
    pricingReference: identity.optional(),
  }).optional(),
}).superRefine((value, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
  if ((value.quality === 'measured' || value.quality === 'estimated') &&
      (value.inputTokens === undefined || value.outputTokens === undefined)) {
    issue('quality', 'Complete usage requires input and output')
  }
  if (value.quality === 'unavailable' &&
      [value.inputTokens, value.outputTokens, value.cacheReadTokens, value.cacheWriteTokens, value.reasoningTokens, value.cost].some(v => v !== undefined)) {
    issue('quality', 'Unavailable usage cannot carry consumption or cost')
  }
  if (value.cacheReadTokens !== undefined || value.cacheWriteTokens !== undefined) {
    if (value.inputTokens === undefined || (value.cacheReadTokens ?? 0) + (value.cacheWriteTokens ?? 0) > value.inputTokens) {
      issue('inputTokens', 'Cache details require and cannot exceed total input')
    }
  }
  if (value.reasoningTokens !== undefined && (value.outputTokens === undefined || value.reasoningTokens > value.outputTokens)) {
    issue('reasoningTokens', 'Reasoning requires and cannot exceed total output')
  }
  if (value.cost?.source === 'estimated' && !value.cost.pricingReference) {
    issue('cost', 'Estimated cost requires a pricing reference')
  }
})
export type UsageRecord = z.infer<typeof usageRecordSchema>

/** Account references are opaque identifiers, never credentials. */
export const quotaSnapshotSchema = z.object({
  ...metadata,
  accountRef: identity,
  windows: z.array(z.object({
    id: identity,
    unit: z.enum(['tokens', 'requests', 'credits', 'percent']),
    limit: z.number().finite().positive().optional(),
    remaining: z.number().finite().nonnegative().optional(),
    resetsAt: timestamp.optional(),
  })),
}).superRefine((value, ctx) => {
  const ids = new Set<string>()
  value.windows.forEach((window, index) => {
    const issue = (field: string, message: string) => ctx.addIssue({ code: 'custom', path: ['windows', index, field], message })
    if (ids.has(window.id)) issue('id', 'Duplicate quota window')
    ids.add(window.id)
    if (window.remaining !== undefined && window.limit !== undefined && window.remaining > window.limit) {
      issue('remaining', 'Remaining exceeds limit')
    }
    if (window.unit === 'percent' && ((window.limit ?? 0) > 100 || (window.remaining ?? 0) > 100)) {
      issue('remaining', 'Percentage exceeds 100')
    }
    if (value.quality === 'unavailable' && window.remaining !== undefined) {
      issue('remaining', 'Unavailable quota cannot carry a balance')
    }
  })
})
export type QuotaSnapshot = z.infer<typeof quotaSnapshotSchema>
