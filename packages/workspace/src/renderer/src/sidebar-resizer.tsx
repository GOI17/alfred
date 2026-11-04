import { useLayoutEffect, useRef, useState } from 'react'
import { useUI } from './ui-preferences'

const minimum = 200
const storageKey = 'alfred.sidebarWidth'
const maximum = () => Math.max(minimum, Math.min(520, window.innerWidth - 400))
const clamp = (width: number) => Math.round(Math.max(minimum, Math.min(maximum(), width)))

export function SidebarResizer() {
  const { t } = useUI()
  const handle = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; width: number } | null>(null)
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey))
      if (Number.isFinite(saved) && saved > 0) return clamp(saved)
    } catch { /* Use the default when storage is unavailable. */ }
    return window.innerWidth <= 1020 ? 220 : 254
  })
  const [limit, setLimit] = useState(maximum)
  const [dragging, setDragging] = useState(false)
  useLayoutEffect(() => {
    const container = handle.current?.closest<HTMLElement>('.workspace-sidebar-container')
    if (!container) return
    container.style.setProperty('--sidebar-width', `${width}px`)
    container.dataset.resizing = String(dragging)
    try { localStorage.setItem(storageKey, String(width)) } catch { /* Still usable for this session. */ }
    return () => {
      container.style.removeProperty('--sidebar-width')
      delete container.dataset.resizing
    }
  }, [width, dragging])
  useLayoutEffect(() => {
    const resize = () => {
      setLimit(maximum())
      // Mobile uses its own drawer width; retain the desktop preference.
      if (window.innerWidth > 700) setWidth((current) => clamp(current))
    }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  function finish() { drag.current = null; setDragging(false) }
  return <div ref={handle} className="sidebar-resizer" role="separator" tabIndex={0}
    aria-label={t('Resize sidebar', 'Redimensionar barra lateral')} aria-orientation="vertical"
    aria-controls="workspace-sidebar" aria-valuemin={minimum} aria-valuemax={limit} aria-valuenow={width}
    title={t('Drag to resize. Double-click to reset.', 'Arrastra para redimensionar. Doble clic para restablecer.')}
    onPointerDown={(event) => {
      if (event.button !== 0 || !event.isPrimary) return
      event.preventDefault()
      event.currentTarget.focus()
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { id: event.pointerId, x: event.clientX, width }
      setDragging(true)
    }}
    onPointerMove={(event) => {
      const start = drag.current
      if (start?.id === event.pointerId) setWidth(clamp(start.width + event.clientX - start.x))
    }}
    onPointerUp={(event) => {
      finish()
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    }}
    onPointerCancel={finish} onLostPointerCapture={finish}
    onDoubleClick={() => setWidth(clamp(window.innerWidth <= 1020 ? 220 : 254))}
    onKeyDown={(event) => {
      const next = event.key === 'ArrowLeft' ? width - 10 : event.key === 'ArrowRight' ? width + 10 : event.key === 'Home' ? minimum : event.key === 'End' ? maximum() : undefined
      if (next !== undefined) { event.preventDefault(); setWidth(clamp(next)) }
    }} />
}
