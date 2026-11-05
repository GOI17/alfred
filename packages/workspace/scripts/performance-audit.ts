// Synthetic, local-only audit. No providers, application data or credentials.
// Run: pnpm --dir packages/workspace exec tsx scripts/performance-audit.ts
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { performance, monitorEventLoopDelay } from 'node:perf_hooks'
import { StreamProjection } from '../src/server/stream-projection.js'
import { Store } from '../src/server/store.js'
import { StateStream } from '../src/server/state-stream.js'
import { applyStateDelta } from '../src/shared/state-delta.js'
import { databaseSchema } from '../src/shared/contracts.js'

function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return { medianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(3), p95Ms: +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))].toFixed(3) }
}
function sample(run: () => unknown, count = 30) {
  for (let i = 0; i < 5; i++) run()
  return summary(Array.from({ length: count }, () => { const start = performance.now(); run(); return performance.now() - start }))
}
const results = []
for (const [count, conversationCount] of [[100, 10], [1000, 100], [10000, 100], [10000, 1]]) {
  const root = await mkdtemp(join(tmpdir(), 'alfred-performance-audit-'))
  try {
    const data = databaseSchema.parse({ version: 1, projects: [], providers: [], chatgptAccounts: [],
      conversations: Array.from({ length: conversationCount }, () => ({ id: randomUUID(), projectId: randomUUID(), title: 'Synthetic chat', workspacePath: '/synthetic', createdAt: new Date().toISOString(), layout: { type: 'pane', id: randomUUID(), kind: 'chat' },
        messages: Array.from({ length: count / conversationCount }, () => ({ id: randomUUID(), role: 'user', text: 'x'.repeat(2000), notes: [], createdAt: new Date().toISOString() })) })) })
    await writeFile(join(root, 'workspace.json'), JSON.stringify(data))
    const store = await new Store(root).open()
    store.publicProjection()
    const warmProjection = sample(() => store.publicProjection())
    const legacyFullClone = sample(() => store.get())
    const commitTimes: number[] = [], projectionTimes: number[] = [], metadataTimes: number[] = []
    for (let i = 0; i < 32; i++) {
      let start = performance.now()
      await store.updateConversation(data.conversations[0].id, item => { item!.title = `Synthetic ${i}` })
      commitTimes.push(performance.now() - start)
      start = performance.now()
      store.publicProjection()
      projectionTimes.push(performance.now() - start)
    }
    for (let i = 0; i < 32; i++) {
      const start = performance.now()
      await store.updateConversationMetadata(data.conversations[0].id, item => { item!.title = `Metadata ${i}` })
      metadataTimes.push(performance.now() - start)
    }
    const recoveryTimes = []
    for (let i = 0; i < 5; i++) {
      const start = performance.now()
      await new Store(root).open()
      recoveryTimes.push(performance.now() - start)
    }
    // CPU-only replay comparison: identical in-memory input, excluding filesystem I/O.
    const transactions = await Promise.all((await readdir(join(root, 'journal'))).filter(name => name.endsWith('.json')).sort()
      .map(async name => JSON.parse(await readFile(join(root, 'journal', name), 'utf8'))))
    const legacyReplayCPU = sample(() => {
      let current = data
      for (const entry of transactions) current = databaseSchema.parse(applyStateDelta(current, entry.delta))
    }, 5)
    let wire = store.publicProjection()
    const stream = new StateStream(() => wire, true)
    let frame = stream.frame()
    const snapshotBytes = Buffer.byteLength(frame.data)
    const deltaTimes: number[] = []
    for (let i = 0; i < 30; i++) {
      const conversation = wire.conversations[0]
      const messages = [...conversation.messages]
      messages[messages.length - 1] = { ...messages.at(-1)!, text: messages.at(-1)!.text + 'token' }
      wire = { ...wire, conversations: [{ ...conversation, messages }, ...wire.conversations.slice(1)] }
      stream.invalidate()
      const start = performance.now()
      frame = stream.frame(frame.revision)
      deltaTimes.push(performance.now() - start)
    }
    const projection = new StreamProjection()
    const persisted = store.publicProjection().conversations
    const partial = { ...persisted[0].messages.at(-1)!, text: 'synthetic partial' }
    const partials = { [persisted[0].id]: partial }
    const projectedStreaming = sample(() => projection.conversations(persisted, partials))
    const legacyProjectedStreaming = sample(() => persisted.map(item => {
      const current = partials[item.id]
      return current ? { ...item, messages: [...item.messages.filter(message => message.id !== current.id), JSON.parse(JSON.stringify(current))] } : item
    }))
    // Cross the checkpoint boundary and include its overlapping writes, not just
    // journal-only commits. Event-loop delay is a synthetic workload observation.
    const delay = monitorEventLoopDelay({ resolution: 1 }); delay.enable()
    const checkpointWrites: number[] = []
    const checkpointStart = performance.now()
    for (let i = 0; i < 72; i++) {
      const start = performance.now()
      await store.updateConversationMetadata(data.conversations[0].id, item => { item!.title = `Checkpoint ${i}` })
      checkpointWrites.push(performance.now() - start)
    }
    await store.flush()
    const checkpointBatchMs = performance.now() - checkpointStart
    delay.disable()
    const recovered = await new Store(root).open()
    if (JSON.stringify(recovered.get()) !== JSON.stringify(store.get())) throw new Error('Checkpoint recovery mismatch')
    results.push({ messages: count, conversations: conversationCount, charsPerMessage: 2000,
      projectedStreaming, legacyProjectedStreaming,
      checkpointWrites: summary(checkpointWrites), checkpointBatchMs: +checkpointBatchMs.toFixed(3),
      eventLoopDelay: { p95Ms: +(delay.percentile(95) / 1e6).toFixed(3), maxMs: +(delay.max / 1e6).toFixed(3) },
      warmProjection, legacyFullClone, projectionAfterCommit: summary(projectionTimes), legacyConversationMetadataCommit: summary(commitTimes), isolatedMetadataCommit: summary(metadataTimes),
      recovery64TransactionsWithIO: summary(recoveryTimes), legacyReplay64TransactionsCPUOnly: legacyReplayCPU,
      deltaFrame: summary(deltaTimes), snapshotBytes, patchBytes: Buffer.byteLength(frame.data) })
  } finally { await rm(root, { recursive: true, force: true }) }
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, architecture: process.arch, results }, null, 2))
