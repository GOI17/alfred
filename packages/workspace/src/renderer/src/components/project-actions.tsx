import { useEffect, useId, useRef, useState } from 'react'
import { Ellipsis, Trash2 } from 'lucide-react'

export function ProjectActions({ removeProject }: { removeProject: () => void }) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const item = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!open) return
    const dismiss = () => menu.current?.hidePopover()
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [open])

  return (
    <div className="project-actions">
      <button
        ref={trigger}
        type="button"
        popoverTarget={id}
        aria-label="Project actions"
        title="Project actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, border: 0, borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'inherit', cursor: 'pointer' }}
        onClick={() => {
          const bounds = trigger.current?.getBoundingClientRect()
          if (bounds) setPosition({
            top: Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - 64)),
            left: Math.max(8, Math.min(bounds.right - 192, window.innerWidth - 200)),
          })
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (!open) trigger.current?.click()
            else item.current?.focus()
          }
        }}
      ><Ellipsis size={18} /></button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        role="menu"
        aria-label="Project actions"
        style={{ position: 'fixed', inset: 'auto', ...position, margin: 0, width: 192, maxWidth: 'calc(100vw - 16px)', padding: 4, boxSizing: 'border-box', border: '1px solid var(--sidebar-muted)', borderRadius: 'var(--radius)', background: 'var(--sidebar, #18181b)', color: 'var(--sidebar-foreground)', boxShadow: '0 8px 24px #0003' }}
        onToggle={(event) => {
          const visible = event.newState === 'open'
          setOpen(visible)
          if (visible) item.current?.focus()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' || event.key === 'Tab') {
            event.preventDefault()
            menu.current?.hidePopover()
            trigger.current?.focus()
          }
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault()
            item.current?.focus()
          }
        }}
      >
        <button ref={item} type="button" role="menuitem" className="sidebar-text-button" style={{ width: '100%', minHeight: 44, whiteSpace: 'nowrap' }} onClick={() => {
          menu.current?.hidePopover()
          trigger.current?.focus()
          removeProject()
        }}><Trash2 size={14} />Remove project</button>
      </div>
    </div>
  )
}
