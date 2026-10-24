import { afterEach, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { join } from 'node:path'
import { readFile, rm } from 'node:fs/promises'
import { WorkspaceService } from '../src/server/service.js'
import { gitFixture } from './fixtures.js'
import { permissionModeSchema } from '../src/shared/contracts.js'

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

it('accepts YOLO as a permission mode but rejects unknown modes', () => {
  expect(permissionModeSchema.parse('full-access')).toBe('full-access')
  expect(permissionModeSchema.safeParse('unknown').success).toBe(false)
})

it('writes files and batches automatically in YOLO, persists the mode and restores approvals', async () => {
  let step = 0
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          const current = step++
          if (current === 0 || current === 2) {
            controller.enqueue({ type: 'tool-call', toolCallId: `single-${current}`, toolName: 'write_file',
              input: JSON.stringify({ path: 'hello.txt', content: current === 0 ? 'YOLO saved' : 'requires approval' }) })
            if (current === 0) {
              controller.enqueue({ type: 'tool-call', toolCallId: 'batch', toolName: 'write_files',
                input: JSON.stringify({ files: [{ path: 'batch.txt', content: 'batch saved' }] }) })
              controller.enqueue({ type: 'tool-call', toolCallId: 'outside', toolName: 'write_file',
                input: JSON.stringify({ path: '../outside.txt', content: 'must not write' }) })
              controller.enqueue({ type: 'tool-call', toolCallId: 'private', toolName: 'write_file',
                input: JSON.stringify({ path: '.env', content: 'must not write' }) })
            }
            controller.enqueue({ type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage })
          } else {
            controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage })
          }
          controller.close()
        },
      }),
    }),
  })
  const files = await gitFixture()
  cleanup.push(() => rm(files.root, { recursive: true, force: true }))
  const service = await WorkspaceService.open(join(files.root, 'data'), model)
  cleanup.push(() => service.close())
  const project = await service.addProject(files.repository)
  const conversation = await service.addConversation(project.id, files.repository)
  await service.chat.setPermission(conversation.id, 'full-access')
  await service.chat.start(conversation.id, 'Guarda los cambios', 'openai')
  await expect.poll(() => service.state().agents[conversation.id]?.status).toBe('idle')
  expect(await readFile(join(files.repository, 'hello.txt'), 'utf8')).toBe('YOLO saved')
  expect(await readFile(join(files.repository, 'batch.txt'), 'utf8')).toBe('batch saved')
  await expect(readFile(join(files.repository, '../outside.txt'))).rejects.toThrow()
  await expect(readFile(join(files.repository, '.env'))).rejects.toThrow()
  const saved = JSON.parse(await readFile(join(files.root, 'data', 'workspace.json'), 'utf8'))
  expect(saved.conversations[0].permissionMode).toBe('full-access')
  await service.chat.setPermission(conversation.id, 'approval')
  await service.chat.start(conversation.id, 'Otro cambio', 'openai')
  await expect.poll(() => service.state().agents[conversation.id]?.status).toBe('waiting')
  await expect(service.chat.setPermission(conversation.id, 'full-access')).rejects.toThrow('Stop the agent')
  expect(await readFile(join(files.repository, 'hello.txt'), 'utf8')).toBe('YOLO saved')
  await service.chat.stop(conversation.id)
})
