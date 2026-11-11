import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { reconcileUsage } from '../src/shared/usage-ledger.js'
import type { UsageRecord } from '../src/shared/usage-metrics.js'
import { Store } from '../src/server/store.js'

const record = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
  id: 'attempt:0', conversationId: 'conversation', turnId: 'turn', provider: 'openai', model: 'test',
  purpose: 'response', source: 'provider', freshness: 'current', quality: 'measured',
  observedAt: '2026-01-01T00:00:00Z', inputTokens: 100, outputTokens: 20, cacheReadTokens: 80,
  reasoningTokens: 10, ...overrides,
})
it('deduplicates repeated events and applies corrections by difference, including zero', () => {
  const records: UsageRecord[] = []
  expect(reconcileUsage(records, record())).toBe(120)
  expect(reconcileUsage(records, record())).toBe(0)
  expect(reconcileUsage(records, record({ outputTokens: 30 }))).toBe(10)
  expect(reconcileUsage(records, record({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0 }))).toBe(-130)
  expect(records).toHaveLength(1)
})
it('enriches partial observations and reconciles final measurements', () => {
  const records: UsageRecord[] = []
  expect(reconcileUsage(records, record({ quality: 'partial', outputTokens: undefined, reasoningTokens: undefined }))).toBe(100)
  expect(reconcileUsage(records, record())).toBe(20)
  expect(reconcileUsage(records, record({ quality: 'unavailable', inputTokens: undefined, outputTokens: undefined, cacheReadTokens: undefined, reasoningTokens: undefined }))).toBe(0)
  expect(records[0].quality).toBe('measured')
})
it('ignores stale events and rejects identity collisions without mutating records', () => {
  const records = [record()]
  expect(reconcileUsage(records, record({ observedAt: '2025-01-01T00:00:00Z', outputTokens: 50 }))).toBe(0)
  expect(() => reconcileUsage(records, record({ model: 'other' }))).toThrow('identity conflict')
  expect(records).toEqual([record()])
})
it('counts distinct attempts independently even when their usage is identical', () => {
  const records: UsageRecord[] = []
  expect(reconcileUsage(records, record())).toBe(120)
  expect(reconcileUsage(records, record({ id: 'retry:0' }))).toBe(120)
  expect(records).toHaveLength(2)
})
const directories: string[] = []
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }) })
it('roundtrips the journal, preserves legacy totals and deduplicates after reopening', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'usage-ledger-'))
  directories.push(directory)
  const store = await new Store(directory).open()
  const id = randomUUID()
  await store.update(db => { db.conversations.push({ id, projectId: randomUUID(), workspacePath: '/test',
    title: 'Legacy', createdAt: '2026-01-01', layout: { type: 'pane', id: randomUUID(), kind: 'chat' },
    messages: [{ id: randomUUID(), role: 'assistant', text: 'Historical', notes: [], createdAt: '2026-01-01', consumedTokens: 900 }],
    compactionTokens: 50,
  }) })
  expect(store.conversation(id)?.usageRecords).toBeUndefined()
  await store.updateConversationMetadata(id, current => {
    const delta = reconcileUsage(current!.usageRecords ||= [], record({ conversationId: id, purpose: 'compaction' }))
    current!.compactionTokens! += delta
  })
  const reopened = await new Store(directory).open()
  await reopened.updateConversationMetadata(id, current => {
    const delta = reconcileUsage(current!.usageRecords!, record({ conversationId: id, purpose: 'compaction' }))
    current!.compactionTokens! += delta
  })
  const saved = reopened.conversation(id)!
  expect(saved.messages[0].consumedTokens).toBe(900)
  expect(saved.compactionTokens).toBe(170)
  expect(saved.usageRecords).toEqual([record({ conversationId: id, purpose: 'compaction' })])
})
