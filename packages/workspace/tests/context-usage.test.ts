import { describe, expect, it } from 'vitest'
import { contextInputTokens, contextRemaining, latestContextUsage } from '../src/shared/context-usage.js'
import { contextUsageSchema, type Message } from '../src/shared/contracts.js'

const usage = { provider: 'openai' as const, model: 'gpt-4o', inputTokens: 100, outputTokens: 50, limit: 128000, measuredAt: '2026-01-01T00:00:00Z' }
const message = (contextUsage?: Message['contextUsage']): Message => ({ id: 'test', role: 'assistant', text: '', notes: [], createdAt: usage.measuredAt, contextUsage })

describe('context measurement', () => {
  it('uses normalized input without adding cache or output again', () => {
    expect(contextInputTokens('openai', { inputTokens: 100, raw: { cached_tokens: 80 } })).toBe(100)
    expect(contextInputTokens('anthropic', { inputTokens: 100, raw: { input_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 50 } })).toBe(100)
    expect(contextRemaining(usage)).toBe(127900)
  })
  it('keeps unknown limits and absent measurements unknown, but accepts measured zero', () => {
    expect(contextRemaining({ ...usage, limit: undefined })).toBeUndefined()
    expect(contextInputTokens('openai', {})).toBeUndefined()
    expect(contextInputTokens('openai', { inputTokens: 0 })).toBe(0)
    expect(contextInputTokens('openai', { inputTokens: -1 })).toBeUndefined()
    expect(contextInputTokens('openai', { inputTokens: NaN })).toBeUndefined()
    expect(contextUsageSchema.parse({ ...usage, outputTokens: undefined }).outputTokens).toBeUndefined()
  })
  it('never subtracts output and clamps remaining at zero', () => {
    expect(contextRemaining({ ...usage, inputTokens: 128001 })).toBe(0)
    expect(contextRemaining({ ...usage, outputTokens: 10000 })).toBe(127900)
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
