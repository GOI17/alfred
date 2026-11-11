import { describe, expect, it } from 'vitest'
import { normalizeSdkUsage } from '../src/shared/normalize-usage.js'
import { usageRecordSchema } from '../src/shared/usage-metrics.js'

// Fixtures are SDK-level inclusive totals, not native provider payloads.
const fixtures = [
  { provider: 'openai', input: 100, output: 30, read: 50, reasoning: 20 },
  { provider: 'anthropic', input: 180, output: 30, read: 50, write: 30 },
  { provider: 'google', input: 100, output: 30, read: 40, reasoning: 10 },
  { provider: 'chatgpt', input: 100, output: 30, read: 50, reasoning: 20 },
  { provider: 'copilot', input: 100, output: 30, read: 50 },
  { provider: 'opencode', input: 180, output: 30, read: 50, write: 30 },
]

describe('SDK usage normalization', () => {
  it.each(fixtures)('preserves inclusive totals for $provider', fixture => {
    const normalized = normalizeSdkUsage({
      inputTokens: fixture.input, outputTokens: fixture.output,
      inputTokenDetails: { cacheReadTokens: fixture.read, cacheWriteTokens: fixture.write },
      outputTokenDetails: { reasoningTokens: fixture.reasoning },
    })
    const record = usageRecordSchema.parse({
      ...normalized, id: 'call', conversationId: 'conversation', turnId: 'turn',
      provider: fixture.provider, model: 'model', purpose: 'response',
      observedAt: '2026-01-01T00:00:00Z', source: 'provider', freshness: 'current',
    })
    expect(record.inputTokens! + record.outputTokens!).toBe(fixture.input + fixture.output)
    expect(record.cacheReadTokens).toBe(fixture.read)
    expect(record.cacheWriteTokens).toBe(fixture.write)
    expect(record.reasoningTokens).toBe(fixture.reasoning)
    expect(record.quality).toBe('measured')
    expect(record.cost).toBeUndefined()
  })
  it('distinguishes absent usage, partial usage and reported zero', () => {
    expect(normalizeSdkUsage({}).quality).toBe('unavailable')
    expect(normalizeSdkUsage({ inputTokens: 0 })).toMatchObject({ quality: 'partial', outputTokens: undefined })
    expect(normalizeSdkUsage({ inputTokens: 0, outputTokens: 0 }).quality).toBe('measured')
  })
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid counter %s', inputTokens => {
    expect(normalizeSdkUsage({ inputTokens, outputTokens: 2 })).toMatchObject({ inputTokens: undefined, quality: 'partial', invalidFields: ['inputTokens'] })
  })
  it('drops inconsistent subsets without corrupting valid totals', () => {
    expect(normalizeSdkUsage({ inputTokens: 10, outputTokens: 2,
      inputTokenDetails: { cacheReadTokens: 8, cacheWriteTokens: 3 },
      outputTokenDetails: { reasoningTokens: 3 },
    })).toMatchObject({ inputTokens: 10, outputTokens: 2, cacheReadTokens: undefined,
      cacheWriteTokens: undefined, reasoningTokens: undefined, quality: 'partial' })
  })
  it('does not reconstruct missing totals from details', () => {
    expect(normalizeSdkUsage({ inputTokenDetails: { cacheReadTokens: 10 }, outputTokenDetails: { reasoningTokens: 2 } }))
      .toMatchObject({ inputTokens: undefined, outputTokens: undefined, cacheReadTokens: undefined, reasoningTokens: undefined, quality: 'unavailable' })
  })
})
