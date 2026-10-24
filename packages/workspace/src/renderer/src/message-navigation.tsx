import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Conversation } from '../../shared/contracts'
import { useUI } from './ui-preferences'

type Props = { messages: Conversation['messages']; scroller: RefObject<HTMLDivElement | null>; content: RefObject<HTMLDivElement | null>; onNavigate: () => void }
export function MessageNavigation({ messages, scroller, content, onNavigate }: Props) {
  const { t } = useUI()
  const tooltipId = useId()
  const entries = messages.filter((message) => message.role === 'user' || message.role === 'assistant')
  const [active, setActive] = useState(-1)
  const [preview, setPreview] = useState<{ label: string; left: number; top: number; index: number } | null>(null)
  const rail = useRef<HTMLElement>(null)
  const destination = useRef<{ node: HTMLElement; timer: number; tabIndex: string | null } | null>(null)
  function clearDestination() {
    const previous = destination.current
    if (!previous) return
    window.clearTimeout(previous.timer)
    previous.node.removeAttribute('data-navigation-target')
    if (previous.tabIndex === null) previous.node.removeAttribute('tabindex')
    else previous.node.setAttribute('tabindex', previous.tabIndex)
    destination.current = null
  }
  useEffect(() => () => clearDestination(), [])
  const selector = '.message[data-role="user"], .message[data-role="assistant"]'
  useLayoutEffect(() => {
    const viewport = scroller.current, body = content.current
    if (!viewport || !body) return
    let frame = 0
    const update = () => {
      frame = 0
      const nodes = body.querySelectorAll<HTMLElement>(selector)
      const top = viewport.getBoundingClientRect().top + 32
      let index = nodes.length ? 0 : -1
      nodes.forEach((node, i) => { if (node.getBoundingClientRect().top <= top) index = i })
      if (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 2) index = nodes.length - 1
      setActive(index)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    viewport.addEventListener('scroll', schedule, { passive: true })
    const observer = new ResizeObserver(schedule)
    observer.observe(viewport); observer.observe(body); schedule()
    return () => { viewport.removeEventListener('scroll', schedule); observer.disconnect(); cancelAnimationFrame(frame) }
  }, [messages, scroller, content])
  useLayoutEffect(() => {
    const dismiss = () => setPreview(null)
    // Scrolling message content does not move the fixed navigation rail.
    const dismissOnScroll = (event: Event) => {
      if (event.target instanceof Node && event.target.contains(rail.current)) dismiss()
    }
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismissOnScroll, true)
    return () => { window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', dismissOnScroll, true) }
  }, [])
  function show(button: HTMLButtonElement, label: string, index: number) {
    const rect = button.getBoundingClientRect()
    setPreview({ label, index, left: Math.max(8, Math.min(rect.right + 10, window.innerWidth - 288)), top: Math.max(8, Math.min(rect.top, window.innerHeight - 130)) })
  }
  if (!entries.length) return null
  return <>
    <nav ref={rail} className="message-navigation" aria-label={`${t('Messages', 'Mensajes')}: ${active + 1} / ${entries.length}`}>
      {entries.map((message, index) => {
        const text = (message.text.trim() || message.attachments?.map((file) => file.name).join(', ') || t('Attachments', 'Adjuntos')).replace(/\s+/g, ' ')
        const excerpt = text.length > 160 ? `${text.slice(0, 157)}…` : text
        const label = `${index + 1} / ${entries.length} · ${message.role === 'user' ? t('You', 'Tú') : 'Alfred'}: ${excerpt}`
        return <button key={message.id} type="button" aria-label={label} aria-describedby={preview?.index === index ? tooltipId : undefined} aria-current={index === active ? 'location' : undefined}
          onMouseEnter={(event) => show(event.currentTarget, label, index)} onMouseLeave={() => setPreview(null)}
          onFocus={(event) => show(event.currentTarget, label, index)} onBlur={() => setPreview(null)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { setPreview(null); return }
            const buttons = rail.current?.querySelectorAll('button')
            if (!buttons) return
            const next = event.key === 'ArrowDown' ? Math.min(index + 1, buttons.length - 1) : event.key === 'ArrowUp' ? Math.max(index - 1, 0) : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : undefined
            if (next !== undefined) { event.preventDefault(); buttons[next]?.focus() }
          }}
          onClick={() => {
            const viewport = scroller.current, target = content.current?.querySelectorAll<HTMLElement>(selector)[index]
            if (!viewport || !target) return
            clearDestination()
            const tabIndex = target.getAttribute('tabindex')
            target.tabIndex = -1
            target.dataset.navigationTarget = 'true'
            onNavigate()
            viewport.scrollTop += target.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 24
            target.focus({ preventScroll: true })
            destination.current = { node: target, tabIndex, timer: window.setTimeout(clearDestination, 2400) }
            setActive(index); setPreview(null)
          }}><span aria-hidden="true" /></button>
      })}
    </nav>
    {preview && createPortal(<div id={tooltipId} role="tooltip" className="message-preview" style={{ left: preview.left, top: preview.top }}>{preview.label}</div>, document.body)}
  </>
}
