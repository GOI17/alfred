import { useEffect, useRef } from 'react'
import { GitBranch, ChevronDown, Check, Plus, X } from 'lucide-react'
import type { Project, PublicState, Worktree } from '../../shared/contracts'
import { Button } from './components/ui/button'
import { WorkspaceAgentSummary } from './workspace-agent-summary'
import { useUI } from './ui-preferences'

export function WorktreePicker({ state, project, worktrees, workspacePath, connected, selectWorkspace, selectConversation, addWorktree, removeWorktree }: {
  state: PublicState; project: Project; worktrees: Worktree[]; workspacePath: string; connected: boolean
  selectWorkspace: (path: string) => void; selectConversation: (id: string) => void
  addWorktree: () => void; removeWorktree: (path: string) => void
}) {
  const { t } = useUI()
  const workspacePicker = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const picker = workspacePicker.current
      if (picker?.open && event.target instanceof Node && !picker.contains(event.target)) picker.open = false
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [])
  const activeWorkspace = worktrees.find((tree) => tree.path === workspacePath)
  return <details ref={workspacePicker} className="workspace-picker breadcrumb-worktree-picker" key={`${project.id}:${workspacePath}`} onKeyDown={(event) => {
            if (event.key === 'Escape' && event.currentTarget.open) {
              event.stopPropagation()
              event.currentTarget.open = false
              event.currentTarget.querySelector('summary')?.focus()
            }
          }}>
            <summary title={workspacePath} aria-label={`${t('Worktree', 'Worktree')}: ${activeWorkspace?.branch || workspacePath}`}><GitBranch size={14} /><span>{activeWorkspace?.branch || (workspacePath === project.path ? t('Main', 'Principal') : t('Active workspace', 'Espacio activo'))}</span><small className="workspace-picker-count">{worktrees.length}</small><ChevronDown size={14} /></summary>
            <div className="workspace-list" role="group" aria-label={t('Workspaces', 'Espacios de trabajo')}>
              {worktrees.map((tree) => <div key={tree.path} className="workspace-row" data-active={workspacePath === tree.path}>
                <WorkspaceAgentSummary state={state} connected={connected} projectId={project.id} workspacePath={tree.path} label={tree.branch} selectConversation={selectConversation}>
                  <button aria-pressed={workspacePath === tree.path} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); selectWorkspace(tree.path) }}><span className="workspace-selection-mark" aria-hidden="true">{workspacePath === tree.path ? <Check size={14} /> : <GitBranch size={14} />}</span><span>{tree.branch}</span>{tree.main && <span className="tiny-label">{t('main', 'principal')}</span>}</button>
                </WorkspaceAgentSummary>
                {!tree.main && tree.path !== project.path && <Button variant="ghost" size="icon" aria-label={`${t('Delete worktree', 'Eliminar worktree')} ${tree.branch}`} onClick={() => removeWorktree(tree.path)}><X size={13} /></Button>}
              </div>)}
              {project.kind === 'git' && <button className="sidebar-text-button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); addWorktree() }}><Plus size={14} />{t('New worktree', 'Nuevo worktree')}</button>}
            </div>
          </details>
}
