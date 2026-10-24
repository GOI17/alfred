import { expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { generateWithRecovery } from '../src/server/chat-recovery.js'
import { workspaceTools } from '../src/server/workspace-files.js'

function fixture(stopAfter: number) {
  let calls = 0
  const notices: string[] = []
  const controller = new AbortController()
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const index = ++calls
      const reason = index >= stopAfter ? 'stop' : 'length'
      return { stream: new ReadableStream({ start(stream) {
        stream.enqueue({ type: 'text-start', id: 'text' })
        stream.enqueue({ type: 'text-delta', id: 'text', delta: `Part ${index}.` })
        stream.enqueue({ type: 'text-end', id: 'text' })
        stream.enqueue({ type: 'finish', finishReason: { unified: reason, raw: reason }, usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        } })
        stream.close()
      } }) }
    },
  })
  const tools = workspaceTools('.', async () => false)
  return { model, notices, controller, calls: () => calls, input: {
    model, system: 'Complete the task.', messages: [{ role: 'user' as const, content: 'Work' }],
    signal: controller.signal,
    tools: { read_file: tools.read_file, list_directory: tools.list_directory },
    text: () => {}, tool: () => {}, retry: (notice: string) => { notices.push(notice) },
  } }
}

it('automatically continues beyond the former two-retry limit and preserves history', async () => {
  const run = fixture(5)
  await generateWithRecovery(run.input)
  expect(run.calls()).toBe(5)
  expect(run.notices).toHaveLength(4)
  const prompt = JSON.stringify(run.model.doStreamCalls[4].prompt)
  for (let part = 1; part < 5; part++) expect(prompt).toContain(`Part ${part}.`)
})

it('bounds automatic continuations instead of looping forever', async () => {
  const run = fixture(Infinity)
  await expect(generateWithRecovery(run.input)).rejects.toThrow('safety limit')
  expect(run.calls()).toBe(51)
})

it('honors cancellation between normal continuations', async () => {
  const run = fixture(5)
  await expect(generateWithRecovery({ ...run.input, retry: () => run.controller.abort() })).rejects.toBeDefined()
  expect(run.calls()).toBe(1)
})
