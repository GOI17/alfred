import { mkdir, open, readFile, readdir, rename, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { jsonChunks } from './json-chunks.js'
import { applyStateDelta, stateDelta } from '../shared/state-delta.js'
import { databaseSchema, conversationSchema, messageSchema, type Message, type Conversation, type Database, type PublicState } from '../shared/contracts.js'

// Cached public values are detached and frozen: consumers cannot mutate storage.
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

const conversationMetadataSchema = conversationSchema.omit({ messages: true })

function validateConversation(before: Conversation | undefined, next: Conversation): Conversation {
  if (!before || !next || typeof next !== 'object') return conversationSchema.parse(next)
  const result = { ...before }
  for (const key of Object.keys(conversationSchema.shape) as (keyof Conversation)[]) {
    if (Object.is(before[key], next[key])) continue
    const value = key === 'messages' && Array.isArray(next.messages)
      ? next.messages.map((message, index) => message === before.messages[index] ? message : messageSchema.parse(message))
      : conversationSchema.shape[key].parse(next[key])
    Object.defineProperty(result, key, { value, enumerable: true, configurable: true, writable: true })
    if (value === undefined) delete result[key]
  }
  return result
}

// Journal patches preserve untouched references. Validate every transaction, but
// do not clone/validate unrelated conversations again during recovery.
function validateTransaction(before: Database, next: Database): Database {
  if (!next || typeof next !== 'object' || Array.isArray(next)) return databaseSchema.parse(next)
  const result = { ...before }
  for (const key of Object.keys(databaseSchema.shape) as (keyof Database)[]) {
    if (Object.is(before[key], next[key])) continue
    const value = key === 'conversations' && Array.isArray(next.conversations)
      ? next.conversations.map((item, index) => item === before.conversations[index] ? item : validateConversation(before.conversations[index], item))
      : databaseSchema.shape[key].parse(next[key])
    Object.defineProperty(result, key, { value, enumerable: true, configurable: true, writable: true })
    if (value === undefined) delete result[key]
  }
  return result
}

export class Store {
  private revision = 0
  private checkpointRevision = 0
  private initialized = false
  private checkpointTask?: Promise<void>
  private checkpointError?: unknown
  private tail: Promise<unknown> = Promise.resolve()
  private data: Database = {
    version: 1,
    projects: [],
    conversations: [],
    providers: [],
    chatgptAccounts: [],
  }
  private publicValues = new WeakMap<object, object>()
  private publicState?: Pick<PublicState, 'projects' | 'conversations' | 'providers'>
  constructor(readonly directory: string) {}
  private publicClone<T>(source: T): T {
    if (!source || typeof source !== 'object') return source
    const previous = this.publicValues.get(source)
    if (previous) return previous as T
    const value = Array.isArray(source)
      ? source.map(item => this.publicClone(item))
      : Object.fromEntries(Object.entries(source).map(([key, item]) => [key, this.publicClone(item)]))
    Object.freeze(value)
    this.publicValues.set(source, value)
    return value as T
  }
  publicProjection() {
    if (this.publicState) return this.publicState
    const cached = <T extends object>(source: T, project: () => T): T => {
      let value = this.publicValues.get(source)
      if (!value) { value = freeze(project()); this.publicValues.set(source, value) }
      return value as T
    }
    const data = this.data
    this.publicState = freeze({
      projects: this.publicClone(data.projects),
      conversations: cached(data.conversations, () => data.conversations.map(item => cached(item, () => {
        const { execution: _execution, ...publicItem } = item
        return this.publicClone(publicItem)
      }))),
      providers: [
        ...data.providers.map(({ id, model }) => ({ id, model })),
        ...data.chatgptAccounts.filter(account => account.id === data.activeChatgptAccount && account.encryptedTokens && account.model)
          .map(account => ({ id: 'chatgpt' as const, model: account.model })),
      ],
    })
    return this.publicState
  }
  async open() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    try {
      const saved = JSON.parse(await readFile(join(this.directory, 'workspace.json'), 'utf8'))
      this.data = databaseSchema.parse(saved)
      this.revision = this.checkpointRevision = saved.journalRevision ?? 0
      if (!Number.isSafeInteger(this.revision) || this.revision < 0) throw new Error('Invalid workspace checkpoint revision')
      this.initialized = true
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    const journal = join(this.directory, 'journal')
    await mkdir(journal, { recursive: true, mode: 0o700 })
    const entries = (await readdir(journal)).filter(name => /^\d{16}\.json$/.test(name)).sort()
    for (const name of entries) {
      const revision = Number(name.slice(0, 16))
      if (revision <= this.revision) continue // Checkpoint committed before journal cleanup.
      if (revision !== this.revision + 1) throw new Error('Workspace journal has a missing transaction')
      const entry = JSON.parse(await readFile(join(journal, name), 'utf8'))
      if (entry.base !== this.revision) throw new Error('Invalid workspace journal transaction')
      this.data = validateTransaction(this.data, applyStateDelta(this.data, entry.delta))
      this.revision = revision
    }
    return this
  }
  private async atomic(path: string, content: string) {
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, content, { mode: 0o600, flush: true })
      await rename(temporary, path)
    } catch (error) {
      await unlink(temporary).catch(() => {})
      throw error
    }
  }
  get version() { return this.revision }
  oauthState() {
    return structuredClone({ chatgptAccounts: this.data.chatgptAccounts, activeChatgptAccount: this.data.activeChatgptAccount })
  }
  get() {
    return structuredClone(this.data)
  }
  // Clone only the selected entity; callers cannot mutate the stored database.
  project(id: string) {
    return structuredClone(this.data.projects.find(item => item.id === id))
  }
  conversation(id: string) {
    return structuredClone(this.data.conversations.find(item => item.id === id))
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(operation)
    this.tail = pending.catch(() => {})
    return pending
  }
  private async commit(next: Database) {
    const delta = stateDelta(this.data, next)
    if (!delta) return
    // Establish a base once. Subsequent checkpoints run outside this write queue.
    if (!this.initialized) {
      await this.atomic(join(this.directory, 'workspace.json'), JSON.stringify({ ...this.data, journalRevision: this.revision }))
      this.initialized = true
      this.checkpointRevision = this.revision
    }
    const revision = this.revision + 1
    await this.atomic(join(this.directory, 'journal', `${String(revision).padStart(16, '0')}.json`), JSON.stringify({ base: this.revision, delta }))
    this.revision = revision
    // Restore sharing even for global transactions whose drafts were cloned.
    this.data = applyStateDelta(this.data, delta)
    this.publicState = undefined
    this.scheduleCheckpoint()
  }
  private scheduleCheckpoint() {
    if (this.checkpointTask || this.revision - this.checkpointRevision < 128) return
    // Commits use copy-on-write. Capturing this graph cannot observe later writes.
    const data = this.data, revision = this.revision
    this.checkpointError = undefined
    this.checkpointTask = this.checkpoint(data, revision).catch(error => {
      // The durable journal is retained on failure. flush reports the failure;
      // a later commit may retry without failing an already-durable transaction.
      this.checkpointError = error
    }).finally(() => { this.checkpointTask = undefined })
  }
  private async checkpoint(data: Database, revision: number) {
    const path = join(this.directory, 'workspace.json')
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      const file = await open(temporary, 'wx', 0o600)
      try {
        await file.writeFile(jsonChunks({ ...data, journalRevision: revision }))
        await file.sync()
      } finally { await file.close() }
      await rename(temporary, path)
      this.checkpointRevision = revision
      const journal = join(this.directory, 'journal')
      const names = await readdir(journal)
      await Promise.all(names.filter(name => /^\d{16}\.json$/.test(name) && Number(name.slice(0, 16)) <= revision)
        .map(name => unlink(join(journal, name)).catch(() => {})))
    } catch (error) {
      await unlink(temporary).catch(() => {})
      throw error
    }
  }
  async flush() {
    await this.tail
    await this.checkpointTask
    if (this.checkpointError) throw this.checkpointError
    this.scheduleCheckpoint()
    await this.checkpointTask
    if (this.checkpointError) throw this.checkpointError
  }
  // Metadata callbacks never receive message content, even at runtime. Existing
  // messages remain private and shared; invalid drafts cannot affect storage.
  updateConversationMetadata<T>(id: string, change: (conversation: Omit<Conversation, 'messages'> | undefined) => T | Promise<T>): Promise<T> {
    return this.updateConversationParts(id, change)
  }
  upsertMessage(id: string, message: Message, change: (conversation: Omit<Conversation, 'messages'> | undefined) => void = () => {}): Promise<void> {
    // Detach immediately: streaming may mutate its message while this is queued.
    const saved = JSON.parse(JSON.stringify(messageSchema.parse(message))) as Message
    return this.updateConversationParts(id, change, saved)
  }
  private updateConversationParts<T>(id: string, change: (conversation: Omit<Conversation, 'messages'> | undefined) => T | Promise<T>, message?: Message): Promise<T> {
    return this.enqueue(async () => {
      const index = this.data.conversations.findIndex(item => item.id === id)
      const source = this.data.conversations[index]
      const draft = source ? structuredClone((({ messages: _messages, ...metadata }) => metadata)(source)) : undefined
      const result = await change(draft)
      if (draft && source) {
        const metadata = JSON.parse(JSON.stringify(conversationMetadataSchema.parse(draft)))
        const conversations = [...this.data.conversations]
        let messages = source.messages
        if (message) {
          messages = [...messages]
          const position = messages.findIndex(item => item.id === message.id)
          if (position < 0) messages.push(message)
          else messages[position] = message
        }
        conversations[index] = { ...metadata, messages }
        await this.commit({ ...this.data, conversations })
      }
      return result
    })
  }
  // Hot-path updates clone and validate only the affected conversation. The same
  // queue serializes these with cross-entity transactions; no lost updates.
  updateConversation<T>(id: string, change: (conversation: Conversation | undefined) => T | Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      const index = this.data.conversations.findIndex(item => item.id === id)
      const draft = index < 0 ? undefined : structuredClone(this.data.conversations[index])
      const result = await change(draft)
      if (draft) {
        const validated = conversationSchema.parse(draft)
        const conversations = [...this.data.conversations]
        conversations[index] = JSON.parse(JSON.stringify(validated))
        await this.commit({ ...this.data, conversations })
      }
      return result
    })
  }
  update<T>(change: (data: Database) => T | Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      const draft = structuredClone(this.data)
      const result = await change(draft)
      const validated = databaseSchema.parse(draft)
      await this.commit(JSON.parse(JSON.stringify(validated)))
      return result
    })
  }
}
