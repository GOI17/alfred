import { afterEach, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { conversationConsumption } from '../src/shared/context-usage.js'
import { MockLanguageModelV4 } from 'ai/test'
import { Store } from '../src/server/store.js'
import { WorkspaceService } from '../src/server/service.js'
import { join } from 'node:path'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { providerError } from '../src/server/provider-error.js'
import { gitFixture } from './fixtures.js'

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})
async function setup(model: MockLanguageModelV4) {
  const files = await gitFixture()
  cleanup.push(() => rm(files.root, { recursive: true, force: true }))
  const service = await WorkspaceService.open(join(files.root, 'data'), model)
  cleanup.push(() => service.close())
  const project = await service.addProject(files.repository)
  const conversation = await service.addConversation(project.id, files.repository)
  return { ...files, service, conversation }
}
it('streams native model text, persists it, and owns the agent state on the server', async () => {
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-start', id: 'reply' })
          controller.enqueue({ type: 'text-delta', id: 'reply', delta: 'Una idea propia.' })
          controller.enqueue({ type: 'text-end', id: 'reply' })
          controller.enqueue({
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage,
          })
          controller.close()
        },
      }),
    }),
  })
  const { service, conversation, root } = await setup(model)
  await service.chat.start(conversation.id, 'Hola Alfred', 'openai')
  await expect.poll(() => service.state().agents[conversation.id]?.status).toBe('idle')
  expect(service.state().conversations[0].messages.map((message) => message.text)).toEqual([
    'Hola Alfred',
    'Una idea propia.',
  ])
  expect(await readFile(join(root, 'data', 'workspace.json'), 'utf8')).toContain('Una idea propia.')
  expect(model.doStreamCalls[0].prompt.at(-1)?.role).toBe('user')
  const measured = service.state().conversations[0].messages.at(-1)?.contextUsage
  expect(measured).toMatchObject({ provider: 'openai', inputTokens: 1, outputTokens: 1 })
  const savedUsage = JSON.parse(await readFile(join(root, 'data', 'workspace.json'), 'utf8')).conversations[0].messages.at(-1).contextUsage
  expect(savedUsage).toEqual(measured)
  const savedMessage = JSON.parse(await readFile(join(root, 'data', 'workspace.json'), 'utf8')).conversations[0].messages.at(-1)
  expect(savedMessage.segments).toEqual([{ kind: 'result', text: 'Una idea propia.' }])
})
it('does not write until approval and handles multiple requested writes one at a time', async () => {
  let step = 0
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          if (step++ === 0) {
            controller.enqueue({ type: 'text-start', id: 'progress' })
            controller.enqueue({ type: 'text-delta', id: 'progress', delta: 'Voy a proponer dos archivos.' })
            controller.enqueue({ type: 'text-end', id: 'progress' })
            for (const path of ['one.txt', 'two.txt'])
              controller.enqueue({
                type: 'tool-call',
                toolCallId: path,
                toolName: 'write_file',
                input: JSON.stringify({ path, content: `Content for ${path}` }),
              })
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
              usage,
            })
          } else {
            controller.enqueue({ type: 'text-start', id: 'done' })
            controller.enqueue({ type: 'text-delta', id: 'done', delta: 'Cambios revisados.' })
            controller.enqueue({ type: 'text-end', id: 'done' })
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage,
            })
          }
          controller.close()
        },
      }),
    }),
  })
  const { service, conversation, repository } = await setup(model)
  await service.chat.start(conversation.id, 'Propón dos archivos', 'openai')
  await expect.poll(() => service.state().agents[conversation.id]?.status).toBe('waiting')
  await expect(readFile(join(repository, 'one.txt'))).rejects.toThrow()
  await expect(readFile(join(repository, 'two.txt'))).rejects.toThrow()
  const first = service.state().agents[conversation.id].approval
  if (!first) throw new Error('Missing first approval')
  service.chat.decide(conversation.id, first.id, true)
  await expect.poll(() => service.state().agents[conversation.id]?.approval?.id).not.toBe(first.id)
  const second = service.state().agents[conversation.id].approval
  if (!second) throw new Error('Missing second approval')
  service.chat.decide(conversation.id, second.id, false)
  await expect.poll(() => service.state().agents[conversation.id]?.status).toBe('idle')
  expect(await readFile(join(repository, first.path), 'utf8')).toBe(`Content for ${first.path}`)
  await expect(readFile(join(repository, second.path))).rejects.toThrow()
  expect(service.conversation(conversation.id).messages.at(-1)?.segments).toEqual([
    { kind: 'activity', text: 'Voy a proponer dos archivos.' },
    { kind: 'result', text: 'Cambios revisados.' },
  ])
})
it('queues concurrent turns and stopping cancels approval while persisting the paused queue', async () => {
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: 'tool-call',
            toolCallId: 'change',
            toolName: 'write_file',
            input: JSON.stringify({ path: 'hello.txt', content: 'overwrite' }),
          })
          controller.enqueue({
            type: 'finish',
            finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
            usage,
          })
          controller.close()
        },
      }),
    }),
  })
  const { service, conversation, repository, root } = await setup(model)
  await service.chat.start(conversation.id, 'Cambia el archivo', 'openai')
  await expect.poll(() => service.state().agents[conversation.id]?.status).toBe('waiting')
  await service.chat.start(conversation.id, 'Otro turno', 'openai')
  expect(service.conversation(conversation.id).queue?.map((item) => item.text)).toEqual(['Otro turno'])
  await service.chat.stop(conversation.id)
  expect(service.state().agents[conversation.id]?.status).toBe('idle')
  expect(service.conversation(conversation.id).queuePaused).toBe(true)
  expect(await readFile(join(repository, 'hello.txt'), 'utf8')).toBe('hello\n')
  const saved = JSON.parse(await readFile(join(root, 'data', 'workspace.json'), 'utf8'))
  expect(saved.conversations[0].queue[0].text).toBe('Otro turno')
  expect(saved.conversations[0].queuePaused).toBe(true)
  await service.chat.resume(conversation.id)
  await expect.poll(() => service.state().agents[conversation.id]?.status).toBe('waiting')
  expect(service.conversation(conversation.id).queue).toEqual([])
  expect(service.conversation(conversation.id).messages.filter((item) => item.role === 'user').map((item) => item.text))
    .toEqual(['Cambia el archivo', 'Otro turno'])
  await service.chat.stop(conversation.id)
})

