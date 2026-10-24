import { expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { generateWithRecovery, transientError } from '../src/server/chat-recovery.js'
import { modelContextLimit, contextUsageSchema } from '../src/shared/contracts.js'
import { workspaceTools } from '../src/server/workspace-files.js'

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}
function options(model: MockLanguageModelV4, controller = new AbortController()) {
  const tools = workspaceTools('.', async () => false)
  const text: string[] = []
  const notices: string[] = []
  return {
    text, notices,
    input: {
      model, messages: [{ role: 'user' as const, content: 'Continúa el trabajo' }],
      system: 'Responde brevemente.', signal: controller.signal,
      tools: { list_directory: tools.list_directory, read_file: tools.read_file },
      text: (part: string) => { text.push(part) },
      tool: () => {},
      retry: (notice: string) => { notices.push(notice) },
    },
  }
}

it('classifies transient failures without retrying authorization errors', () => {
  expect(transientError({ statusCode: 429 })).toBe(true)
  expect(transientError({ cause: { code: 'ECONNRESET' } })).toBe(true)
  expect(transientError({ statusCode: 401 })).toBe(false)
  expect(transientError({ statusCode: 403 })).toBe(false)
  expect(transientError(new Error('invalid request'))).toBe(false)
})

it('continues a truncated response with the previous text in context', async () => {
  let calls = 0
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const first = calls++ === 0
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text-start', id: 'reply' })
            controller.enqueue({ type: 'text-delta', id: 'reply', delta: first ? 'Primera parte.' : 'Segunda parte.' })
            controller.enqueue({ type: 'text-end', id: 'reply' })
            controller.enqueue({ type: 'finish', finishReason: { unified: first ? 'length' : 'stop', raw: first ? 'length' : 'stop' }, usage })
            controller.close()
          },
        }),
      }
    },
  })
  const run = options(model)
  const measurements: { inputTokens?: number; outputTokens?: number }[] = []
  await generateWithRecovery({ ...run.input, usage: (value) => { measurements.push(value) } })
  expect(measurements).toHaveLength(2)
  expect(measurements.map(({ inputTokens, outputTokens }) => ({ inputTokens, outputTokens }))).toEqual([
    { inputTokens: 1, outputTokens: 1 }, { inputTokens: 1, outputTokens: 1 },
  ])
  expect(calls).toBe(2)
  expect(run.notices).toHaveLength(1)
  expect(run.text.join('')).toContain('Primera parte.')
  expect(run.text.join('')).toContain('Segunda parte.')
  expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain('Primera parte.')
})

it('stops after two retries for transient provider failures', async () => {
  let calls = 0
  const failure = Object.assign(new Error('unavailable'), { statusCode: 503 })
  const model = new MockLanguageModelV4({ doStream: async () => { calls++; throw failure } })
  const run = options(model)
  await expect(generateWithRecovery(run.input)).rejects.toBeDefined()
  expect(calls).toBe(3)
  expect(run.notices).toHaveLength(2)
}, 10000)

it('does not retry an authorization failure', async () => {
  let calls = 0
  const model = new MockLanguageModelV4({ doStream: async () => {
    calls++
    throw Object.assign(new Error('unauthorized'), { statusCode: 401 })
  } })
  const run = options(model)
  await expect(generateWithRecovery(run.input)).rejects.toBeDefined()
  expect(calls).toBe(1)
  expect(run.notices).toEqual([])
})

it('cancels recovery before another provider request', async () => {
  let calls = 0
  const controller = new AbortController()
  const model = new MockLanguageModelV4({ doStream: async () => {
    calls++
    throw Object.assign(new Error('unavailable'), { statusCode: 503 })
  } })
  const run = options(model, controller)
  await expect(generateWithRecovery({
    ...run.input,
    retry: () => controller.abort(),
  })).rejects.toBeDefined()
  expect(calls).toBe(1)
})

it('does not invent limits for unknown models and preserves usage metadata', () => {
  expect(modelContextLimit('gpt-4o')).toBe(128000)
  expect(modelContextLimit('custom-model')).toBeUndefined()
  expect(contextUsageSchema.parse({ provider: 'openai', model: 'custom-model', inputTokens: 100, outputTokens: 20, measuredAt: new Date().toISOString() }).limit).toBeUndefined()
  expect(contextUsageSchema.safeParse({ provider: 'openai', model: 'x', inputTokens: -1, outputTokens: 0, measuredAt: '' }).success).toBe(false)
})
