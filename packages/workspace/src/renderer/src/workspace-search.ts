import type { Conversation, Project, Worktree } from '../../shared/contracts'

export type SearchKind = 'files' | 'conversations' | 'messages' | 'worktrees'
export type SearchResult = { id: string; kind: SearchKind; label: string; context: string; projectId: string; conversationId?: string; messageId?: string; path?: string }
export const normalizeSearch = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
export function searchWorkspace(query: string, projects: Project[], conversations: Conversation[], trees: { projectId: string; tree: Worktree }[]): SearchResult[] {
  const words = normalizeSearch(query.trim()).split(/\s+/).filter(Boolean)
  const matches = (text: string) => { const normalized = normalizeSearch(text); return words.every(word => normalized.includes(word)) }
  const results: SearchResult[] = []
  let chats = 0, messages = 0, worktrees = 0
  const names = new Map(projects.map(project => [project.id, project.name]))
  for (const conversation of conversations) {
    const context = `${names.get(conversation.projectId) || conversation.projectId} · ${conversation.workspacePath}`
    if (chats < 50 && matches(conversation.title)) {
      results.push({ id: `conversation:${conversation.id}`, kind: 'conversations', label: conversation.title, context, projectId: conversation.projectId, conversationId: conversation.id }); chats++
    }
    if (!words.length) continue
    for (const message of conversation.messages) {
      if (messages >= 50) break
      if (!matches(message.text)) continue
      const start = Math.max(0, normalizeSearch(message.text).indexOf(words[0]) - 60)
      results.push({ id: `message:${conversation.id}:${message.id}`, kind: 'messages', label: `${start ? '…' : ''}${message.text.slice(start, start + 240)}${message.text.length > start + 240 ? '…' : ''}`, context: `${conversation.title} · ${context}`, projectId: conversation.projectId, conversationId: conversation.id, messageId: message.id }); messages++
    }
  }
  for (const { projectId, tree } of trees) {
    if (worktrees >= 50) break
    if (matches(`${tree.branch} ${tree.path}`)) {
      results.push({ id: `tree:${projectId}:${tree.path}`, kind: 'worktrees', label: tree.branch || tree.path, context: `${names.get(projectId) || projectId} · ${tree.path}`, projectId, path: tree.path }); worktrees++
    }
  }
  return results
}