it('interrupts pending approval, prioritizes the new turn and drains remaining messages in order', async () => {
  let step = 0
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          if (step++ === 0) {
            controller.enqueue({ type: 'tool-call', toolCallId: 'change', toolName: 'write_file',
              input: JSON.stringify({ path: 'hello.txt', content: 'not approved' }) })
            controller.enqueue({ type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage })
          } else {
            controller.enqueue({ type: 'text-start', id: 'reply' })
            controller.enqueue({ type: 'text-delta', id: 'reply', delta: 'Respuesta.' })
            controller.enqueue({ type: 'text-end', id: 'reply' })
            controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage })
          }
          controller.close()
        },
      }),
    }),
  })
  const { service, conversation, repository } = await setup(model)
  await service.chat.start(conversation.id, 'Inicial', 'openai')
  await expect.poll(() => service.state().agents[conversation.id]?.status).toBe('waiting')
  const approval = service.state().agents[conversation.id].approval!
  await service.chat.start(conversation.id, 'Pendiente uno', 'openai')
  await service.chat.start(conversation.id, 'Descartar', 'openai')
  const removed = service.conversation(conversation.id).queue!.find((item) => item.text === 'Descartar')!
  await service.chat.removeQueued(conversation.id, removed.id)
  await service.chat.start(conversation.id, 'Pendiente dos', 'openai')
  await service.chat.start(conversation.id, 'Prioritario', 'openai', [], 'interrupt')
  await expect.poll(() => service.conversation(conversation.id).messages.filter((item) => item.role === 'assistant').length).toBe(4)
  expect(service.conversation(conversation.id).messages.filter((item) => item.role === 'user').map((item) => item.text))
    .toEqual(['Inicial', 'Prioritario', 'Pendiente uno', 'Pendiente dos'])
  expect(service.conversation(conversation.id).queue).toEqual([])
  expect(() => service.chat.decide(conversation.id, approval.id, true)).toThrow('no longer pending')
  expect(await readFile(join(repository, 'hello.txt'), 'utf8')).toBe('hello\n')
})

