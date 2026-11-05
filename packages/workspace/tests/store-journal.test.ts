import { afterEach, expect, test } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { conversationSchema } from '../src/shared/contracts.js'
import { Store } from '../src/server/store.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'workspace-journal-')); roots.push(root)
  return { root, store: await new Store(root).open() }
}
test('replays small transactions and preserves the legacy checkpoint', async () => {
  const { root, store } = await fixture()
  await store.update(db => { db.providers.push({ id: 'openai', model: 'test', encryptedKey: 'test' }) })
  const checkpoint = await readFile(join(root, 'workspace.json'), 'utf8')
  await store.update(db => { db.providers[0].model = 'next' })
  expect(await readFile(join(root, 'workspace.json'), 'utf8')).toBe(checkpoint)
  expect((await new Store(root).open()).get()).toEqual(store.get())
  expect((await readdir(join(root, 'journal'))).filter(name => name.endsWith('.json'))).toHaveLength(2)
})
test('failed changes are not committed; queued changes still succeed', async () => {
  const { root, store } = await fixture()
  await expect(store.update(db => { db.version = 2 as 1 })).rejects.toThrow()
  await expect(store.update(() => { throw new Error('abort') })).rejects.toThrow('abort')
  await store.update(db => { db.activeChatgptAccount = 'ok' })
  expect((await new Store(root).open()).get()).toEqual(store.get())
})
test('compacts the journal and ignores an incomplete temporary write', async () => {
  const { root, store } = await fixture()
  for (let i = 0; i < 132; i++) await store.update(db => { db.activeChatgptAccount = String(i) })
  await store.flush()
  await writeFile(join(root, 'journal', 'incomplete.tmp'), '{')
  expect((await new Store(root).open()).get()).toEqual(store.get())
  expect((await readdir(join(root, 'journal'))).length).toBeLessThan(10)
})
test('rejects missing transactions rather than silently losing data', async () => {
  const { root, store } = await fixture()
  await store.update(db => { db.activeChatgptAccount = 'one' })
  await store.update(db => { db.activeChatgptAccount = 'two' })
  await rm(join(root, 'journal', '0000000000000001.json'))
  await expect(new Store(root).open()).rejects.toThrow('missing transaction')
})
test('reads and migrates a legacy database without rewriting it', async () => {
  const { root, store } = await fixture()
  const legacy = { ...store.get(), activeChatgptAccount: 'legacy' }
  await writeFile(join(root, 'workspace.json'), JSON.stringify(legacy))
  const migrated = await new Store(root).open()
  await migrated.update(db => { delete db.activeChatgptAccount })
  expect((await new Store(root).open()).get()).toEqual(migrated.get())
  expect(JSON.parse(await readFile(join(root, 'workspace.json'), 'utf8'))).toEqual(legacy)
})

test('conversation transactions serialize with global writes and isolate drafts', async () => {
  const { root, store } = await fixture()
  const conversation = conversationSchema.parse({ id: randomUUID(), projectId: randomUUID(), workspacePath: '/fixture', title: 'Before', createdAt: new Date().toISOString(), layout: { type: 'pane', id: randomUUID(), kind: 'chat' } })
  await store.update(db => { db.conversations.push(conversation) })
  const [draft] = await Promise.all([
    store.updateConversation(conversation.id, async current => { await Promise.resolve(); current!.title = 'After'; return current! }),
    store.update(db => { db.activeChatgptAccount = 'queued' }),
    store.updateConversation(conversation.id, current => { current!.queuePaused = true }),
  ])
  draft.title = 'must not leak'
  expect(store.conversation(conversation.id)).toMatchObject({ title: 'After', queuePaused: true })
  expect(store.get().activeChatgptAccount).toBe('queued')
  expect((await new Store(root).open()).get()).toEqual(store.get())
  const revision = store.version
  await expect(store.updateConversation(conversation.id, current => { current!.id = 'invalid' })).rejects.toThrow()
  await store.updateConversation('missing', current => { expect(current).toBeUndefined() })
  expect(store.version).toBe(revision)
})


test('public projections share unchanged entities across both local and global commits', async () => {
  const { store } = await fixture()
  const make = () => conversationSchema.parse({ id: randomUUID(), projectId: randomUUID(), workspacePath: '/fixture', title: 'Before', createdAt: new Date().toISOString(), layout: { type: 'pane', id: randomUUID(), kind: 'chat' },
    messages: [{ id: randomUUID(), role: 'user', text: 'hello', notes: [], createdAt: new Date().toISOString() }] })
  const first = make(), second = make()
  await store.update(db => { db.conversations.push(first, second) })
  const before = store.publicProjection()
  expect(store.publicProjection()).toBe(before)
  await store.updateConversation(first.id, item => { item!.title = 'After' })
  const after = store.publicProjection()
  expect(after.projects).toBe(before.projects)
  expect(after.conversations[1]).toBe(before.conversations[1])
  expect(after.conversations[0].messages).toBe(before.conversations[0].messages)
  expect(after.conversations[0].title).toBe('After')
  await store.update(db => { db.activeChatgptAccount = 'metadata-only' })
  expect(store.publicProjection().conversations).toBe(after.conversations)
  expect(() => { after.conversations[0].messages[0].text = 'mutated' }).toThrow()
  expect(store.conversation(first.id)!.messages[0].text).toBe('hello')
  expect(before.conversations[0].title).toBe('Before')
})

test('recovery rejects an invalid intermediate transaction even if later repaired', async () => {
  const { root, store } = await fixture()
  await store.update(db => { db.activeChatgptAccount = 'first' })
  await store.update(db => { db.activeChatgptAccount = 'second' })
  await writeFile(join(root, 'journal', '0000000000000001.json'), JSON.stringify({ base: 0, delta: { fields: { version: { value: 2 } }, removed: [] } }))
  await expect(new Store(root).open()).rejects.toThrow()
})

