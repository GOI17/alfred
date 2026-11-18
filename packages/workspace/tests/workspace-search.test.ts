import { describe, expect, it } from 'vitest'
import type { Conversation, Project } from '../src/shared/contracts'
import { searchWorkspace } from '../src/renderer/src/workspace-search'
const projects: Project[] = [{ id: 'p', name: 'Espacio', path: '/repo', kind: 'git', createdAt: '' }]
const chat: Conversation = { id: 'c', projectId: 'p', workspacePath: '/repo', title: 'Conversación de diseño', createdAt: '', layout: { type: 'pane', kind: 'chat', id: 'pane' }, messages: [{ id: 'm', role: 'user', text: 'Revisar conexión segura', notes: [], createdAt: '' }] }
describe('contextual workspace search', () => {
  it('matches title without accents or case and retains context', () => {
    expect(searchWorkspace('DISENO conversacion', projects, [chat], [])[0]).toMatchObject({ kind: 'conversations', conversationId: 'c', context: 'Espacio · /repo' })
  })
  it('finds message content with exact navigation identity', () => {
    expect(searchWorkspace('segura conexion', projects, [chat], [])).toEqual([expect.objectContaining({ kind: 'messages', messageId: 'm', conversationId: 'c', context: 'Conversación de diseño · Espacio · /repo' })])
  })
  it('finds worktrees by branch and path', () => {
    const trees = [{ projectId: 'p', tree: { branch: 'feat/search', path: '/trees/search', main: false, locked: false } }]
    expect(searchWorkspace('feat trees', projects, [], trees)[0]).toMatchObject({ kind: 'worktrees', path: '/trees/search', projectId: 'p' })
  })
  it('does not dump message history for an empty query', () => expect(searchWorkspace(' ', projects, [chat], []).map(item => item.kind)).toEqual(['conversations']))
  it('limits each group and gives identical titles distinct identities', () => {
    const chats = Array.from({ length: 70 }, (_, index) => ({ ...chat, id: String(index) }))
    const results = searchWorkspace('con', projects, chats, [])
    expect(results.filter(item => item.kind === 'conversations')).toHaveLength(50)
    expect(results.filter(item => item.kind === 'messages')).toHaveLength(50)
    expect(new Set(results.map(item => item.id)).size).toBe(100)
  })
  it('requires all query words and supports empty data', () => {
    expect(searchWorkspace('conexion absent', projects, [chat], [])).toEqual([])
    expect(searchWorkspace('anything', [], [], [])).toEqual([])
  })
})
