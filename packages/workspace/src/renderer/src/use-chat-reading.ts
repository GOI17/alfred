import { useLayoutEffect, useRef, type RefObject } from 'react'

type Reading = { top: number; follow: boolean; anchor?: string; offset?: number }
function read(key: string): Reading | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null')
    return value && Number.isFinite(value.top) && typeof value.follow === 'boolean' ? value : undefined
  } catch { return undefined }
}
/** Restore an anchored message even when lazy Markdown changes its height. */
export function useChatReading(id: string, scroller: RefObject<HTMLDivElement | null>, content: RefObject<HTMLDivElement | null>) {
  const key = `alfred.reading.${id}`
  const initial = useRef(read(key))
  const follow = useRef(initial.current?.follow ?? true)
  useLayoutEffect(() => {
    const viewport = scroller.current
    const body = content.current
    if (!viewport || !body) return
    let restoring = !!initial.current && !initial.current.follow
    const restore = () => {
      if (!restoring || !initial.current) return
      const saved = initial.current
      const anchor = Array.from(body.querySelectorAll<HTMLElement>('[data-message-id]')).find((node) => node.dataset.messageId === saved.anchor)
      viewport.scrollTop = anchor && Number.isFinite(saved.offset)
        ? viewport.scrollTop + anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top - (saved.offset || 0)
        : saved.top
      follow.current = false
    }
    const save = () => {
      const top = viewport.getBoundingClientRect().top
      const anchor = Array.from(body.querySelectorAll<HTMLElement>('[data-message-id]')).find((node) => node.getBoundingClientRect().bottom > top)
      const value: Reading = { top: viewport.scrollTop, follow: restoring ? false : follow.current, anchor: anchor?.dataset.messageId, offset: anchor ? anchor.getBoundingClientRect().top - top : undefined }
      try { sessionStorage.setItem(key, JSON.stringify(value)) } catch { /* Reading remains usable without storage. */ }
    }
    const interact = () => { restoring = false }
    restore()
    const observer = new ResizeObserver(restore)
    observer.observe(body); observer.observe(viewport)
    viewport.addEventListener('wheel', interact, { passive: true })
    viewport.addEventListener('touchstart', interact, { passive: true })
    viewport.addEventListener('pointerdown', interact)
    viewport.addEventListener('keydown', interact)
    // Navigation rail and composer actions must also release restoration.
    const panel = viewport.closest('.chat-panel')
    panel?.addEventListener('click', interact)
    viewport.addEventListener('scroll', save, { passive: true })
    window.addEventListener('pagehide', save)
    return () => {
      save(); observer.disconnect()
      viewport.removeEventListener('wheel', interact); viewport.removeEventListener('touchstart', interact)
      viewport.removeEventListener('pointerdown', interact); viewport.removeEventListener('keydown', interact)
      panel?.removeEventListener('click', interact)
      viewport.removeEventListener('scroll', save); window.removeEventListener('pagehide', save)
    }
  }, [key, scroller, content])
  return follow
}
