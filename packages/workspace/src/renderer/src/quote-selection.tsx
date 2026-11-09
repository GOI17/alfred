import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { parseQuote, QUOTE_PREFIX, quoteMarkdown, quoteRange, type ChatQuote } from './chat-quotes'
import { useUI } from './ui-preferences'

type Props = {
  scroller: RefObject<HTMLDivElement | null>
  disabled: boolean
  onAdd: (text: string) => void
  onNavigate: () => void
}
export function ChatQuotes({ scroller, disabled, onAdd, onNavigate }: Props) {
  const { t } = useUI()
  const [pending, setPending] = useState<{ quote: ChatQuote; left: number; top: number } | null>(null)
  const [notice, setNotice] = useState('')
  const popup = useRef<HTMLButtonElement>(null)
  const callbacks = useRef({ onAdd, onNavigate, t })
  callbacks.current = { onAdd, onNavigate, t }
  useEffect(() => {
    const viewport = scroller.current
    if (!viewport) return
    let frame = 0, timer = 0, navigating = false
    let target: HTMLElement | null = null
    let selectedRange: Range | null = null
    const clear = () => {
      cancelAnimationFrame(frame); window.clearTimeout(timer)
      target?.removeAttribute('data-navigation-target'); target = null
      navigating = false
      const selection = window.getSelection()
      if (selectedRange && selection?.rangeCount && selection.getRangeAt(0) === selectedRange) selection.removeAllRanges()
      selectedRange = null
    }
    const update = () => {
      if (navigating || disabled) { setPending(null); return }
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount !== 1) { setPending(null); return }
      const range = selection.getRangeAt(0)
      const element = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement
      const block = element?.closest<HTMLElement>('.markdown')
      const slot = block?.closest<HTMLElement>('.message-slot')
      if (!block || !slot || !viewport.contains(slot) || !block.contains(range.endContainer) || !slot.dataset.messageId) { setPending(null); return }
      const prefix = document.createRange()
      prefix.selectNodeContents(block); prefix.setEnd(range.startContainer, range.startOffset)
      const text = range.toString()
      if (!text.trim() || text.length > 8000) { setPending(null); return }
      const rect = range.getBoundingClientRect()
      if (!rect.width && !rect.height) { setPending(null); return }
      setPending({ quote: { messageId: slot.dataset.messageId, block: Array.from(slot.querySelectorAll('.markdown')).indexOf(block), start: prefix.toString().length, text },
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 156)), top: Math.max(8, Math.min(rect.top - 42, window.innerHeight - 44)) })
    }
    const dismiss = () => setPending(null)
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { dismiss(); clear() } }
    const pointer = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node)) { clear(); dismiss() } }
    const click = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a') : null
      const href = link?.getAttribute('href') || ''
      if (!href.startsWith(QUOTE_PREFIX)) return
      event.preventDefault(); event.stopPropagation(); clear(); dismiss(); setNotice('')
      const quote = parseQuote(href)
      const slot = quote && Array.from(viewport.querySelectorAll<HTMLElement>('.message-slot')).find(node => node.dataset.messageId === quote.messageId)
      if (!slot || !quote) { setNotice(callbacks.current.t('Quote source unavailable.', 'El origen de la cita no está disponible.')); return }
      navigating = true; target = slot
      callbacks.current.onNavigate()
      flushSync(() => slot.dispatchEvent(new Event('reveal-message')))
      slot.dataset.navigationTarget = 'true'
      // Markdown can still be loading after revealing a virtualized message.
      let attempts = 0
      const reveal = () => {
        const block = slot.querySelectorAll<HTMLElement>('.markdown')[quote.block]
        const details = block?.closest('details')
        if (details) details.open = true
        const range = block && quoteRange(block, quote)
        const rect = range?.getBoundingClientRect() || slot.getBoundingClientRect()
        viewport.scrollTop += rect.top - viewport.getBoundingClientRect().top - 48
        if (range) {
          const selection = window.getSelection()
          selection?.removeAllRanges(); selection?.addRange(range); selectedRange = selection?.rangeCount ? selection.getRangeAt(0) : null
        } else if (++attempts < 60) { frame = requestAnimationFrame(reveal); return }
        else setNotice(callbacks.current.t('Source message found; the selected text has changed.', 'Mensaje de origen encontrado; el texto seleccionado ha cambiado.'))
        timer = window.setTimeout(clear, 3000)
      }
      reveal()
    }
    document.addEventListener('selectionchange', update)
    document.addEventListener('pointerdown', pointer)
    document.addEventListener('keydown', key)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    viewport.addEventListener('click', click)
    viewport.addEventListener('wheel', clear, { passive: true })
    return () => {
      clear()
      document.removeEventListener('selectionchange', update)
      document.removeEventListener('pointerdown', pointer)
      document.removeEventListener('keydown', key)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
      viewport.removeEventListener('click', click)
      viewport.removeEventListener('wheel', clear)
    }
  }, [scroller, disabled])
  return <>
    {notice && <span role="status" style={{ position: 'absolute', bottom: 8, left: 16, background: 'var(--surface)', padding: 8 }}>{notice}</span>}
    {!disabled && pending && createPortal(<button ref={popup} type="button" style={{ position: 'fixed', left: pending.left, top: pending.top, zIndex: 1000, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--foreground)', boxShadow: '0 4px 16px #0003' }}
      onPointerDown={event => event.preventDefault()}
      onClick={() => {
        callbacks.current.onAdd(quoteMarkdown(pending.quote, t('View source', 'Ver origen')))
        setPending(null); setNotice(''); window.getSelection()?.removeAllRanges()
      }}>Add to chat</button>, document.body)}
  </>
}