test('public projections exclude runtime checkpoints and provider credentials', async () => {
  const { store } = await fixture()
  const partial = { id: randomUUID(), role: 'assistant' as const, text: 'public', notes: [], createdAt: new Date().toISOString() }
  await store.update(db => {
    db.providers.push({ id: 'openai', model: 'test', encryptedKey: 'synthetic-private-key' })
    db.conversations.push(conversationSchema.parse({ id: randomUUID(), projectId: randomUUID(), workspacePath: '/fixture', title: 'Chat', createdAt: new Date().toISOString(), layout: { type: 'pane', id: randomUUID(), kind: 'chat' }, execution: { provider: 'openai', messages: 'synthetic-private-checkpoint', partial, uncertain: false } }))
  })
  const wire = JSON.stringify(store.publicProjection())
  expect(wire).not.toContain('synthetic-private')
  expect(wire).not.toContain('execution')
})


test('metadata transactions isolate drafts, preserve messages and recover deletions', async () => {
  const { root, store } = await fixture()
  const conversation = conversationSchema.parse({ id: randomUUID(), projectId: randomUUID(), workspacePath: '/fixture', title: 'Before', createdAt: new Date().toISOString(), layout: { type: 'pane', id: randomUUID(), kind: 'chat' },
    messages: [{ id: randomUUID(), role: 'user', text: 'unchanged', notes: [], createdAt: new Date().toISOString() }] })
  await store.update(db => { db.conversations.push(conversation) })
  const before = store.publicProjection()
  const draft = await store.updateConversationMetadata(conversation.id, current => {
    expect(current).not.toHaveProperty('messages')
    current!.title = 'After'
    current!.queuePaused = true
    return current!
  })
  draft.title = 'must not leak'
  expect(store.publicProjection().conversations[0].messages).toBe(before.conversations[0].messages)
  await store.updateConversationMetadata(conversation.id, current => { delete current!.queuePaused })
  const revision = store.version
  await expect(store.updateConversationMetadata(conversation.id, current => { current!.id = 'invalid' })).rejects.toThrow()
  expect(store.version).toBe(revision)
  expect((await new Store(root).open()).get()).toEqual(store.get())
  expect(store.conversation(conversation.id)).toMatchObject({ title: 'After', messages: conversation.messages })
})


test('message commits preserve history, detach queued input and atomically update metadata', async () => {
  const { root, store } = await fixture()
  const conversation = conversationSchema.parse({ id: randomUUID(), projectId: randomUUID(), workspacePath: '/fixture', title: 'Before', createdAt: new Date().toISOString(), layout: { type: 'pane', id: randomUUID(), kind: 'chat' },
    messages: [{ id: randomUUID(), role: 'user', text: 'history', notes: [], createdAt: new Date().toISOString() }] })
  await store.update(db => { db.conversations.push(conversation) })
  const original = store.publicProjection().conversations[0].messages[0]
  const message = { ...conversation.messages[0], id: randomUUID(), text: 'snapshot' }
  const pending = store.upsertMessage(conversation.id, message, metadata => { metadata!.queuePaused = true })
  message.text = 'later mutation'
  await pending
  expect(store.publicProjection().conversations[0].messages[0]).toBe(original)
  expect(store.conversation(conversation.id)!.messages[1].text).toBe('snapshot')
  await store.upsertMessage(conversation.id, { ...message, text: 'complete' }, metadata => { delete metadata!.queuePaused })
  expect(store.conversation(conversation.id)!.messages).toHaveLength(2)
  expect((await new Store(root).open()).get()).toEqual(store.get())
  await expect(store.upsertMessage(conversation.id, message, () => { throw new Error('abort') })).rejects.toThrow('abort')
  expect(store.conversation(conversation.id)!.messages[1].text).toBe('complete')
})

test('background checkpoints preserve writes that race compaction and can be flushed', async () => {
  const { root, store } = await fixture()
  await Promise.all(Array.from({ length: 270 }, (_, index) => store.update(db => { db.activeChatgptAccount = `value-${index}` })))
  await store.flush()
  expect((await new Store(root).open()).get()).toEqual(store.get())
  expect(store.get().activeChatgptAccount).toBe('value-269')
  const saved = JSON.parse(await readFile(join(root, 'workspace.json'), 'utf8'))
  expect(saved.journalRevision).toBeGreaterThanOrEqual(128)
  expect(saved.journalRevision).toBeLessThanOrEqual(store.version)
})


test('checkpoint failure preserves the durable journal and recovers on a later commit', async () => {
  const { root, store } = await fixture()
  await store.update(db => { db.activeChatgptAccount = 'base' })
  const checkpoint = join(root, 'workspace.json'), backup = join(root, 'base.json')
  await rename(checkpoint, backup)
  // Force atomic checkpoint replacement to fail without mocking filesystem APIs.
  await mkdir(checkpoint)
  for (let index = 0; index < 128; index++) await store.update(db => { db.activeChatgptAccount = `durable-${index}` })
  await expect(store.flush()).rejects.toThrow()
  expect((await readdir(join(root, 'journal'))).filter(name => name.endsWith('.json'))).toHaveLength(129)
  await rm(checkpoint, { recursive: true })
  await rename(backup, checkpoint)
  expect((await new Store(root).open()).get()).toEqual(store.get())
  await store.update(db => { db.activeChatgptAccount = 'retry' })
  await store.flush()
  expect((await new Store(root).open()).get()).toEqual(store.get())
})
