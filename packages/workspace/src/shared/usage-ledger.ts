import { usageRecordSchema, type UsageRecord } from './usage-metrics.js'

const total = (record?: UsageRecord) => (record?.inputTokens ?? 0) + (record?.outputTokens ?? 0)

/** Snapshots replace snapshots, never sum subsets or cumulative observations. */
export function reconcileUsage(records: UsageRecord[], incoming: UsageRecord): number {
  const next = usageRecordSchema.parse(incoming)
  const index = records.findIndex(record => record.id === next.id)
  const previous = records[index]
  if (previous) {
    for (const field of ['conversationId', 'turnId', 'provider', 'model', 'purpose', 'parentCallId'] as const) {
      if (previous[field] !== next[field]) throw new Error('Usage identity conflict')
    }
    const rank = { unavailable: 0, partial: 1, estimated: 2, measured: 3 }
    if (Date.parse(next.observedAt) < Date.parse(previous.observedAt) || rank[next.quality] < rank[previous.quality]) return 0
    if (next.quality === 'partial') {
      // Partial observations may enrich an earlier observation, not erase it.
      for (const field of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'cost'] as const) {
        if (next[field] === undefined && previous[field] !== undefined) Object.assign(next, { [field]: previous[field] })
      }
      usageRecordSchema.parse(next)
    }
  }
  const delta = total(next) - total(previous)
  if (index < 0) records.push(next)
  else records[index] = next
  return delta
}
