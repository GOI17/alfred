import type { Conversation, Message, ProviderId } from './contracts.js'

/** SDK totals already include cached input, including Anthropic cache writes. */
export function contextInputTokens(provider: ProviderId, usage: {
  inputTokens?: number
  raw?: Record<string, unknown>
}): number | undefined {
  // Anthropic SDK totals can aggregate server-side compaction iterations.
  // Do not present that aggregate as a measurement of the last request.
  if (provider === 'anthropic' && Array.isArray(usage.raw?.iterations) && usage.raw.iterations.length) return undefined
  const value = usage.inputTokens
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

export function latestContextUsage(messages: Conversation['messages'], provider: ProviderId, model?: string): Message['contextUsage'] {
  // Never search backwards for an older matching model after a model switch.
  const latest = [...messages].reverse().find((message) => message.role === 'assistant')?.contextUsage
  return latest?.provider === provider && latest.model === model ? latest : undefined
}

export function contextRemaining(usage: NonNullable<Message['contextUsage']>): number | undefined {
  return usage.limit === undefined ? undefined : Math.max(0, usage.limit - usage.inputTokens)
}

/** Only recorded usage: never extrapolate missing historical steps. */
export function conversationConsumption(conversation: Conversation) {
  const responses = conversation.messages.filter((message) => message.role === 'assistant')
  return {
    total: (conversation.compactionTokens || 0) + responses.reduce((sum, message) => sum + (message.consumedTokens || 0), 0),
    incomplete: responses.some((message) => message.consumedTokens === undefined || message.consumptionIncomplete),
  }
}