it('preserves a file edited by the user while approval was pending', async () => {
  let step = 0
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          if (step++ === 0) {
            controller.enqueue({
              type: 'tool-call',
              toolCallId: 'change',
              toolName: 'write_file',
              input: JSON.stringify({ path: 'hello.txt', content: 'agent version' }),
            })
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
              usage,
            })
          } else
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage,
            })
          controller.close()
        },
      }),
    }),
  })
  const { service, conversation, repository } = await setup(model)
  await service.chat.start(conversation.id, 'Propón un cambio', 'openai')
  await expect.poll(() => service.state().agents[conversation.id]?.status).toBe('waiting')
  await writeFile(join(repository, 'hello.txt'), 'user version')
  const approval = service.state().agents[conversation.id].approval
  if (!approval) throw new Error('Missing approval')
  service.chat.decide(conversation.id, approval.id, true)
  await expect.poll(() => service.state().agents[conversation.id]?.status).toBe('idle')
  expect(await readFile(join(repository, 'hello.txt'), 'utf8')).toBe('user version')
})

it('does not forward provider error bodies or reflected credentials to the browser', () => {
  const error = Object.assign(new Error('Invalid key: test-private-api-secret'), {
    statusCode: 401,
  })
  expect(providerError(error)).not.toContain('test-private-api-secret')
  expect(providerError(error)).toContain('authorization')
})

it.each([30, 50, 70] as const)('compacts %s percent manually without deleting history or resetting consumption', async (reduction) => {
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({ content: [{ type: 'text', text: 'Keep the original requirements. Work is pending.' }],
      finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] }),
    doStream: async () => ({ stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: 'text-start', id: 'reply' })
      controller.enqueue({ type: 'text-delta', id: 'reply', delta: 'Continued.' })
      controller.enqueue({ type: 'text-end', id: 'reply' })
      controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage })
      controller.close()
    } }) }),
  })
  const { service, conversation } = await setup(model)
  await service.store.update((db) => {
    db.conversations[0].messages = Array.from({ length: 6 }, (_, index) => ({
      id: randomUUID(), role: index % 2 ? 'assistant' : 'user',
      text: index < 4 ? `Old detail ${index}. `.repeat(200) : `Recent ${index}`,
      notes: [], createdAt: new Date().toISOString(), ...(index % 2 ? { consumedTokens: 10 } : {}),
    }))
  })
  const before = service.conversation(conversation.id)
  await service.chat.compact(conversation.id, 'openai', reduction)
  const after = service.conversation(conversation.id)
  expect(after.messages).toEqual(before.messages)
  expect(after.compaction?.throughMessageId).toBe(before.messages[3].id)
  expect(after.compaction?.reduction).toBe(reduction)
  expect(conversationConsumption(after)).toEqual({ total: 32, incomplete: false })
  expect(model.doGenerateCalls[0].tools).toBeUndefined()
  await service.chat.start(conversation.id, 'Continue', 'openai')
  await expect.poll(() => service.state().agents[conversation.id]?.status).toBe('idle')
  const prompt = JSON.stringify(model.doStreamCalls[0].prompt)
  expect(prompt).toContain('Keep the original requirements')
  expect(prompt).toContain('Recent 4')
  expect(prompt).not.toContain('Old detail 0')
  expect(conversationConsumption(service.conversation(conversation.id)).total).toBe(34)
})
it('preserves original context when summary output is incomplete and still counts the call', async () => {
  const model = new MockLanguageModelV4({ doGenerate: async () => ({
    content: [{ type: 'text', text: 'Truncated' }], finishReason: { unified: 'length', raw: 'length' }, usage, warnings: [],
  }) })
  const { service, conversation } = await setup(model)
  await service.store.update((db) => { db.conversations[0].messages = Array.from({ length: 4 }, (_, index) => ({
    id: randomUUID(), role: index % 2 ? 'assistant' : 'user', text: 'Original context. '.repeat(200),
    notes: [], createdAt: new Date().toISOString(),
  })) })
  const before = service.conversation(conversation.id).messages
  await expect(service.chat.compact(conversation.id, 'openai', 30)).rejects.toThrow('incomplete')
  const after = service.conversation(conversation.id)
  expect(after.messages).toEqual(before)
  expect(after.compaction).toBeUndefined()
  expect(conversationConsumption(after)).toEqual({ total: 2, incomplete: true })
})


