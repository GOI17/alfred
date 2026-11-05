import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

// One intersection observer per scrollport, not one per historic message.
const observers = new WeakMap<Element, { observer: IntersectionObserver; listeners: Map<Element, (visible: boolean) => void> }>()
function observe(root: Element, node: Element, listener: (visible: boolean) => void) {
  let shared = observers.get(root)
  if (!shared) {
    const listeners = new Map<Element, (visible: boolean) => void>()
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting)
    }, { root, rootMargin: '1000px 0px' })
    shared = { observer, listeners }; observers.set(root, shared)
  }
  shared.listeners.set(node, listener); shared.observer.observe(node)
  return () => {
    shared.listeners.delete(node); shared.observer.unobserve(node)
    if (!shared.listeners.size) { shared.observer.disconnect(); observers.delete(root) }
  }
}

/** Lightweight anchors remain navigable; offscreen Markdown and attachments unmount.
 * Keep selected/focused content alive so virtualization never destroys a selection.
 */
export const VirtualMessage = memo(function VirtualMessage({ id, role, scroller, initial, children }: {
  id: string; role: string; scroller: RefObject<HTMLDivElement | null>; initial: boolean; children: ReactNode
}) {
  const node = useRef<HTMLDivElement>(null)
  const height = useRef(180)
  const [mounted, setMounted] = useState(initial)
  const updateSelection = useRef<() => void>(() => {})
  useEffect(() => {
    const root = scroller.current, element = node.current
    if (!root || !element || typeof IntersectionObserver === 'undefined') { setMounted(true); return }
    let visible = initial
    const update = () => {
      const selection = window.getSelection()
      const retained = element.contains(document.activeElement) || (!!selection && !selection.isCollapsed && selection.containsNode(element, true))
      setMounted(visible || retained)
    }
    updateSelection.current = update
    const remove = observe(root, element, value => { visible = value; update() })
    const reveal = () => { visible = true; setMounted(true) }
    element.addEventListener('reveal-message', reveal)
    element.addEventListener('focusout', update)
    return () => {
      remove(); element.removeEventListener('reveal-message', reveal)
      element.removeEventListener('focusout', update)
    }
  }, [scroller, initial])
  useEffect(() => {
    if (!mounted) return
    const update = () => updateSelection.current()
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [mounted])
  useLayoutEffect(() => {
    const element = node.current
    if (!element || !mounted) return
    const measure = () => { height.current = element.getBoundingClientRect().height || height.current }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [mounted])
  return <div ref={node} className="message-slot" data-message-id={id} data-role={role}
    style={{ display: 'flow-root', minHeight: mounted ? undefined : height.current }}>
    {mounted ? children : null}
  </div>
})
