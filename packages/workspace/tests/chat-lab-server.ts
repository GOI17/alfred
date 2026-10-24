// Test-only entrypoint. Never imported by the production server.
import { MockLanguageModelV4 } from 'ai/test'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createApp } from '../src/server/app.js'
import { gitFixture } from './fixtures.js'

// Fail closed: this test process must never contact a real provider.
globalThis.fetch = async () => { throw new Error('External fetch is disabled in the chat lab') }
const files = await gitFixture()
const harnessHome = join(files.root, 'harness-home')
await mkdir(harnessHome)
await mkdir(join(files.repository, '.opencode/commands'), { recursive: true })
await mkdir(join(files.repository, '.opencode/skills/lab-skill'), { recursive: true })
await mkdir(join(files.repository, '.opencode/agents'), { recursive: true })
await writeFile(join(files.repository, '.opencode/commands/lab-review.md'), '---\ndescription: Review the lab fixture\n---\nReview $ARGUMENTS carefully.')
await writeFile(join(files.repository, '.opencode/skills/lab-skill/SKILL.md'), '---\nname: lab-skill\ndescription: Synthetic testing skill\n---\nUse focused lab checks.')
await writeFile(join(files.repository, '.opencode/agents/lab-reviewer.md'), '---\nname: lab-reviewer\ndescription: Synthetic reviewer\n---\nReport regressions clearly.')
await writeFile(join(files.repository, 'AGENTS.md'), 'Use the lab fixture only.')
await writeFile(join(files.repository, 'opencode.jsonc'), '{"mcp":{"lab-mcp":{"type":"remote","url":"https://example.invalid/mcp","oauth":false,"headers":{"Authorization":"Bearer lab-private-header"}}}}')
await files.git('add', '.opencode', 'AGENTS.md', 'opencode.jsonc')
await files.git('commit', '-m', 'Add synthetic harness resources')
const model = new MockLanguageModelV4({
  doStream: async ({ prompt, abortSignal }) => {
    const latest = prompt.filter((message) => message.role === 'user').at(-1)
    const text = JSON.stringify(latest?.content ?? '')
    await delay(text.includes('[slow]') ? 3000 : 100, undefined, { signal: abortSignal })
    return { stream: new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue({ type: 'text-start', id: 'lab' })
          for (const delta of ['Lab response. ', 'Streaming completed.']) {
            await delay(250, undefined, { signal: abortSignal })
            controller.enqueue({ type: 'text-delta', id: 'lab', delta })
          }
          controller.enqueue({ type: 'text-end', id: 'lab' })
          controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' },
            usage: { inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 5, text: 5, reasoning: 0 } } })
          controller.close()
        } catch (error) { controller.error(error) }
      },
    }) }
  },
})
const { app, service } = await createApp({
  directory: join(files.root, 'data'), token: 'alfred-chat-lab-only', dev: true, model,
  harnessEnvironment: { home: harnessHome, env: { PATH: '' } },
})
// A synthetic connection makes the real composer available without contacting a provider.
await service.store.update((db) => {
  db.providers = [{ id: 'openai', model: 'lab-model', encryptedKey: service.vault.encrypt('lab-not-a-real-key') }]
})
const project = await service.addProject(files.repository)
await service.addConversation(project.id, files.repository)
let closing = false
async function close() {
  if (closing) return
  closing = true
  await app.close()
  await rm(files.root, { recursive: true, force: true })
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  void close().then(() => process.exit(0))
})
await app.listen({ host: '127.0.0.1', port: 4312 })
console.log('Chat lab: http://127.0.0.1:4312 — code: alfred-chat-lab-only')
