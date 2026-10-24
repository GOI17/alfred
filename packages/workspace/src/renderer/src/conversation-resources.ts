import type { Conversation } from '../../shared/contracts'
import { localFilePath } from './local-file-path'

export type ConversationResource = { kind: 'file' | 'url'; target: string; name: string }
/** References shared in the conversation, not a claim that a file was created or a URL visited. */
export function conversationResources(messages: Conversation['messages']) {
  const outputs = new Map<string, ConversationResource>()
  const sources = new Map<string, ConversationResource>()
  for (const message of messages) {
    // Code examples are not conversation resources.
    const text = message.text.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\1|$)/g, '').replace(/`[^`\n]*`/g, '')
    const add = (target: string, label = '') => {
      try {
        const url = new URL(target)
        if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) {
          sources.set(url.href, { kind: 'url', target: url.href, name: label || `${url.hostname}${url.pathname === '/' ? '' : url.pathname}` })
          return
        }
      } catch { /* Relative links can point to workspace files. */ }
      const path = localFilePath(target)
      if (!path) return
      const collection = message.role === 'assistant' ? outputs : sources
      collection.set(path, { kind: 'file', target: path, name: label || path.split(/[\\/]/).at(-1) || path })
    }
    const withoutLinks = text.replace(/!?\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g, (_match, label: string, angle: string | undefined, target: string | undefined) => {
      add(angle || target || '', label)
      return ''
    })
    for (const match of withoutLinks.matchAll(/https?:\/\/[^\s<>"'`\])]+/g)) add(match[0].replace(/[.,;!?]+$/, ''))
  }
  return { outputs: [...outputs.values()], sources: [...sources.values()] }
}