it('persists completed steps before continuation and replaces checkpoints without double counting', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let step = 0
  const model = new MockLanguageModelV4({ doStream: async () => {
    const first = step++ === 0
    if (!first) await gate
    return { stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: 'text-start', id: 'reply' })
      controller.enqueue({ type: 'text-delta', id: 'reply', delta: first ? 'First step.' : 'Done.' })
      controller.enqueue({ type: 'text-end', id: 'reply' })
      controller.enqueue({ type: 'finish', finishReason: first
        ? { unified: 'length', raw: 'length' } : { unified: 'stop', raw: 'stop' }, usage })
      controller.close()
    } }) }
  } })
  const { service, conversation, root } = await setup(model)
  try {
    await service.chat.start(conversation.id, 'Continue automatically', 'openai')
    await expect.poll(() => step).toBe(2)
    const reopened = await new Store(join(root, 'data')).open()
    const checkpoint = reopened.get().conversations[0]
    expect(conversationConsumption(checkpoint)).toEqual({ total: 2, incomplete: true })
    expect(checkpoint.messages.at(-1)?.text).toContain('First step.')
    expect(service.state().conversations[0].messages.filter((m) => m.role === 'assistant')).toHaveLength(1)
    expect(conversationConsumption(service.state().conversations[0]).total).toBe(2)
  } finally { release() }
  await expect.poll(() => service.chat.isRunning(conversation.id)).toBe(false)
  const reopened = await new Store(join(root, 'data')).open()
  expect(reopened.get().conversations[0].messages.filter((m) => m.role === 'assistant')).toHaveLength(1)
  expect(conversationConsumption(reopened.get().conversations[0])).toEqual({ total: 4, incomplete: false })
})

it('a new idle turn resumes a persisted paused queue in FIFO order', async () => {
  const model = new MockLanguageModelV4({ doStream: async () => ({
    stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: 'text-start', id: 'reply' })
      controller.enqueue({ type: 'text-delta', id: 'reply', delta: 'Done.' })
      controller.enqueue({ type: 'text-end', id: 'reply' })
      controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage })
      controller.close()
    } }),
  }) })
  const { service, conversation } = await setup(model)
  await service.store.update((db) => {
    const current = db.conversations[0]
    current.queuePaused = true
    current.queue = [{ id: randomUUID(), text: 'Older turn', provider: 'openai', attachments: [], createdAt: new Date().toISOString() }]
  })
  await service.chat.start(conversation.id, 'New turn', 'openai')
  await expect.poll(() => service.conversation(conversation.id).messages.filter((m) => m.role === 'assistant').length).toBe(2)
  await expect.poll(() => service.chat.isRunning(conversation.id)).toBe(false)
  expect(service.conversation(conversation.id).queuePaused).toBe(false)
  expect(service.conversation(conversation.id).queue).toEqual([])
  expect(service.conversation(conversation.id).messages.filter((m) => m.role === 'user').map((m) => m.text))
    .toEqual(['Older turn', 'New turn'])
})

it.each(['reject', 'hang'])('releases the run when tool cleanup will %s and allows a new turn', async (failure) => {
  const model = new MockLanguageModelV4({ doStream: async () => ({
    stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: 'text-start', id: 'reply' })
      controller.enqueue({ type: 'text-delta', id: 'reply', delta: 'Done.' })
      controller.enqueue({ type: 'text-end', id: 'reply' })
      controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage })
      controller.close()
    } }),
  }) })
  const { service, conversation } = await setup(model)
  service.adapter.legacyBindings!.capabilities = async () => ({ tools: {}, close: async () => {
    if (failure === 'reject') throw new Error('Cleanup failed')
    await new Promise<void>(() => {})
  } })
  await service.chat.start(conversation.id, 'First', 'openai')
  await expect.poll(() => service.chat.isRunning(conversation.id), { timeout: 8000 }).toBe(false)
  expect(service.conversation(conversation.id).queuePaused).toBe(true)
  expect(service.state().agents[conversation.id]?.status).toBe('error')
  service.adapter.legacyBindings!.capabilities = undefined
  await service.chat.start(conversation.id, 'Continue', 'openai')
  await expect.poll(() => service.chat.isRunning(conversation.id)).toBe(false)
  expect(service.conversation(conversation.id).queue).toEqual([])
  expect(service.state().agents[conversation.id]?.status).toBe('idle')
}, 15000)
