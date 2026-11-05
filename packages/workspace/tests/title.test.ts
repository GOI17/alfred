import { afterEach, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import { WorkspaceService } from '../src/server/service.js'
import { gitFixture } from './fixtures.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

async function setup(text: string) {
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } },
      warnings: [],
    }),
  })
  const files = await gitFixture()
  cleanup.push(() => rm(files.root, { recursive: true, force: true }))
  const service = await WorkspaceService.open(join(files.root, 'data'), model)
  cleanup.push(() => service.close())
  const project = await service.addProject(files.repository)
  const conversation = await service.addConversation(project.id, files.repository)
  await service.store.update((db) => {
    const current = db.conversations.find((item) => item.id === conversation.id)!
    current.title = 'Título anterior'
    current.lastProvider = 'openai'
    current.messages = [{ id: 'recent', role: 'user', text: 'Ahora quiero regenerar el título con contexto reciente', createdAt: new Date().toISOString(), notes: [] }]
  })
  return { service, conversation, model }
}

it('regenerates the title from recent context without changing messages', async () => {
  const { service, conversation, model } = await setup('Títulos con contexto reciente')
  const messages = structuredClone(service.conversation(conversation.id).messages)
  await service.chat.regenerateTitle!(conversation.id)
  expect(service.conversation(conversation.id).title).toBe('Títulos con contexto reciente')
  expect(service.conversation(conversation.id).messages).toEqual(messages)
  expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain('Ahora quiero regenerar')
  expect(model.doGenerateCalls[0].tools?.length || 0).toBe(0)
})

it('preserves the existing title when the generated title is empty', async () => {
  const { service, conversation } = await setup('  ')
  await expect(service.chat.regenerateTitle!(conversation.id)).rejects.toThrow('existing title was preserved')
  expect(service.conversation(conversation.id).title).toBe('Título anterior')
})
