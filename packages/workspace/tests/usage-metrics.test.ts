import { describe, expect, it } from 'vitest'
import { contextSnapshotSchema, quotaSnapshotSchema, usageRecordSchema } from '../src/shared/usage-metrics.js'

const metadata = {
  provider: 'openai', observedAt: '2026-01-01T00:00:00Z', source: 'provider',
  quality: 'measured', freshness: 'current',
}
const context = {
  ...metadata, conversationId: 'conversation', model: 'model', contentRevision: '1',
  basis: 'last-request', usedTokens: 100,
}
const usage = {
  ...metadata, id: 'call', conversationId: 'conversation', turnId: 'turn', model: 'model',
  purpose: 'response', inputTokens: 100, outputTokens: 20,
}
const quota = { ...metadata, accountRef: 'opaque', windows: [{ id: 'daily', unit: 'requests', limit: 100, remaining: 20 }] }

describe('context contract', () => {
  it('does not invent capacity for unknown models', () => {
    expect(contextSnapshotSchema.parse(context).capacityTokens).toBeUndefined()
  })
  it('requires provenance and preserves over-capacity measurements', () => {
    expect(contextSnapshotSchema.safeParse({ ...context, capacityTokens: 50 }).success).toBe(false)
    expect(contextSnapshotSchema.parse({ ...context, capacityTokens: 50, capacitySource: 'runtime' }).usedTokens).toBe(100)
  })
  it('distinguishes unavailable, projected and stale readings', () => {
    expect(contextSnapshotSchema.safeParse({ ...context, quality: 'unavailable' }).success).toBe(false)
    expect(contextSnapshotSchema.safeParse({ ...context, quality: 'unavailable', usedTokens: undefined }).success).toBe(true)
    expect(contextSnapshotSchema.safeParse({ ...context, basis: 'next-request-projection' }).success).toBe(false)
    expect(contextSnapshotSchema.safeParse({ ...context, basis: 'next-request-projection', quality: 'estimated', freshness: 'stale' }).success).toBe(true)
  })
  it('rejects invalid capacity, reserve and threshold', () => {
    for (const extra of [{ capacityTokens: 0 }, { reserveTokens: 201 }, { compactionThresholdTokens: 201 }]) {
      expect(contextSnapshotSchema.safeParse({ ...context, capacityTokens: 200, capacitySource: 'catalog', ...extra }).success).toBe(false)
    }
  })
})

describe('usage contract', () => {
  it('retains inclusive totals rather than adding subsets', () => {
    const record = usageRecordSchema.parse({ ...usage, cacheReadTokens: 60, cacheWriteTokens: 40, reasoningTokens: 10 })
    expect(record.inputTokens! + record.outputTokens!).toBe(120)
  })
  it('rejects invalid details and unsafe counters', () => {
    for (const extra of [{ cacheReadTokens: 101 }, { cacheReadTokens: 60, cacheWriteTokens: 41 }, { reasoningTokens: 21 }, { inputTokens: -1 }, { outputTokens: 1.5 }, { inputTokens: Number.MAX_SAFE_INTEGER + 1 }]) {
      expect(usageRecordSchema.safeParse({ ...usage, ...extra }).success).toBe(false)
    }
  })
  it('permits partial usage without pretending missing output is zero', () => {
    const partial = { ...usage, quality: 'partial', outputTokens: undefined }
    expect(usageRecordSchema.parse(partial).outputTokens).toBeUndefined()
    expect(usageRecordSchema.safeParse({ ...partial, reasoningTokens: 1 }).success).toBe(false)
    expect(usageRecordSchema.safeParse({ ...partial, quality: 'measured' }).success).toBe(false)
  })
  it('distinguishes unknown cost, reported zero and estimates', () => {
    expect(usageRecordSchema.parse(usage).cost).toBeUndefined()
    const cost = { amount: 0, currency: 'USD', source: 'reported', meaning: 'billed' }
    expect(usageRecordSchema.parse({ ...usage, cost }).cost?.amount).toBe(0)
    expect(usageRecordSchema.safeParse({ ...usage, cost: { ...cost, source: 'estimated' } }).success).toBe(false)
    expect(usageRecordSchema.safeParse({ ...usage, cost: { ...cost, source: 'estimated', pricingReference: 'catalog-v1' } }).success).toBe(true)
  })
  it('rejects unavailable consumption and invalid observation dates', () => {
    expect(usageRecordSchema.safeParse({ ...usage, quality: 'unavailable' }).success).toBe(false)
    expect(usageRecordSchema.safeParse({ ...usage, observedAt: 'yesterday' }).success).toBe(false)
  })
})

describe('quota contract', () => {
  it('keeps stale quota separate from availability', () => {
    expect(quotaSnapshotSchema.parse({ ...quota, freshness: 'stale' }).windows[0].remaining).toBe(20)
    expect(quotaSnapshotSchema.safeParse({ ...quota, quality: 'unavailable', windows: [] }).success).toBe(true)
    expect(quotaSnapshotSchema.safeParse({ ...quota, quality: 'unavailable' }).success).toBe(false)
  })
  it('rejects duplicate windows and impossible balances', () => {
    expect(quotaSnapshotSchema.safeParse({ ...quota, windows: [quota.windows[0], quota.windows[0]] }).success).toBe(false)
    for (const window of [{ id: 'x', unit: 'percent', remaining: 101 }, { ...quota.windows[0], remaining: 101 }]) {
      expect(quotaSnapshotSchema.safeParse({ ...quota, windows: [window] }).success).toBe(false)
    }
  })
})
