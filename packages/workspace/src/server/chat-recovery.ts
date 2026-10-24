import { setTimeout as delay } from 'node:timers/promises'
import { streamText, stepCountIs, type LanguageModel, type ModelMessage, type LanguageModelUsage } from 'ai'
import type { workspaceTools } from './workspace-files.js'

export function transientError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > 5) return false
  const value = error as { statusCode?: number; code?: string; name?: string; cause?: unknown }
  if (value.statusCode !== undefined)
    return [408, 429, 500, 502, 503, 504].includes(value.statusCode)
  if (['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'].includes(value.code || '')) return true
  if (['TimeoutError', 'AI_NoOutputGeneratedError'].includes(value.name || '')) return true
  return value.cause !== error && value.cause !== undefined && transientError(value.cause, depth + 1)
}

/** Continue from completed steps, never replay a tool with an unknown outcome. */
export async function generateWithRecovery(options: {
  model: LanguageModel
  messages: ModelMessage[]
  system: string
  tools: ReturnType<typeof workspaceTools> | Pick<ReturnType<typeof workspaceTools>, 'list_directory' | 'read_file'>
  signal: AbortSignal
  text: (text: string) => void
  tool: (name: string) => void
  usage?: (usage: LanguageModelUsage) => void | Promise<void>
  retry: (notice: string) => void
}) {
  let messages = [...options.messages]
  let retries = 0
  let continuations = 0
  const maxContinuations = 50
  while (true) {
    options.signal.throwIfAborted()
    let completed: ModelMessage[] = []
    let unfinishedText = ''
    let uncertainTools = false
    let recoverable = false
    let continuation = false
    let failure: unknown
    try {
      const output = streamText({
        model: options.model, messages, system: options.system, tools: options.tools,
        abortSignal: options.signal, stopWhen: stepCountIs(12),
        maxOutputTokens: 8192, maxRetries: 0, providerOptions: { openai: { store: false } },
        onStepFinish: async ({ response, usage }) => { completed = [...response.messages]; await options.usage?.(usage) },
      })
      for await (const part of output.fullStream) {
        if (part.type === 'text-delta') {
          unfinishedText += part.text
          options.text(part.text)
        } else if (part.type === 'tool-call') {
          uncertainTools = true
          options.tool(part.toolName)
        } else if (part.type === 'finish-step') {
          unfinishedText = ''
          uncertainTools = false
        } else if (part.type === 'error') throw part.error
      }
      options.signal.throwIfAborted()
      const reason = await output.finishReason
      if (reason === 'stop') return
      recoverable = ['length', 'tool-calls', 'unknown', 'error'].includes(reason)
      // A normal SDK step/output limit is not a provider failure. Continue it
      // independently of the transient-error budget, but only with progress.
      continuation = ['length', 'tool-calls'].includes(reason) && completed.some((message) =>
        typeof message.content === 'string' ? message.content.length > 0 : message.content.length > 0)
      failure = new Error(reason === 'content-filter'
        ? 'The provider stopped the response due to its content filters.'
        : 'The provider repeatedly returned an incomplete response without recoverable progress.')
    } catch (error) {
      options.signal.throwIfAborted()
      failure = error
      recoverable = transientError(error)
    }
    if (uncertainTools) throw new Error('Automatic recovery stopped because a tool outcome is unknown. Verify its result before continuing.')
    if (!recoverable) throw failure
    if (continuation) {
      if (continuations >= maxContinuations)
        throw new Error('Automatic continuation reached its safety limit (50 continuations). Review progress before continuing.')
      continuations++
      retries = 0
    } else {
      if (retries >= 2) throw failure
      retries++
    }
    messages = [...messages, ...completed]
    if (unfinishedText) messages.push({ role: 'assistant', content: unfinishedText })
    if (completed.length || unfinishedText) {
      messages.push({ role: 'user', content: 'Continue from the point of interruption and finish the original task. Do not ask the user to say continue. Do not repeat text or operations already completed; use the tool results included in the history. Do not repeat operations with unknown outcomes. Keep all existing permissions and approval requirements.' })
      options.text('\n\n')
    }
    options.retry(continuation
      ? `Continuing automatically (${continuations}/${maxContinuations})…`
      : `Recovering response: attempt ${retries}/2…`)
    if (!continuation) await delay(1000 * 2 ** (retries - 1), undefined, { signal: options.signal })
  }
}
