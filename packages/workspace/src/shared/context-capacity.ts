import type { ProviderId } from './providers.js'

export type CapacitySource = 'runtime' | 'provider' | 'catalog'
export interface ContextCapacity {
  capacityTokens?: number
  capacitySource?: CapacitySource
  capacityReference?: string
  compactionThresholdTokens?: number
  compactionThresholdSource?: 'runtime'
  reserveTokens?: number
}
export interface CapacityEvidence {
  provider: ProviderId
  model: string
  capacityTokens: number
  reference: string
}
export interface RuntimeCapacityEvidence extends CapacityEvidence {
  // Only an explicitly configured runtime policy is a compaction threshold.
  compactionThresholdTokens?: number
  reserveTokens?: number
}

// Conservative legacy catalogue, not live provider discovery. Exact IDs and
// direct API providers only: gateways/subscriptions may impose other limits.
const catalogue: Partial<Record<ProviderId, Record<string, number>>> = {
  openai: {
    'gpt-4o': 128000, 'gpt-4o-2024-08-06': 128000, 'gpt-4o-mini': 128000,
    'gpt-4.1': 1047576, 'gpt-4.1-mini': 1047576, 'gpt-4.1-nano': 1047576,
    'o3': 200000, 'o4-mini': 200000,
  },
  anthropic: {
    'claude-3-5-sonnet-20241022': 200000, 'claude-3-7-sonnet-20250219': 200000,
  },
}
const positive = (value: number | undefined): value is number =>
  value !== undefined && Number.isSafeInteger(value) && value > 0

/** Runtime restrictions win over provider metadata, then exact catalogue entries.
 * Evidence must belong to the selected connection/model, not a previous run.
 * No metadata fetch, model invocation, alias guessing or assumed reserve.
 */
export function resolveContextCapacity(provider: ProviderId, model: string, evidence: {
  runtime?: RuntimeCapacityEvidence
  provider?: CapacityEvidence
} = {}): ContextCapacity {
  for (const source of ['runtime', 'provider'] as const) {
    const entry = evidence[source]
    if (!entry || entry.provider !== provider || entry.model !== model ||
        !positive(entry.capacityTokens) || !entry.reference.trim()) continue
    const result: ContextCapacity = {
      capacityTokens: entry.capacityTokens, capacitySource: source, capacityReference: entry.reference,
    }
    if (source === 'runtime') {
      const runtime = entry as RuntimeCapacityEvidence
      if (positive(runtime.compactionThresholdTokens) && runtime.compactionThresholdTokens <= entry.capacityTokens) {
        result.compactionThresholdTokens = runtime.compactionThresholdTokens
        result.compactionThresholdSource = 'runtime'
      }
      if (runtime.reserveTokens !== undefined && Number.isSafeInteger(runtime.reserveTokens) &&
          runtime.reserveTokens >= 0 && runtime.reserveTokens <= entry.capacityTokens) result.reserveTokens = runtime.reserveTokens
    }
    return result
  }
  const entries = catalogue[provider]
  const capacityTokens = entries && Object.hasOwn(entries, model) ? entries[model] : undefined
  return capacityTokens === undefined ? {} : {
    capacityTokens, capacitySource: 'catalog', capacityReference: `workspace-legacy-v1:${provider}/${model}`,
  }
}

/** Compatibility for callers without connection identity; not used by Chat. */
export function modelContextLimit(model: string): number | undefined {
  return resolveContextCapacity('openai', model).capacityTokens ?? resolveContextCapacity('anthropic', model).capacityTokens
}

/** Read only explicit context capacities, never output limits or plan quotas.
 * Optional metadata must not make an otherwise usable model disappear.
 */
export function providerContextCapacity(provider: ProviderId, model: string, metadata: unknown): ContextCapacity {
  const record = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const data = record(metadata)
  const limits = record(record(data.capabilities).limits)
  const candidates: [string, unknown][] = provider === 'copilot'
    ? [['capabilities.limits.max_context_window_tokens', limits.max_context_window_tokens]]
    : [['context_window', data.context_window], ['context_length', data.context_length], ['max_context_window', data.max_context_window]]
  for (const [field, value] of candidates) {
    if (typeof value !== 'number' || !positive(value)) continue
    return resolveContextCapacity(provider, model, { provider: {
      provider, model, capacityTokens: value, reference: `${provider}/models:${model}#${field}`,
    } })
  }
  return resolveContextCapacity(provider, model)
}
