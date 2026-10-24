import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { realpath } from 'node:fs/promises'
import { panes, type Conversation, type Layout, type PublicState } from '../shared/contracts.js'
import { Store } from './store.js'
import type { SessionPort } from './session-port.js'
import { createLegacySessionAdapter, type SessionAdapter, type SessionAdapterFactory } from './session-adapter.js'
import { Vault, loadSecret } from './vault.js'
import { Browsers } from './browsers.js'
import { Terminals } from './terminals.js'
import { ChatgptOAuth } from './chatgpt-oauth.js'
import * as git from './git.js'
import type { LanguageModel } from 'ai'

export class WorkspaceService {
  readonly events = new EventEmitter()
  readonly terminals = new Terminals()
  readonly browsers = new Browsers()
  readonly chat: SessionPort
  readonly adapter: SessionAdapter
  readonly chatgpt: ChatgptOAuth
  private mutations: Promise<unknown> = Promise.resolve()
  private worktreeVersion = 0
  private constructor(
    readonly store: Store,
    readonly vault: Vault,
    model: LanguageModel | undefined,
    adapterFactory: SessionAdapterFactory,
  ) {
    this.events.setMaxListeners(100)
    this.chatgpt = new ChatgptOAuth(store, vault, () => this.changed())
    this.adapter = adapterFactory({ store, vault, changed: () => this.changed(), model, chatgptModel: () => this.chatgpt.model() })
    this.chat = this.adapter.session
  }
  static async open(directory: string, model?: LanguageModel, adapterFactory: SessionAdapterFactory = createLegacySessionAdapter) {
    const store = await new Store(directory).open()
    return new WorkspaceService(store, new Vault(await loadSecret(directory, 'vault.key')), model, adapterFactory)
  }
  changed() {
    this.events.emit('change')
  }
  state(): PublicState {
    const data = this.store.get()
    const partials = this.chat.partials()
    return {
      worktreeVersion: this.worktreeVersion,
      projects: data.projects,
      conversations: data.conversations.map((item) => ({
        ...item,
        messages: partials[item.id] ? [...item.messages.filter((message) => message.id !== partials[item.id].id), partials[item.id]] : item.messages,
      })),
      providers: [
        ...data.providers.map(({ id, model }) => ({ id, model })),
        ...data.chatgptAccounts
          .filter(
            (account) =>
              account.id === data.activeChatgptAccount && account.encryptedTokens && account.model,
          )
          .map((account) => ({ id: 'chatgpt' as const, model: account.model })),
      ],
      agents: this.chat.states(),
      chatgpt: this.chatgpt.state(),
    }
  }
  project(id: string) {
    const project = this.store.get().projects.find((item) => item.id === id)
    if (!project) throw new Error('Project not found.')
    return project
  }
  conversation(id: string) {
    const item = this.store.get().conversations.find((item) => item.id === id)
    if (!item) throw new Error('Conversation not found.')
    return item
  }
  async workspace(conversation: Conversation) {
    return git.verifyWorkspace(this.project(conversation.projectId), conversation.workspacePath)
  }
  mutate<T>(change: () => Promise<T>) {
    const operation = this.mutations.then(change)
    this.mutations = operation.catch(() => {})
    return operation.finally(() => this.changed())
  }
  async addProject(path: string) {
    return this.mutate(async () => {
      const project = await git.inspectProject(path)
      await this.store.update((db) => {
        if (db.projects.some((item) => item.path === project.path))
          throw new Error('This folder has already been added.')
        db.projects.push(project)
      })
      return project
    })
  }
  async addConversation(projectId: string, workspacePath: string) {
    return this.mutate(async () => {
      const path = await git.verifyWorkspace(this.project(projectId), workspacePath)
      const conversation: Conversation = {
        id: randomUUID(),
        projectId,
        workspacePath: path,
        title: 'New conversation',
        createdAt: new Date().toISOString(),
        layout: { type: 'pane', id: randomUUID(), kind: 'chat' },
        messages: [],
      }
      await this.store.update((db) => {
        db.conversations.push(conversation)
      })
      return conversation
    })
  }
  private async dispose(conversation: Conversation) {
    await this.chat.stop(conversation.id)
    for (const pane of panes(conversation.layout)) {
      this.terminals.remove(pane.id)
      await this.browsers.remove(pane.id)
    }
  }
  async removeConversation(id: string) {
    return this.mutate(async () => {
      await this.dispose(this.conversation(id))
      await this.store.update((db) => {
        db.conversations = db.conversations.filter((item) => item.id !== id)
      })
    })
  }
  async removeProject(id: string) {
    return this.mutate(async () => {
      this.project(id)
      for (const item of this.store.get().conversations.filter((item) => item.projectId === id))
        await this.dispose(item)
      await this.store.update((db) => {
        db.projects = db.projects.filter((item) => item.id !== id)
        db.conversations = db.conversations.filter((item) => item.projectId !== id)
      })
    })
  }
  async removeTree(projectId: string, path: string) {
    return this.mutate(async () => {
      const canonical = await realpath(path)
      const conversations = this.store
        .get()
        .conversations.filter(
          (item) => item.projectId === projectId && item.workspacePath === canonical,
        )
      if (conversations.some((item) => this.chat.isRunning(item.id)))
        throw new Error('Stop agents in this worktree before deleting it.')
      await git.removeWorktree(this.project(projectId), path)
      for (const item of conversations) await this.dispose(item)
      await this.store.update((db) => {
        db.conversations = db.conversations.filter(
          (item) => !conversations.some((removed) => removed.id === item.id),
        )
      })
      this.worktreeVersion++
    })
  }
  async createTree(projectId: string, branch: string, path?: string) {
    return this.mutate(async () => {
      const created = await git.createWorktree(
        this.project(projectId),
        branch,
        this.worktreeDirectory(),
        path,
      )
      this.worktreeVersion++
      return { path: created }
    })
  }
  async setLayout(id: string, layout: Layout) {
    return this.mutate(async () => {
      const leaves = panes(layout)
      if (
        leaves.length > 8 ||
        new Set(leaves.map((pane) => pane.id)).size !== leaves.length ||
        leaves.filter((pane) => pane.kind === 'chat').length !== 1
      )
        throw new Error('Use one chat and a maximum of eight panels.')
      const before = this.conversation(id)
      const occupied = this.store
        .get()
        .conversations.filter((item) => item.id !== id)
        .flatMap((item) => panes(item.layout))
        .map((pane) => pane.id)
      if (leaves.some((pane) => occupied.includes(pane.id)))
        throw new Error('The panel belongs to another conversation.')
      for (const old of panes(before.layout))
        if (!leaves.some((pane) => pane.id === old.id && pane.kind === old.kind)) {
          this.terminals.remove(old.id)
          await this.browsers.remove(old.id)
        }
      await this.store.update((db) => {
        const current = db.conversations.find((item) => item.id === id)
        if (current) current.layout = layout
      })
    })
  }
  worktreeDirectory() {
    return join(this.store.directory, 'worktrees')
  }
  async close() {
    this.chatgpt.close()
    await this.chat.close()
    this.terminals.close()
    await this.browsers.close()
  }
}
