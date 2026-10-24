import { lazy, Suspense, type Dispatch, type SetStateAction } from 'react'
import { MessageSquare, TerminalSquare, Globe, GitBranch, Maximize2, Minimize2, Plus, X, Minus } from 'lucide-react'
import type { Conversation, Layout, Pane, PublicState } from '../../shared/contracts'
import { panes } from '../../shared/contracts'
import { ChatStudio } from './chat-studio'
import { Button } from './components/ui/button'
import './assets/panel-content.css'

const TerminalPanel = lazy(() => import('./terminal-panel').then((module) => ({ default: module.TerminalPanel })))
const BrowserPanel = lazy(() => import('./browser-panel').then((module) => ({ default: module.BrowserPanel })))
const GitPanel = lazy(() => import('./git-panel').then((module) => ({ default: module.GitPanel })))
export type ToolKind = Exclude<Pane['kind'], 'chat'>
export type ToolVisibility = Record<ToolKind, boolean>
export const paneLabels = { chat: 'Conversation', terminal: 'Terminal', browser: 'Browser', git: 'Git' }
export const paneIcons = { chat: MessageSquare, terminal: TerminalSquare, browser: Globe, git: GitBranch }
export function replaceNode(layout: Layout, id: string, replacement: Layout): Layout {
  if (layout.id === id) return replacement
  if (layout.type === 'pane') return layout
  return { ...layout, children: [replaceNode(layout.children[0], id, replacement), replaceNode(layout.children[1], id, replacement)] }
}
export function removePane(layout: Layout, id: string): Layout {
  if (layout.type === 'pane') return layout
  if (layout.children[0].id === id) return layout.children[1]
  if (layout.children[1].id === id) return layout.children[0]
  return { ...layout, children: [removePane(layout.children[0], id), removePane(layout.children[1], id)] }
}
export function PanelLayout({ onActiveChatChange, floatingIds, setFloatingIds, mobile, conversation, state, active, setActive, update, settings, visible, toggle, maximized, maximize, addTerminal, busy }: {
  onActiveChatChange?: (id: string) => void
  floatingIds?: string[]
  setFloatingIds?: Dispatch<SetStateAction<string[]>>
  mobile: boolean
  conversation: Conversation
  state: PublicState
  active: string
  setActive: (id: string) => void
  update: (layout: Layout) => void
  settings: () => void
  visible: ToolVisibility
  toggle: (kind: ToolKind) => void
  maximized: ToolKind | null
  maximize: (kind: ToolKind) => void
  addTerminal: () => void
  busy: boolean
}) {
  const leaves = panes(conversation.layout).filter((pane) => !mobile || pane.kind === 'chat' || pane.kind === 'git')
  const terminals = leaves.filter((pane) => pane.kind === 'terminal')
  const selectedTerminal = terminals.find((pane) => pane.id === active)?.id || terminals[0]?.id
  function content(pane: Pane) {
    return <Suspense fallback={<p className="muted">Opening tool…</p>}>
      {pane.kind === 'chat' ? <ChatStudio onOpenGit={!busy && (leaves.some((item) => item.kind === 'git') || leaves.length < 8) && state.projects.find((project) => project.id === conversation.projectId)?.kind === 'git' ? () => { if (!visible.git) toggle('git') } : undefined} onActiveChatChange={onActiveChatChange} floatingIds={floatingIds} setFloatingIds={setFloatingIds} conversation={conversation} state={state} agent={state.agents[conversation.id]} settings={settings} />
        : pane.kind === 'terminal' ? <TerminalPanel conversationId={conversation.id} paneId={pane.id} />
        : pane.kind === 'browser' ? <BrowserPanel conversationId={conversation.id} paneId={pane.id} />
        : <GitPanel conversationId={conversation.id} active={visible.git && (maximized === null || maximized === 'git') && (leaves.find((item) => item.kind === 'git' && item.id === active) || leaves.find((item) => item.kind === 'git'))?.id === pane.id} />}
    </Suspense>
  }
  function controls(kind: ToolKind) {
    return <div className="tool-dock-actions">
      <Button variant="ghost" size="icon" aria-label={`${maximized === kind ? 'Restore' : 'Maximize'} ${paneLabels[kind]}`} aria-pressed={maximized === kind} onClick={() => maximize(kind)}>
        {maximized === kind ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
      </Button>
      <Button variant="ghost" size="icon" aria-label={`Hide ${paneLabels[kind]}`} onClick={() => toggle(kind)}><Minus size={15} /></Button>
    </div>
  }
  return <div className="tool-workspace" data-maximized={maximized || ''}>
    <div className="tool-workspace-upper" hidden={maximized === 'terminal'}>
      <div className="tool-chat-area" hidden={maximized !== null}>
        {leaves.filter((pane) => pane.kind === 'chat').map((pane) => <section key={pane.id} className="pane-content" data-pane-id={pane.id} onFocusCapture={() => setActive(pane.id)}>{content(pane)}</section>)}
      </div>
      {(['browser', 'git'] as const).map((kind) => {
        const toolPanes = leaves.filter((pane) => pane.kind === kind)
        if (!toolPanes.length) return null
        return <section key={kind} className="tool-side-dock" aria-label={paneLabels[kind]} hidden={!visible[kind] || (maximized !== null && maximized !== kind)}>
          <div className="tool-dock-heading"><span>{paneLabels[kind]}</span>{controls(kind)}</div>
          {toolPanes.length > 1 && <div className="tool-tabs" aria-label={`Sessions for ${paneLabels[kind]}`}>
            {toolPanes.map((pane, index) => <button key={pane.id} onClick={() => setActive(pane.id)} aria-pressed={(toolPanes.find((item) => item.id === active) || toolPanes[0]).id === pane.id}>{paneLabels[kind]} {index + 1}</button>)}
          </div>}
          {toolPanes.map((pane) => <div key={pane.id} className="pane-content tool-session" data-pane-id={pane.id} hidden={(toolPanes.find((item) => item.id === active) || toolPanes[0]).id !== pane.id}>{content(pane)}</div>)}
        </section>
      })}
    </div>
    {terminals.length > 0 && <section className="terminal-dock" aria-label="Terminal" hidden={!visible.terminal || (maximized !== null && maximized !== 'terminal')}>
      <div className="tool-dock-heading">
        <div className="tool-tabs" role="tablist" aria-label="Terminals">
          {terminals.map((pane, index) => <div className="terminal-tab" key={pane.id}>
            <button role="tab" id={`tab-${pane.id}`} aria-controls={`session-${pane.id}`} aria-selected={selectedTerminal === pane.id} onClick={() => setActive(pane.id)} onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? terminals.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + terminals.length) % terminals.length
              setActive(terminals[next].id)
              document.getElementById(`tab-${terminals[next].id}`)?.focus()
            }}>Terminal {index + 1}</button>
            <Button variant="ghost" size="icon" disabled={busy} aria-label={`Close terminal ${index + 1}`} onClick={() => {
              if (selectedTerminal === pane.id) setActive(terminals.find((item) => item.id !== pane.id)?.id || leaves.find((item) => item.kind === 'chat')!.id)
              update(removePane(conversation.layout, pane.id))
            }}><X size={13} /></Button>
          </div>)}
        </div>
        <Button variant="ghost" size="icon" disabled={busy || leaves.length >= 8} aria-label="New terminal tab" onClick={addTerminal}><Plus size={15} /></Button>
        {controls('terminal')}
      </div>
      {terminals.map((pane) => <div key={pane.id} id={`session-${pane.id}`} role="tabpanel" aria-labelledby={`tab-${pane.id}`} className="pane-content tool-session" data-pane-id={pane.id} hidden={selectedTerminal !== pane.id}>{content(pane)}</div>)}
    </section>}
  </div>
}
