import { useEffect, useRef } from 'react'
import type { PublicState } from '../../shared/contracts'

type Selection = { conversationId: string; workspacePath: string }
const key = 'alfred.spaces.v1'
function read(): Record<string, Selection> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item && typeof item.conversationId === 'string' && typeof item.workspacePath === 'string'))
  } catch { return {} }
}
/** Store only navigation metadata, never message contents or credentials. */
export function useSpaceMemory(state: PublicState | undefined, projectId: string, conversationId: string, workspacePath: string) {
  const memory = useRef(read())
  useEffect(() => {
    if (!state) return
    const current = state.conversations.find((item) => item.id === conversationId && item.projectId === projectId && item.workspacePath === workspacePath)
    if (current) memory.current[projectId] = { conversationId, workspacePath }
    const valid = new Set(state.projects.map((item) => item.id))
    for (const id of Object.keys(memory.current)) if (!valid.has(id)) delete memory.current[id]
    try { localStorage.setItem(key, JSON.stringify(memory.current)) } catch { /* Session memory remains available. */ }
  }, [state, projectId, conversationId, workspacePath])
  return (id: string): Selection => {
    const saved = memory.current[id]
    const chats = state?.conversations.filter((item) => item.projectId === id) || []
    const chat = chats.find((item) => item.id === saved?.conversationId) || chats[0]
    return { conversationId: chat?.id || '', workspacePath: chat?.workspacePath || state?.projects.find((item) => item.id === id)?.path || '' }
  }
}
