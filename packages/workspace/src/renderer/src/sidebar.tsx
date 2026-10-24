import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { FolderPlus, GitBranch, Plus, Settings2, X, PanelLeftClose, ChevronDown, Pin } from 'lucide-react'
import type { Conversation, Project, PublicState, Worktree } from '../../shared/contracts'
import { Button } from './components/ui/button'
import { ProviderLogo } from './components/provider-logo'
import { ProjectActions } from './components/project-actions'
import { useUI } from './ui-preferences'
import './assets/spaces.css'

const spaceColors = ['#203e30', '#253b59', '#50334f', '#51402c', '#29494c']
const spaceSymbols = ['◈', '▥', '◉', '✳', '◇']
function spaceIndex(id: string) {
  let hash = 0
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return hash
}
function spaceColor(id: string) { return spaceColors[spaceIndex(id) % spaceColors.length] }
function calendarDay(time: number) {
  const date = new Date(time)
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000
}
function lastActivity(item: Conversation) {
  return [item.createdAt, ...item.messages.map((message) => message.createdAt)].reduce((latest, value) => {
    const time = Date.parse(value)
    return Number.isFinite(time) ? Math.max(latest, time) : latest
  }, -Infinity)
}
export function Sidebar({ state, project, conversation, worktrees, workspacePath, connected, mobileOpen, selectProject, selectConversation, selectWorkspace, addProject, addConversation, addWorktree, removeProject, removeConversation, removeWorktree, settings, close }: {
  state: PublicState; project?: Project; conversation?: Conversation; worktrees: Worktree[]; workspacePath: string; connected: boolean; mobileOpen: boolean
  selectProject: (id: string) => void; selectConversation: (id: string) => void; selectWorkspace: (path: string) => void
  addProject: () => void; addConversation: () => void; addWorktree: () => void; removeProject: () => void
  removeConversation: (id: string) => void; removeWorktree: (path: string) => void; settings: () => void; close: () => void
}) {
  const { t } = useUI()
  const [dockTooltip, setDockTooltip] = useState<{ label: string; x: number; y: number } | null>(null)
  const dockTooltipRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = dockTooltipRef.current
    if (!element || !dockTooltip) return
    const width = element.getBoundingClientRect().width
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, dockTooltip.x - width / 2))
    element.style.left = `${left}px`
  }, [dockTooltip])
  function showDockTooltip(target: EventTarget) {
    if (!(target instanceof Element)) return
    const button = target.closest<HTMLButtonElement>('.space-icon')
    if (!button) { setDockTooltip(null); return }
    const rect = button.getBoundingClientRect()
    setDockTooltip({ label: button.getAttribute('aria-label') || '', x: rect.left + rect.width / 2, y: rect.top - 10 })
  }
  useEffect(() => {
    const dismiss = () => setDockTooltip(null)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('keydown', escape)
    }
  }, [])
  const conversationList = useRef<HTMLElement>(null)
  useEffect(() => {
    const list = conversationList.current
    const row = list?.querySelector<HTMLElement>('.conversation-row[data-active="true"]')
    if (!list || !row) return
    const bounds = list.getBoundingClientRect()
    const item = row.getBoundingClientRect()
    // Scroll only the list, without moving the canvas or stealing composer focus.
    if (item.top < bounds.top) list.scrollTop += item.top - bounds.top
    else if (item.bottom > bounds.bottom) list.scrollTop += item.bottom - bounds.bottom
  }, [conversation?.id, mobileOpen])
  const [pins, setPins] = useState<string[]>(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem('alfred.pinnedConversations') || '[]'); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [] } catch { return [] }
  })
  function togglePin(id: string) {
    setPins((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
      try { localStorage.setItem('alfred.pinnedConversations', JSON.stringify(next)) } catch { /* Still usable for this session. */ }
      return next
    })
  }
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 700px)').matches)
  const [today, setToday] = useState(() => calendarDay(Date.now()))
  useEffect(() => {
    const update = () => setToday(calendarDay(Date.now()))
    const timer = window.setInterval(update, 30000)
    window.addEventListener('focus', update)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update) }
  }, [])
  useEffect(() => {
    const query = matchMedia('(max-width: 700px)')
    const update = () => setMobile(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const conversations = state.conversations.filter((item) => item.projectId === project?.id && item.workspacePath === workspacePath)
  const groups: { key: string; label: string; items: Conversation[] }[] = [
    { key: 'pinned', label: t('Pinned', 'Fijadas'), items: [] },
    { key: 'today', label: t('Today', 'Hoy'), items: [] },
    { key: 'yesterday', label: t('Yesterday', 'Ayer'), items: [] },
    { key: 'week', label: t('Last 7 days', 'Últimos 7 días'), items: [] },
    { key: 'older', label: t('Older', 'Anteriores'), items: [] },
  ]
  conversations.map((item) => ({ item, time: lastActivity(item) })).sort((a, b) => (b.time - a.time) || a.item.id.localeCompare(b.item.id)).forEach(({ item, time }) => {
    const age = today - calendarDay(time)
    groups[pins.includes(item.id) ? 0 : age <= 0 ? 1 : age === 1 ? 2 : age < 7 ? 3 : 4].items.push(item)
  })
  const activeWorkspace = worktrees.find((tree) => tree.path === workspacePath)
  function statusLabel(id: string) {
    if (!connected) return t('Offline: status unavailable', 'Sin conexión: estado no disponible')
    const status = state.agents[id]?.status
    return status === 'running' ? t('Working', 'Trabajando') : status === 'waiting' ? t('Awaiting approval', 'Esperando aprobación') : status === 'error' ? t('Error', 'Error') : t('Available', 'Disponible')
  }
  return <>
    <button className="sidebar-scrim" data-open={mobileOpen} aria-label={t('Close sidebar', 'Cerrar barra lateral')} onClick={close} />
    <aside className="sidebar" style={{ '--space-color': spaceColor(project?.id || '') } as CSSProperties} data-open={mobileOpen} inert={mobile && !mobileOpen} aria-hidden={mobile && !mobileOpen}>
      <div className="brand"><span className="space-brand-mark" aria-hidden="true">a.</span><span>alfred</span>
        <Button variant="ghost" size="icon" onClick={settings} aria-label={t('Settings', 'Ajustes')} title={t('Settings', 'Ajustes')}><Settings2 size={16} /></Button>
        <span className="mobile-only"><Button variant="ghost" size="icon" onClick={close} aria-label={t('Close sidebar', 'Cerrar barra lateral')}><PanelLeftClose size={18} /></Button></span>
      </div>
      <div className="space-content" key={project?.id || 'empty'}>
        {project ? <>
          <div className="project-heading"><div className="space-overview-trigger" title={project.name}><span>{project.name}</span></div><ProjectActions removeProject={removeProject} /></div>
          <details className="workspace-picker" key={`${project.id}:${workspacePath}`}>
            <summary title={workspacePath}><GitBranch size={14} /><span>{activeWorkspace?.branch || (workspacePath === project.path ? t('Main', 'Principal') : t('Active workspace', 'Espacio activo'))}</span><ChevronDown size={14} /></summary>
            <div className="workspace-list" role="group" aria-label={t('Workspaces', 'Espacios de trabajo')}>
              {worktrees.map((tree) => <div key={tree.path} className="workspace-row" data-active={workspacePath === tree.path}>
                <button aria-pressed={workspacePath === tree.path} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); selectWorkspace(tree.path) }} title={tree.path}><GitBranch size={14} /><span>{tree.branch}</span>{tree.main && <span className="tiny-label">{t('main', 'principal')}</span>}</button>
                {!tree.main && tree.path !== project.path && <Button variant="ghost" size="icon" aria-label={`${t('Delete worktree', 'Eliminar worktree')} ${tree.branch}`} onClick={() => removeWorktree(tree.path)}><X size={13} /></Button>}
              </div>)}
              {project.kind === 'git' && <button className="sidebar-text-button" onClick={addWorktree}><Plus size={14} />{t('New worktree', 'Nuevo worktree')}</button>}
            </div>
          </details>
          <button className="new-conversation" onClick={addConversation}><Plus size={16} />{t('New conversation', 'Nueva conversación')}</button>
          <div className="spaces-heading"><span>{t('Conversations', 'Conversaciones')}</span><span>{conversations.length}</span></div>
          <nav ref={conversationList} className="conversation-list" aria-label={t('Conversations', 'Conversaciones')}>
            {groups.filter((group) => group.items.length > 0).map((group) => <section key={group.key} aria-label={group.label} data-conversation-group={group.key}>
              <h3 className="spaces-heading" style={{ margin: '16px 0 6px', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>{group.label}</h3>
              {group.items.map((item) => <div key={item.id} className="conversation-row" data-active={conversation?.id === item.id}>
                <button onClick={() => selectConversation(item.id)} aria-current={conversation?.id === item.id ? 'page' : undefined} title={item.title}>
                  <ProviderLogo provider={item.lastProvider} /><span>{item.title}</span>
                  <span className="status-dot" data-status={connected ? state.agents[item.id]?.status || 'idle' : 'offline'} title={statusLabel(item.id)} />
                </button>
                <Button variant="ghost" size="icon" aria-pressed={pins.includes(item.id)} aria-label={`${pins.includes(item.id) ? t('Unpin', 'Desfijar') : t('Pin', 'Fijar')} ${item.title}`} onClick={() => togglePin(item.id)}><Pin size={13} /></Button>
                <Button variant="ghost" size="icon" onClick={() => removeConversation(item.id)} aria-label={`${t('Delete conversation', 'Eliminar conversación')} ${item.title}`}><X size={13} /></Button>
              </div>)}
            </section>)}
            {!conversations.length && <p className="sidebar-empty">{t('No conversations yet.', 'Todavía no hay conversaciones.')}</p>}
          </nav>
        </> : <button className="project-item" onClick={addProject}><FolderPlus size={18} /><span>{t('Your first space', 'Tu primer espacio')}</span></button>}
      </div>
      {!connected && <p className="sidebar-connection" role="status">{t('Reconnecting…', 'Reconectando…')}</p>}
      <div className="space-dock" onMouseOver={(event) => showDockTooltip(event.target)} onMouseLeave={() => setDockTooltip(null)} onFocus={(event) => showDockTooltip(event.target)} onBlur={() => setDockTooltip(null)} onClick={() => setDockTooltip(null)}>
        <nav className="space-switcher" aria-label={t('Spaces', 'Espacios')}>
          {state.projects.map((item, index) => <button key={item.id} className="space-icon" data-active={project?.id === item.id} aria-pressed={project?.id === item.id} aria-label={item.name} onClick={() => { if (project?.id !== item.id) selectProject(item.id) }} onKeyDown={(event) => {
            const next = event.key === 'ArrowRight' ? (index + 1) % state.projects.length : event.key === 'ArrowLeft' ? (index - 1 + state.projects.length) % state.projects.length : event.key === 'Home' ? 0 : event.key === 'End' ? state.projects.length - 1 : undefined
            if (next !== undefined) { event.preventDefault(); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus() }
          }}>
            <span aria-hidden="true" style={{ fontSize: 22 }}>{spaceSymbols[spaceIndex(item.id) % spaceSymbols.length]}</span>
            <span className="space-initial" aria-hidden="true">{item.name.slice(0, 1).toUpperCase()}</span>
            {connected && state.conversations.some((chat) => chat.projectId === item.id && state.agents[chat.id]?.status === 'running') && <span className="status-dot" data-status="running" />}
          </button>)}
        </nav>
        <button className="space-icon space-add" onClick={addProject} aria-label={t('Add space', 'Agregar espacio')}><Plus size={22} /></button>
      </div>
    </aside>
    {dockTooltip && createPortal(<div ref={dockTooltipRef} className="space-dock-tooltip" role="tooltip" style={{ left: dockTooltip.x, top: dockTooltip.y }}>{dockTooltip.label}</div>, document.body)}
  </>
}
