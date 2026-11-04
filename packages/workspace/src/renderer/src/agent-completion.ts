import { useEffect, useReducer } from 'react'
import type { Conversation, PublicState } from '../../shared/contracts'

const prefix = 'alfred.seenCompletion.'
const changed = 'alfred:completion-seen'
const memory = new Map<string, string>()

function seen(id: string) {
  try { return localStorage.getItem(prefix + id) || memory.get(id) } catch { return memory.get(id) }
}
export function hasUnseenCompletion(chat: Conversation) {
  const last = chat.messages.at(-1)
  return !!last && last.role === 'assistant' && !last.consumptionIncomplete && seen(chat.id) !== last.id
}

/** A completion is read only when its final message is actually visible in a focused window. */
export function useCompletionReading(state: PublicState, connected: boolean) {
  const [, refresh] = useReducer((value: number) => value + 1, 0)
  useEffect(() => {
    const update = () => refresh()
    window.addEventListener(changed, update)
    window.addEventListener('storage', update)
    return () => { window.removeEventListener(changed, update); window.removeEventListener('storage', update) }
  }, [])
  useEffect(() => {
    if (!connected) return
    let frame = 0
    const check = () => {
      frame = 0
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return
      const messages = Array.from(document.querySelectorAll<HTMLElement>('.messages [data-message-id]'))
      let updated = false
      for (const chat of state.conversations) {
        if ((state.agents[chat.id]?.status || 'idle') !== 'idle' || !hasUnseenCompletion(chat)) continue
        const last = chat.messages.at(-1)!
        const visible = messages.some((element) => {
          if (element.dataset.messageId !== last.id || !element.getClientRects().length) return false
          const viewport = element.closest('.messages')
          if (!viewport) return false
          const rect = element.getBoundingClientRect(), bounds = viewport.getBoundingClientRect()
          // Require the end of the result to be visible, not merely an earlier portion.
          return rect.bottom > Math.max(0, bounds.top) && rect.bottom <= Math.min(window.innerHeight, bounds.bottom) + 1 && rect.right > Math.max(0, bounds.left) && rect.left < Math.min(window.innerWidth, bounds.right)
        })
        if (!visible) continue
        memory.set(chat.id, last.id)
        try { localStorage.setItem(prefix + chat.id, last.id) } catch { /* Keep session behavior when storage is unavailable. */ }
        updated = true
      }
      if (updated) window.dispatchEvent(new Event(changed))
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(check) }
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true })
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    window.addEventListener('focus', schedule)
    document.addEventListener('visibilitychange', schedule)
    schedule()
    return () => {
      cancelAnimationFrame(frame); observer.disconnect()
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('focus', schedule)
      document.removeEventListener('visibilitychange', schedule)
    }
  }, [state, connected])
}
