import { useId, useLayoutEffect, useRef, useState, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Conversation, PublicState } from '../../shared/contracts'
import { ProviderLogo } from './components/provider-logo'
import { useUI } from './ui-preferences'

export function WorkspaceAgentSummary({ state, connected, projectId, workspacePath, label, children, dock = false }: {
  state: PublicState; connected: boolean; projectId: string; workspacePath?: string; label: string; children: ReactNode; dock?: boolean
}) {
  const { t } = useUI()
  const id = useId()
  const anchor = useRef<HTMLDivElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const status = (chat: Conversation) => {
    if (!connected) return 'offline'
    const current = state.agents[chat.id]?.status || 'idle'
    const lastMessage = chat.messages.at(-1)
    if (current === 'idle' && lastMessage?.role === 'assistant' && !lastMessage.consumptionIncomplete) return 'finished'
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
    const dismiss = () => setOpen(false)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', dismiss, true); window.removeEventListener('keydown', escape) }
  }, [open])
  return <div ref={anchor} className="workspace-agent-anchor" data-dock={dock} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen(false)}>
    {children}
    <span className="workspace-agent-badge" data-status={!connected ? 'offline' : waiting ? 'waiting' : running ? 'running' : 'idle'} aria-label={summary} title={summary}>
      {!connected ? '—' : chats.length}
    </span>
    {open && createPortal(<div id={id} ref={popup} className="workspace-agent-preview" role="tooltip">
      <strong>{label}</strong><p>{summary}</p>
      {connected && !sorted.length && <p>{t('No working, waiting for action or finished agents.', 'No hay agentes trabajando, esperando acción o finalizados.')}</p>}
      {sorted.slice(0, 6).map((chat) => <div className="workspace-agent-preview-row" key={chat.id}>
        <ProviderLogo provider={chat.lastProvider} />
        <div><span>{chat.title}</span><small>{labels[status(chat)]}</small></div>
        <span className="status-dot" data-status={status(chat)} />
      </div>)}
      {sorted.length > 6 && <p>{t('And', 'Y')} {sorted.length - 6} {t('more agents', 'agentes más')}</p>}
    </div>, document.body)}
  </div>
}
