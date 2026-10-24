import { layoutKey, stringList, usePersistentLayout } from './use-persistent-layout'
import { ActivityCenter } from './activity-center'
import { NotificationPreferences } from './notification-preferences'
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react'
import { ArrowUpRight, FolderPlus, GitBranch, Globe, Menu, MessageSquare, Plus, Smartphone, TerminalSquare, Columns2, Sparkles, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { Conversation, Layout, Worktree } from '../../shared/contracts'
import { panes } from '../../shared/contracts'
import { api, errorMessage } from './api'
import { liveRefresh } from './live-refresh'
import { useWorkspace } from './use-workspace'
import { panelId } from './panel-id'
import { Sidebar } from './sidebar'
import { PanelLayout, type ToolKind, type ToolVisibility } from './panel-layout'
import { WorktreeDialog, SettingsDialog } from './project-dialogs'
import { useProjectSelection } from './use-project-selection'
import { useSpaceMemory } from './use-space-memory'
import { useUI } from './ui-preferences'
import { Button } from './components/ui/button'
import { Login, PhoneDialog, useTunnelStatus } from './device-connection'
import { Dialog } from './components/ui/dialog'
import './assets/workspace-chrome.css'

export function App() {
  const { t } = useUI()
  const { state, authenticated, connected, refresh } = useWorkspace()
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 700px)').matches)
  useEffect(() => {
    const query = matchMedia('(max-width: 700px)')
    const update = () => setMobile(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  // Public tunnel requests may reach the backend over loopback; use the browser origin.
  const canConnectPhone = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname)
  const { tunnel, error: tunnelError } = useTunnelStatus(canConnectPhone && authenticated === true)
  const phoneLabel = tunnelError ? t('Could not verify the tunnel', 'No se pudo verificar el túnel') : !tunnel ? t('Checking phone connection…', 'Comprobando conexión móvil…') : tunnel.state === 'connected' ? t('Phone: tunnel connected', 'Móvil: túnel conectado') : tunnel.state === 'connecting' ? t('Phone: connecting…', 'Móvil: conectando…') : tunnel.state === 'stopping' ? t('Phone: disconnecting…', 'Móvil: desconectando…') : tunnel.state === 'error' ? t('Phone: connection error', 'Móvil: error de conexión') : tunnel.state === 'disabled' ? t('Set up phone connection', 'Configurar conexión móvil') : t('Connect phone', 'Conectar móvil')
  const [projectId, setProjectId] = useState(localStorage.getItem('alfred.project') || '')
  const [conversationId, setConversationId] = useState(localStorage.getItem('alfred.conversation') || '')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(localStorage.getItem('alfred.sidebarCollapsed') === 'true')
  const [workspacePath, setWorkspacePath] = useState(''), [worktrees, setWorktrees] = useState<Worktree[]>([]), [treeVersion, setTreeVersion] = useState(0)
  const [worktreeError, setWorktreeError] = useState('')
  const recallSpace = useSpaceMemory(state, projectId, conversationId, workspacePath)
  const [focusedChatId, setFocusedChatId] = useState('')
  const [savedFloatingIds, setFloatingIds] = usePersistentLayout<string[]>(layoutKey(projectId, workspacePath, 'floating'), [], stringList)
  const floatingIds = useMemo(() => savedFloatingIds.filter((id) => state?.conversations.some((item) => item.id === id && item.projectId === projectId && item.workspacePath === workspacePath)), [savedFloatingIds, state?.conversations, projectId, workspacePath])
  function selectSpace(id: string) {
    const saved = recallSpace(id)
    setProjectId(id); setWorkspacePath(saved.workspacePath); setConversationId(saved.conversationId); setActivePane(''); setMobileOpen(false)
  }
  const [dialog, setDialog] = useState<'worktree' | 'settings' | 'phone' | null>(null), [mobileOpen, setMobileOpen] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const { selecting, select } = useProjectSelection(async (item) => {
    await refresh(); setProjectId(item.id); setWorkspacePath(item.path); setConversationId('')
  }, setError)
  function addProject() { setMobileOpen(false); void select() }
  const [activePane, setActivePane] = useState('')
  function openConversation(item: Conversation) {
    setProjectId(item.projectId); setWorkspacePath(item.workspacePath); setConversationId(item.id)
    setActivePane(panes(item.layout).find((pane) => pane.kind === 'chat')?.id || ''); setMobileOpen(false)
  }
  const [toolStates, setToolStates] = useState<Record<string, { visible: ToolVisibility; maximized: ToolKind | null }>>({})
  const tools = toolStates[conversationId] || { visible: { terminal: false, browser: false, git: false }, maximized: null }
  const [confirmation, setConfirmation] = useState<{ title: string; description: string; perform: () => Promise<void> }>()
  const project = state?.projects.find((item) => item.id === projectId)
  const conversation = state?.conversations.find((item) => item.id === conversationId && item.projectId === projectId && item.workspacePath === workspacePath)
  useEffect(() => { localStorage.setItem('alfred.sidebarCollapsed', String(sidebarCollapsed)) }, [sidebarCollapsed])
  useEffect(() => {
    if (state && !state.projects.some((item) => item.id === projectId)) selectSpace(state.projects[0]?.id || '')
  }, [state, projectId])
  useEffect(() => {
    if (!state) return
    const url = new URL(window.location.href)
    const target = url.searchParams.get('conversation')
    if (!target) return
    const item = state.conversations.find((item) => item.id === target)
    if (item) openConversation(item)
    else setError(t('This conversation is no longer available.', 'Esta conversación ya no está disponible.'))
    url.searchParams.delete('conversation')
    window.history.replaceState(null, '', url)
  }, [state])
  const applyWorktrees = useEffectEvent((trees: Worktree[]) => {
    if (!project) return
    setWorktrees((previous) => JSON.stringify(previous) === JSON.stringify(trees) ? previous : trees)
    setWorktreeError('')
    const chats = state?.conversations.filter((item) => item.projectId === project.id) || []
    const selected = chats.find((item) => item.id === conversationId)
    const exists = (path?: string) => trees.some((tree) => tree.path === path)
    const nextPath = exists(workspacePath) ? workspacePath : selected && exists(selected.workspacePath) ? selected.workspacePath : project.path
    if (workspacePath !== nextPath) setWorkspacePath(nextPath)
    if (!selected || selected.workspacePath !== nextPath)
      setConversationId(chats.find((item) => item.workspacePath === nextPath)?.id || '')
  })
  useEffect(() => { setWorktrees([]); setWorktreeError('') }, [project?.id])
  useEffect(() => {
    if (!project) return
    return liveRefresh(async (signal) => {
      const trees = await api<Worktree[]>(`/projects/${project.id}/worktrees`, undefined, undefined, signal)
      if (!signal.aborted) applyWorktrees(trees)
    }, (error) => setWorktreeError(errorMessage(error)), project.kind === 'git' ? 3000 : null)
  }, [project?.id, treeVersion, state?.worktreeVersion])
  useEffect(() => {
    localStorage.setItem('alfred.project', projectId); localStorage.setItem('alfred.conversation', conversationId)
  }, [projectId, conversationId])
  const execute = useCallback(async (action: () => Promise<void>) => {
    setError(''); setBusy(true)
    try { await action() } catch (error) { setError(errorMessage(error)) } finally { setBusy(false) }
  }, [])
  async function newConversation(path = workspacePath) {
    if (!project) return
    await execute(async () => {
      const next = await api<Conversation>('/conversations', { projectId, workspacePath: path || project.path })
      await refresh(); setWorkspacePath(next.workspacePath); setConversationId(next.id); setActivePane(panes(next.layout)[0].id); setMobileOpen(false)
    })
  }
  function updateLayout(layout: Layout) {
    if (conversation) void execute(async () => { await api(`/conversations/${conversation.id}/layout`, layout, 'PUT'); await refresh() })
  }
  function showTool(kind: ToolKind, shown: boolean) {
    setToolStates((previous) => {
      const current = previous[conversationId] || { visible: { terminal: false, browser: false, git: false }, maximized: null }
      return { ...previous, [conversationId]: { visible: { ...current.visible, [kind]: shown }, maximized: current.maximized === kind && !shown ? null : current.maximized } }
    })
  }
  function addTool(kind: ToolKind) {
    if (!conversation || busy || (mobile && kind !== 'git') || panes(conversation.layout).length >= 8) return
    const id = conversation.id
    const next = { type: 'pane' as const, id: panelId(), kind }
    const layout: Layout = { type: 'split', id: panelId(), direction: kind === 'terminal' ? 'column' : 'row', ratio: 0.5, children: [conversation.layout, next] }
    void execute(async () => {
      await api(`/conversations/${id}/layout`, layout, 'PUT'); await refresh(); setActivePane(next.id); showTool(kind, true)
    })
  }
  function toggleTool(kind: ToolKind) {
    if (!conversation) return
    if (panes(conversation.layout).some((pane) => pane.kind === kind)) showTool(kind, !tools.visible[kind])
    else addTool(kind)
  }
  function maximizeTool(kind: ToolKind) {
    setToolStates((previous) => {
      const current = previous[conversationId] || tools
      return { ...previous, [conversationId]: { ...current, maximized: current.maximized === kind ? null : kind } }
    })
  }
  useEffect(() => {
    let prefix = false, timer: ReturnType<typeof setTimeout>
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'b') {
        event.preventDefault(); prefix = true; clearTimeout(timer); timer = setTimeout(() => { prefix = false }, 1500); return
      }
      if (!prefix) return
      prefix = false
      if (event.key === '%' || event.key === '"') { event.preventDefault(); addTool('terminal') }
      if (event.key === 'c') { event.preventDefault(); void newConversation() }
      if (event.key === 'o' && conversation) {
        event.preventDefault()
        const leaves = panes(conversation.layout).filter((pane) => !mobile || pane.kind === 'chat' || pane.kind === 'git'), current = leaves.findIndex((pane) => pane.id === activePane)
        const next = leaves[(current + 1) % leaves.length]
        if (!next) return
        setActivePane(next.id)
        if (next.kind !== 'chat') showTool(next.kind, true)
        setToolStates((previous) => ({ ...previous, [conversationId]: { ...(previous[conversationId] || tools), maximized: null } }))
        requestAnimationFrame(() => document.querySelector(`[data-pane-id="${next.id}"]`)?.querySelector<HTMLElement>('textarea, input, [tabindex="0"]')?.focus())
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => { clearTimeout(timer); window.removeEventListener('keydown', handler, true) }
  }, [conversation, activePane, projectId, workspacePath, busy, tools, mobile])
  if (authenticated === undefined) return <div className="loading-screen"><span className="brand-mark">a·</span><p>{t('Opening your workspace…', 'Abriendo tu espacio…')}</p></div>
  if (!authenticated || !state) return <Login connected={refresh} />
  return <NotificationPreferences><div className="app-shell" data-sidebar-collapsed={sidebarCollapsed}>
    <div id="workspace-sidebar" className="workspace-sidebar-container">
      <Sidebar state={state} project={project} conversation={(floatingIds.length ? state.conversations.find((item) => item.id === focusedChatId && item.projectId === projectId && item.workspacePath === workspacePath) : undefined) || conversation} worktrees={worktrees} workspacePath={workspacePath} connected={connected} mobileOpen={mobileOpen}
        close={() => setMobileOpen(false)} selectProject={selectSpace}
        selectWorkspace={(path) => { setWorkspacePath(path); setConversationId(state.conversations.find((item) => item.projectId === projectId && item.workspacePath === path)?.id || '') }}
        selectConversation={(id) => {
          if (floatingIds.length) setFloatingIds((current) => [...current.filter((item) => item !== id), id])
          else setConversationId(id)
          setMobileOpen(false)
        }} addProject={addProject} addConversation={() => void newConversation()}
        addWorktree={() => setDialog('worktree')} settings={() => { setMobileOpen(false); setDialog('settings') }}
        removeProject={() => { if (project) setConfirmation({ title: `${t('Remove', 'Eliminar')} ${project.name}`, description: t('Its conversations will be removed from Alfred and its sessions closed. The folder, files, and worktrees will remain on disk.', 'Se eliminarán sus conversaciones de Alfred y se cerrarán sus sesiones. La carpeta, los archivos y los worktrees permanecerán en el disco.'), perform: async () => { await api(`/projects/${project.id}`, undefined, 'DELETE'); await refresh() } }) }}
        removeConversation={(id) => setConfirmation({ title: t('Delete conversation', 'Eliminar conversación'), description: t('This conversation history will be deleted and its panels and sessions closed.', 'Se eliminará el historial de esta conversación y se cerrarán sus paneles y sesiones.'), perform: async () => { await api(`/conversations/${id}`, undefined, 'DELETE'); await refresh() } })}
        removeWorktree={(path) => setConfirmation({ title: t('Delete worktree', 'Eliminar worktree'), description: t('Git will delete this worktree folder and Alfred will close its conversations. The operation will be rejected if there are uncommitted changes. The branch will be preserved.', 'Git eliminará esta carpeta de worktree y Alfred cerrará sus conversaciones. Se rechazará la operación si hay cambios sin commit. Se conservará la rama.'), perform: async () => { await api(`/projects/${projectId}/worktrees`, { path }, 'DELETE'); setTreeVersion((value) => value + 1); await refresh() } })}
      />
    </div>
    <main className="main-workspace">
      <header className="workspace-header workspace-header-unified">
        <span className="desktop-sidebar-toggle"><Button variant="ghost" size="icon" aria-controls="workspace-sidebar" aria-expanded={!sidebarCollapsed} aria-label={sidebarCollapsed ? t('Show sidebar', 'Mostrar barra lateral') : t('Hide sidebar', 'Ocultar barra lateral')} title={sidebarCollapsed ? t('Show sidebar', 'Mostrar barra lateral') : t('Hide sidebar', 'Ocultar barra lateral')} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}</Button></span>
        <span className="mobile-only"><Button variant="ghost" size="icon" aria-label={t('Open spaces', 'Abrir espacios')} aria-controls="workspace-sidebar" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu size={19} /></Button></span>
        <div className="workspace-heading-context">
          <div className="workspace-breadcrumb"><span className="breadcrumb-project" title={project?.name}>{project?.name || t('Welcome to Alfred', 'Bienvenido a Alfred')}</span>{project && <><span className="breadcrumb-slash">/</span><GitBranch size={13} /><span className="breadcrumb-branch" title={workspacePath}>{worktrees.find((tree) => tree.path === workspacePath)?.branch || t('Workspace', 'Espacio')}</span></>}</div>
          {conversation && !floatingIds.length && <div className="conversation-title"><span title={conversation.title}>{conversation.title}</span></div>}
        </div>
        <div className="panel-tools">
          <ActivityCenter state={state} connected={connected} select={openConversation} />
          {conversation && (['terminal', 'browser', 'git'] as const).filter((kind) => !mobile || kind === 'git').map((kind) => {
            const label = kind === 'terminal' ? 'Terminal' : kind === 'browser' ? t('Browser', 'Navegador') : 'Git'
            const Icon = kind === 'terminal' ? TerminalSquare : kind === 'browser' ? Globe : GitBranch
            const exists = panes(conversation.layout).some((pane) => pane.kind === kind)
            const shown = exists && tools.visible[kind]
            return <Button key={kind} variant="ghost" size="small" disabled={busy || (!exists && panes(conversation.layout).length >= 8) || (kind === 'git' && project?.kind !== 'git')} onClick={() => toggleTool(kind)} aria-label={label} aria-pressed={shown} title={`${shown ? t('Hide', 'Ocultar') : t('Show', 'Mostrar')} ${label}`}><Icon size={15} /><span>{label}</span></Button>
          })}
          {canConnectPhone && <Button variant="ghost" size="small" onClick={() => setDialog('phone')} aria-label={phoneLabel} title={phoneLabel}><Smartphone size={17} /><span>{tunnel?.state === 'connected' && !tunnelError ? t('Connected', 'Conectado') : ''}</span></Button>}
        </div>
      </header>
      {(error || worktreeError) && <div className="app-error" role="alert"><span>{error || worktreeError}</span><Button variant="ghost" size="small" onClick={() => { setError(''); setWorktreeError('') }}>{t('Close', 'Cerrar')}</Button></div>}
      {selecting && <div className="connection-banner" role="status">{t('Select a folder in the system dialog…', 'Selecciona una carpeta en el diálogo del sistema…')}</div>}
      {!connected && <div className="connection-banner" role="status">{t('Disconnected from the server. Agent status cannot be verified.', 'Desconectado del servidor. No se puede verificar el estado del agente.')}</div>}
      {conversation ? <PanelLayout onActiveChatChange={setFocusedChatId} floatingIds={floatingIds} setFloatingIds={setFloatingIds} mobile={mobile} key={conversation.id} conversation={conversation} state={state} active={activePane} setActive={setActivePane} update={updateLayout} settings={() => setDialog('settings')} visible={tools.visible} toggle={toggleTool} maximized={tools.maximized && (!mobile || tools.maximized === 'git') && panes(conversation.layout).some((pane) => pane.kind === tools.maximized) ? tools.maximized : null} maximize={maximizeTool} addTerminal={() => addTool('terminal')} busy={busy} />
        : <div className="start-screen">
          <div className="start-orbit"><span className="brand-mark">a<span>·</span></span><span className="orbit-symbol orbit-one"><MessageSquare size={20} /></span><span className="orbit-symbol orbit-two"><GitBranch size={20} /></span><span className="orbit-symbol orbit-three"><TerminalSquare size={20} /></span></div>
          <p className="eyebrow">{t('LESS NOISE. MORE SPACE.', 'MENOS RUIDO. MÁS ESPACIO.')}</p><h1>{project ? t('Your next step starts here.', 'Tu siguiente paso empieza aquí.') : t('A place for your ideas.', 'Un lugar para tus ideas.')}</h1>
          <p>{project ? t('A conversation, your tools, and all your project context.', 'Una conversación, tus herramientas y todo el contexto de tu proyecto.') : t('Your projects, conversations, and tools.\nOn your computer. With you wherever you are.', 'Tus proyectos, conversaciones y herramientas.\nEn tu equipo. Contigo donde estés.')}</p>
          <Button onClick={() => project ? void newConversation() : addProject()} disabled={busy || selecting}>{project ? <Plus size={17} /> : <FolderPlus size={17} />}{project ? t('New conversation', 'Nueva conversación') : t('Add space', 'Agregar espacio')}<ArrowUpRight size={16} /></Button>
          <div className="start-features"><span><Sparkles size={15} />{t('Native chat', 'Chat nativo')}</span><span><Columns2 size={15} />{t('Your own workspace', 'Tu propio espacio')}</span><span><Smartphone size={15} />{t('Wherever you are', 'Donde estés')}</span></div>
        </div>}
    </main>
    {dialog === 'worktree' && project && <WorktreeDialog project={project} onClose={() => setDialog(null)} onAdded={(path) => { setTreeVersion((value) => value + 1); setWorkspacePath(path); void newConversation(path) }} />}
    {dialog === 'settings' && <SettingsDialog state={state} onClose={() => setDialog(null)} />}
    {canConnectPhone && dialog === 'phone' && <PhoneDialog onClose={() => setDialog(null)} />}
    {confirmation && <Dialog open onClose={() => setConfirmation(undefined)} title={confirmation.title} description={confirmation.description}><div className="dialog-actions"><Button variant="secondary" onClick={() => setConfirmation(undefined)}>{t('Cancel', 'Cancelar')}</Button><Button variant="danger" disabled={busy} onClick={() => void execute(async () => { await confirmation.perform(); setConfirmation(undefined) })}>{busy ? t('Deleting…', 'Eliminando…') : t('Confirm deletion', 'Confirmar eliminación')}</Button></div></Dialog>}
  </div></NotificationPreferences>
}
