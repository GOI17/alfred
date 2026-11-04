import { describe, expect, it } from 'vitest'
import { compactTokenCount, compactedTextEstimate, contextInputTokens, contextUsedTokens, contextRemaining, latestContextUsage } from '../src/shared/context-usage.js'
import { contextUsageSchema, type Message } from '../src/shared/contracts.js'

const usage = { provider: 'openai' as const, model: 'gpt-4o', inputTokens: 100, outputTokens: 50, limit: 128000, measuredAt: '2026-01-01T00:00:00Z' }
const message = (contextUsage?: Message['contextUsage']): Message => ({ id: 'test', role: 'assistant', text: '', notes: [], createdAt: usage.measuredAt, contextUsage })

describe('context measurement', () => {
  it('uses normalized input without adding cache or output again', () => {
    expect(contextInputTokens('openai', { inputTokens: 100, raw: { cached_tokens: 80 } })).toBe(100)
    expect(contextInputTokens('anthropic', { inputTokens: 100, raw: { input_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 50 } })).toBe(100)
    expect(contextRemaining(usage)).toBe(127850)
  })
  it('keeps unknown limits and absent measurements unknown, but accepts measured zero', () => {
    expect(contextRemaining({ ...usage, limit: undefined })).toBeUndefined()
    expect(contextInputTokens('openai', {})).toBeUndefined()
    expect(contextInputTokens('openai', { inputTokens: 0 })).toBe(0)
    expect(contextInputTokens('openai', { inputTokens: -1 })).toBeUndefined()
    expect(contextInputTokens('openai', { inputTokens: NaN })).toBeUndefined()
    expect(contextUsageSchema.parse({ ...usage, outputTokens: undefined }).outputTokens).toBeUndefined()
  })
  it('includes output once and clamps remaining at zero', () => {
    expect(contextRemaining({ ...usage, inputTokens: 128001 })).toBe(0)
    expect(contextRemaining({ ...usage, outputTokens: 10000 })).toBe(117900)
    expect(contextUsedTokens(usage)).toBe(150)
    expect(contextUsedTokens({ ...usage, outputTokens: undefined })).toBe(100)
  })
  it('uses only the latest assistant measurement and does not resurrect an older model', () => {
    expect(latestContextUsage([message(usage)], 'openai', 'gpt-4o')).toEqual(usage)
    expect(latestContextUsage([message(usage), message({ ...usage, model: 'other' })], 'openai', 'gpt-4o')).toBeUndefined()
    expect(latestContextUsage([message(usage), message()], 'openai', 'gpt-4o')).toBeUndefined()
    expect(latestContextUsage([message(usage)], 'chatgpt', 'gpt-4o')).toBeUndefined()
    expect(latestContextUsage([message(usage), message({ ...usage, inputTokens: 200 })], 'openai', 'gpt-4o')?.inputTokens).toBe(200)
  })
  it('does not show compaction billing aggregates as current context', () => {
    expect(contextInputTokens('anthropic', { inputTokens: 100, raw: { iterations: [{ type: 'compaction' }, { type: 'message' }] } })).toBeUndefined()
  })
})

describe('compact context counter', () => {
  it('formats compact token counts without percentages', () => {
    expect(compactTokenCount(6000)).toBe('6k')
    expect(compactTokenCount(100000)).toBe('100k')
    expect(compactTokenCount(12500)).toBe('12.5k')
    expect(compactTokenCount(0)).toBe('0')
  })
  it('estimates only the saved summary and retained text after reload', () => {
    const conversation = {
      messages: [{ ...message(), id: 'old', text: 'x'.repeat(10000) }, { ...message(), id: 'recent', text: 'kept' }],
      compaction: { summary: 'summary', throughMessageId: 'old', createdAt: usage.measuredAt, reduction: 30 },
    } as Parameters<typeof compactedTextEstimate>[0]
    expect(compactedTextEstimate(JSON.parse(JSON.stringify(conversation)))).toBe(3)
    expect(compactedTextEstimate({ ...conversation, compaction: undefined })).toBeUndefined()
    expect(compactedTextEstimate({ ...conversation, messages: [] })).toBeUndefined()
  })
})
