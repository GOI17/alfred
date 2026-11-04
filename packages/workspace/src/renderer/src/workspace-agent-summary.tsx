import { useId, useLayoutEffect, useRef, useState, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Conversation, PublicState } from '../../shared/contracts'
import { ProviderLogo } from './components/provider-logo'
import { useUI } from './ui-preferences'
import { hasUnseenCompletion } from './agent-completion'

const dockPreviewOpenEvent = 'workspace-agent-preview-open'

export function WorkspaceAgentSummary({ state, connected, projectId, workspacePath, label, children, selectConversation, dock = false }: {
  state: PublicState; connected: boolean; projectId: string; workspacePath?: string; label: string; children: ReactNode; selectConversation: (id: string) => void; dock?: boolean
}) {
  const { t } = useUI()
  const id = useId()
  const anchor = useRef<HTMLDivElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [open, setOpen] = useState(false)
  function cancelClose() { clearTimeout(closeTimer.current) }
  function show() {
    if (!dock) return
    cancelClose()
    window.dispatchEvent(new CustomEvent(dockPreviewOpenEvent, { detail: id }))
    setOpen(true)
  }
  function dismiss() { cancelClose(); setOpen(false) }
  function scheduleClose() {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), 200)
  }
  useEffect(() => {
    if (!dock) return
    const closeOtherPreview = (event: Event) => {
      if ((event as CustomEvent<string>).detail === id) return
      clearTimeout(closeTimer.current)
      setOpen(false)
    }
    window.addEventListener(dockPreviewOpenEvent, closeOtherPreview)
    return () => {
      window.removeEventListener(dockPreviewOpenEvent, closeOtherPreview)
      clearTimeout(closeTimer.current)
    }
  }, [dock, id])
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  const status = (chat: Conversation) => {
    if (!connected) return 'offline'
    const current = state.agents[chat.id]?.status || 'idle'
    if (current === 'idle' && hasUnseenCompletion(chat)) return 'finished'
    return current
  }
  const chats = state.conversations.filter((chat) => {
    if (chat.projectId !== projectId || (workspacePath !== undefined && chat.workspacePath !== workspacePath)) return false
    const current = status(chat)
    return current === 'running' || current === 'waiting' || current === 'finished'
  })
  const running = chats.filter((chat) => status(chat) === 'running').length
  const waiting = chats.filter((chat) => status(chat) === 'waiting').length
  const finished = chats.filter((chat) => status(chat) === 'finished').length
  const labels = { running: t('Working', 'Trabajando'), waiting: t('Waiting for action', 'Esperando acción'), finished: t('Finished', 'Finalizado'), error: t('Error', 'Error'), idle: t('Available', 'Disponible'), offline: t('Status unavailable', 'Estado no disponible') }
  const priority = { waiting: 0, running: 1, finished: 2, error: 3, idle: 4, offline: 5 }
  const sorted = [...chats].sort((a, b) => priority[status(a)] - priority[status(b)] || a.title.localeCompare(b.title))
  const summary = connected ? `${running} ${t('working', 'trabajando')} · ${waiting} ${t('waiting for action', 'esperando acción')} · ${finished} ${t('finished', 'finalizados')}` : t('Offline: status unavailable', 'Sin conexión: estado no disponible')
  useLayoutEffect(() => {
    if (!open || !anchor.current || !popup.current) return
    const rect = anchor.current.getBoundingClientRect()
    const card = popup.current
    const bounds = card.getBoundingClientRect()
    card.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - bounds.width - 8))}px`
    card.style.top = `${Math.max(8, Math.min(dock ? rect.top - bounds.height - 8 : rect.bottom + 8, window.innerHeight - bounds.height - 8))}px`
  }, [open, dock, summary, chats.length])
  useEffect(() => {
    if (!open) return
    const close = () => { clearTimeout(closeTimer.current); setOpen(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (popup.current?.contains(document.activeElement)) anchor.current?.querySelector('button')?.focus()
      close()
    }
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !popup.current?.contains(event.target)) close() }
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor.current?.contains(event.target) && !popup.current?.contains(event.target)) close()
    }
    window.addEventListener('resize', close)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('keydown', escape)
    window.addEventListener('pointerdown', outside)
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', scroll, true); window.removeEventListener('keydown', escape); window.removeEventListener('pointerdown', outside) }
  }, [open])
  return <div ref={anchor} className="workspace-agent-anchor" data-dock={dock} onMouseEnter={dock ? show : undefined} onMouseLeave={dock ? scheduleClose : undefined} onClick={dismiss} onKeyDown={(event) => {
    if (event.key === 'ArrowDown' && open && !popup.current?.contains(event.target as Node)) {
      event.preventDefault(); event.stopPropagation(); popup.current?.querySelector('button')?.focus()
    }
  }}>
    {children}
    <span className="workspace-agent-badge" data-status={!connected ? 'offline' : waiting ? 'waiting' : running ? 'running' : 'idle'} aria-label={summary} title={summary}>
      {!connected ? '—' : chats.length}
    </span>
    {dock && open && createPortal(<div id={id} ref={popup} className="workspace-agent-preview" role="region" aria-label={label} onMouseEnter={show} onMouseLeave={scheduleClose}>
      <strong>{label}</strong><p>{summary}</p>
      {connected && !sorted.length && <p>{t('No working, waiting for action or unread finished agents.', 'No hay agentes trabajando, esperando acción o finalizados sin ver.')}</p>}
      {sorted.map((chat) => <button type="button" className="workspace-agent-preview-row" key={chat.id} onClick={(event) => { event.stopPropagation(); dismiss(); selectConversation(chat.id) }}>
        <ProviderLogo provider={chat.lastProvider} />
        <div><span>{chat.title}</span><small>{labels[status(chat)]}</small></div>
        <span className="status-dot" data-status={status(chat)} />
      </button>)}
    </div>, document.body)}
  </div>
}
