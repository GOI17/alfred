import type { UsageRecord } from './usage-metrics.js'

/** AI SDK boundary, not raw provider JSON. All supported adapters use inclusive totals. */
export type SdkUsage = {
  inputTokens?: number
  outputTokens?: number
  inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number }
  outputTokenDetails?: { reasoningTokens?: number }
}
export type NormalizedUsage = Pick<UsageRecord,
  'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens' | 'quality'> & {
  invalidFields: string[]
}

/** Never reconstruct totals from subsets or interpret a missing counter as zero. */
export function normalizeSdkUsage(usage: SdkUsage): NormalizedUsage {
  const invalidFields: string[] = []
  const counter = (value: number | undefined, field: string) => {
    if (value === undefined) return undefined
    if (Number.isSafeInteger(value) && value >= 0) return value
    invalidFields.push(field)
    return undefined
  }
  const inputTokens = counter(usage.inputTokens, 'inputTokens')
  const outputTokens = counter(usage.outputTokens, 'outputTokens')
  let cacheReadTokens = counter(usage.inputTokenDetails?.cacheReadTokens, 'cacheReadTokens')
  let cacheWriteTokens = counter(usage.inputTokenDetails?.cacheWriteTokens, 'cacheWriteTokens')
  let reasoningTokens = counter(usage.outputTokenDetails?.reasoningTokens, 'reasoningTokens')
  if ((cacheReadTokens !== undefined || cacheWriteTokens !== undefined) &&
      (inputTokens === undefined || (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0) > inputTokens)) {
    invalidFields.push('cacheDetails')
    cacheReadTokens = undefined
    cacheWriteTokens = undefined
  }
  if (reasoningTokens !== undefined && (outputTokens === undefined || reasoningTokens > outputTokens)) {
    invalidFields.push('reasoningTokens')
    reasoningTokens = undefined
  }
  const quality = inputTokens === undefined && outputTokens === undefined ? 'unavailable'
    : inputTokens === undefined || outputTokens === undefined || invalidFields.length ? 'partial' : 'measured'
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, quality, invalidFields }
}
