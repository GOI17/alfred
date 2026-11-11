import { describe, expect, it } from 'vitest'
import { providerContextCapacity, resolveContextCapacity } from '../src/shared/context-capacity.js'
import { contextUsageSchema } from '../src/shared/contracts.js'

const evidence = { provider: 'openai' as const, model: 'gpt-4o', capacityTokens: 64000, reference: 'test:runtime-config' }
describe('context capacity resolution', () => {
  it('uses exact catalogue entries with explicit provenance', () => {
    expect(resolveContextCapacity('openai', 'gpt-4o')).toEqual({
      capacityTokens: 128000, capacitySource: 'catalog', capacityReference: 'workspace-legacy-v1:openai/gpt-4o',
    })
    expect(resolveContextCapacity('anthropic', 'claude-3-7-sonnet-20250219').capacityTokens).toBe(200000)
  })
  it.each(['unknown', 'gpt-4o-custom', 'openai/gpt-4o', 'toString', '__proto__'])('does not infer unknown ID %s', model => {
    expect(resolveContextCapacity('openai', model)).toEqual({})
  })
  it.each(['chatgpt', 'copilot', 'opencode', 'google', 'anthropic'] as const)('does not reuse OpenAI capacity for %s', provider => {
    expect(resolveContextCapacity(provider, 'gpt-4o')).toEqual({})
  })
  it('prefers runtime, then provider, then catalogue', () => {
    expect(resolveContextCapacity('openai', 'gpt-4o', { runtime: evidence, provider: { ...evidence, capacityTokens: 96000 } })).toMatchObject({ capacityTokens: 64000, capacitySource: 'runtime' })
    expect(resolveContextCapacity('openai', 'gpt-4o', { provider: evidence })).toMatchObject({ capacityTokens: 64000, capacitySource: 'provider' })
    expect(resolveContextCapacity('openai', 'custom', { provider: { ...evidence, model: 'custom' } }).capacityTokens).toBe(64000)
  })
  it('ignores evidence from another model or connection', () => {
    expect(resolveContextCapacity('google', 'custom', { runtime: evidence, provider: evidence })).toEqual({})
    expect(resolveContextCapacity('openai', 'custom', { runtime: evidence })).toEqual({})
  })
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid capacity %s', capacityTokens => {
    expect(resolveContextCapacity('openai', 'custom', { runtime: { ...evidence, model: 'custom', capacityTokens } })).toEqual({})
  })
  it('requires a nonempty reference', () => {
    expect(resolveContextCapacity('openai', 'custom', { provider: { ...evidence, model: 'custom', reference: ' ' } })).toEqual({})
  })
  it('only reports an explicit runtime threshold, never derives it from reserve', () => {
    expect(resolveContextCapacity('openai', 'gpt-4o').compactionThresholdTokens).toBeUndefined()
    expect(resolveContextCapacity('openai', 'gpt-4o', { runtime: { ...evidence, reserveTokens: 1000 } }).compactionThresholdTokens).toBeUndefined()
    expect(resolveContextCapacity('openai', 'gpt-4o', { runtime: { ...evidence, compactionThresholdTokens: 60000, reserveTokens: 1000 } })).toMatchObject({ compactionThresholdTokens: 60000, compactionThresholdSource: 'runtime', reserveTokens: 1000 })
  })
  it('discards invalid policy without losing valid capacity', () => {
    expect(resolveContextCapacity('openai', 'gpt-4o', { runtime: { ...evidence, compactionThresholdTokens: 65000, reserveTokens: -1 } })).toEqual({ capacityTokens: 64000, capacitySource: 'runtime', capacityReference: evidence.reference })
  })
  it('preserves provenance through persistence while accepting legacy measurements', () => {
    const legacy = { provider: 'openai', model: 'gpt-4o', inputTokens: 10, limit: 128000, measuredAt: '2026-01-01T00:00:00Z' }
    expect(contextUsageSchema.parse(legacy)).toEqual(legacy)
    const { capacityTokens, ...metadata } = resolveContextCapacity('openai', 'gpt-4o')
    const current = { ...legacy, limit: capacityTokens, ...metadata }
    expect(contextUsageSchema.parse(JSON.parse(JSON.stringify(current)))).toEqual(current)
  })
})


describe('provider context metadata', () => {
  it.each(['chatgpt', 'openai', 'anthropic', 'google', 'opencode'] as const)('reads explicit capacity for %s without a plan gate', provider => {
    expect(providerContextCapacity(provider, 'custom-model', { context_window: 96000 })).toEqual({
      capacityTokens: 96000, capacitySource: 'provider', capacityReference: `${provider}/models:custom-model#context_window`,
    })
  })
  it('reads Copilot capability limits', () => {
    expect(providerContextCapacity('copilot', 'custom', { capabilities: { limits: { max_context_window_tokens: 64000 } } }).capacityTokens).toBe(64000)
  })
  it.each(['context_length', 'max_context_window'])('supports explicit field %s', field => {
    expect(providerContextCapacity('chatgpt', 'custom', { [field]: 32000 }).capacityTokens).toBe(32000)
  })
  it.each([undefined, null, [], { max_tokens: 32000 }, { context_window: '32000' }, { context_window: -1 }, { context_window: 1.5 }, { context_window: Infinity }])('does not turn absent, output or invalid limits into capacity: %j', metadata => {
    expect(providerContextCapacity('chatgpt', 'custom', metadata)).toEqual({})
  })
  it('prefers provider metadata over legacy catalogue', () => {
    expect(providerContextCapacity('openai', 'gpt-4o', { context_window: 64000 })).toMatchObject({ capacityTokens: 64000, capacitySource: 'provider' })
  })
})
