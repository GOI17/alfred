import { useEffect, useMemo, useState } from 'react'
import { Activity, Atom, ChevronRight, FileDiff, FileText, FolderOpen, Globe, Link2, MoreHorizontal, Orbit, PanelRightClose, PanelRightOpen, Plus, Shapes, Sparkles, Star } from 'lucide-react'
import type { AgentState, Conversation, Project } from '../../shared/contracts'
import { api, errorMessage } from './api'
import { conversationResources, type ConversationResource } from './conversation-resources'
import { HARNESS_STALE_MS } from './subagents-panel'
import { useUI } from './ui-preferences'
import './assets/studio-inspector.css'

const agentIcons = [Atom, Shapes, Orbit, Sparkles, Star]
function agentColor(id: string) {
  return [...id].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 0) % agentIcons.length
}

export function StudioInspector({ conversation, agent, project, open, onToggle, onOpenGit, onAttach }: {
  conversation: Conversation; agent?: AgentState; project?: Project; open: boolean
  onToggle: () => void; onOpenGit?: () => void; onAttach: () => void
}) {
  const { t, language } = useUI()
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)
  const [allOutputs, setAllOutputs] = useState(false)
  const [allSources, setAllSources] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const projections = conversation.subagents || []
  useEffect(() => {
    if (!projections.length) return
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [projections.length])
  const resources = useMemo(() => conversationResources(conversation.messages), [conversation.messages])
  const attachments = conversation.messages.flatMap((message) => (message.attachments || []).map((file, index) => ({ ...file, key: `${message.id}:${index}` })))
  const notes = conversation.messages.flatMap((message) => message.notes.map((text, index) => ({ text, key: `${message.id}:${index}` }))).slice(-30).reverse()
  const agents = projections.flatMap((projection) => projection.agents.map((item) => ({ ...item, projection })))
  const folder = conversation.workspacePath.split(/[\\/]/).filter(Boolean).at(-1) || conversation.workspacePath
  const title = project?.path === conversation.workspacePath ? project.name : `Worktree · ${folder}`
  async function reveal(path: string) {
    if (opening) return
    setOpening(true); setError('')
    try { await api(`/conversations/${conversation.id}/files/reveal`, { path }) }
    catch (error) { setError(errorMessage(error)) }
    finally { setOpening(false) }
  }
  function resource(item: ConversationResource) {
    const Icon = item.kind === 'file' ? FileText : new URL(item.target).hostname === 'github.com' ? Link2 : Globe
    const content = <><Icon size={16} aria-hidden="true" /><span>{item.name}</span></>
    return item.kind === 'url'
      ? <a key={item.target} className="inspector-row inspector-resource" href={item.target} target="_blank" rel="noreferrer" title={item.target}>{content}</a>
      : <button key={item.target} type="button" className="inspector-row inspector-resource" disabled={opening} onClick={() => void reveal(item.target)} title={item.target}>{content}</button>
  }
  return <aside className="studio-inspector" aria-label={t('Changes and activity', 'Cambios y actividad')}>
    <div className="studio-inspector-card">
      {!open ? <button type="button" className="inspector-icon-button" aria-label={t('Show changes and activity', 'Mostrar cambios y actividad')} aria-expanded={false} onClick={onToggle}><PanelRightOpen size={18} /></button> : <>
        <header className="inspector-heading">
          <span title={conversation.workspacePath}>{title}</span>
          <details className="inspector-menu" onKeyDown={(event) => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus() } }}>
            <summary className="inspector-icon-button" aria-label={t('Workspace options', 'Opciones del espacio')}><MoreHorizontal size={18} /></summary>
            <div className="inspector-menu-content">
              <button type="button" onClick={onToggle}><PanelRightClose size={15} />{t('Collapse panel', 'Contraer panel')}</button>
              <button type="button" disabled={opening} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); void reveal('.') }}><FolderOpen size={15} />{t('Open workspace folder', 'Abrir carpeta del espacio')}</button>
            </div>
          </details>
        </header>
        <div className="inspector-changes">
          <button type="button" className="inspector-row" disabled={!onOpenGit} onClick={onOpenGit} title={onOpenGit ? t('Open Git changes', 'Abrir cambios de Git') : t('Git is unavailable for this workspace', 'Git no está disponible en este espacio')}>
            <FileDiff size={16} aria-hidden="true" /><span>{t('Changes', 'Cambios')}</span><ChevronRight size={14} className="inspector-row-arrow" aria-hidden="true" />
          </button>
          {agent?.approval && <details className="inspector-approval">
            <summary><span className="inspector-pending-dot" />{t('Pending approval', 'Aprobación pendiente')}<ChevronRight size={13} /></summary>
            <p>{agent.approval.path}</p><p className="inspector-empty">{t('Review and approve in the conversation.', 'Revisa y aprueba en la conversación.')}</p>
          </details>}
        </div>
        <section className="inspector-section" aria-label={t('Outputs', 'Resultados')}>
          <h2>{t('Outputs', 'Resultados')}</h2>
          {resources.outputs.length ? <>
            {resources.outputs.slice(0, 4).map(resource)}
            {resources.outputs.length > 4 && <details className="inspector-more" open={allOutputs} onToggle={(event) => setAllOutputs(event.currentTarget.open)}><summary>{allOutputs ? t('View less', 'Ver menos') : t('View all', 'Ver todos')} <span>{resources.outputs.length}</span></summary>{resources.outputs.slice(4).map(resource)}</details>}
          </> : <p className="inspector-empty">{t('Files shared by Alfred appear here.', 'Los archivos compartidos por Alfred aparecerán aquí.')}</p>}
        </section>
        <section className="inspector-section" aria-label={t('Subagents', 'Subagentes')}>
          <h2>{t('Subagents', 'Subagentes')}{agents.length > 0 && <span className="inspector-count">{agents.length}</span>}</h2>
          {agents.length ? agents.map((item) => {
            const color = agentColor(`${item.projection.harnessId}:${item.id}`)
            const Icon = agentIcons[color]
            const stale = now - Date.parse(item.projection.receivedAt) > HARNESS_STALE_MS
            return <details className="inspector-agent" key={`${item.projection.harnessId}:${item.id}`}>
              <summary className="inspector-row"><Icon size={18} className={`inspector-agent-icon inspector-agent-color-${color}`} aria-hidden="true" /><span>{item.name}</span><ChevronRight size={13} className="inspector-row-arrow" aria-hidden="true" /></summary>
              <div className="inspector-detail">
                <span className="inspector-agent-status">{item.status}</span>
                <p>{item.task}</p>
                {item.result !== undefined && <p>{item.result}</p>}
                {!!item.activity.length && <p>{item.activity.at(-1)?.text}</p>}
                <small><time dateTime={item.projection.receivedAt}>{new Date(item.projection.receivedAt).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })}</time>{stale && <> · {t('No recent updates', 'Sin actualizaciones recientes')}</>}</small>
              </div>
            </details>
          }) : <p className="inspector-empty">{t('No subagents yet.', 'Todavía no hay subagentes.')}</p>}
        </section>
        <section className="inspector-section" aria-label={t('Sources', 'Fuentes')}>
          <h2>{t('Sources', 'Fuentes')}<button type="button" className="inspector-icon-button" onClick={onAttach} aria-label={t('Attach a source', 'Adjuntar una fuente')} title={t('Attach a file to your next message', 'Adjuntar un archivo al próximo mensaje')}><Plus size={17} /></button></h2>
          <button type="button" className="inspector-row inspector-resource" aria-label={`${t('Open workspace folder', 'Abrir carpeta del espacio')}: ${project?.name || folder}`} title={conversation.workspacePath} disabled={opening} onClick={() => void reveal('.')}><FolderOpen size={16} aria-hidden="true" /><span>{project?.name || folder}</span></button>
          {resources.sources.slice(0, 3).map(resource)}
          {attachments.slice(0, 3).map((file) => <a key={file.key} className="inspector-row inspector-resource" href={`data:${file.mediaType};base64,${file.data}`} download={file.name} title={file.name}><FileText size={16} aria-hidden="true" /><span>{file.name}</span></a>)}
          {(resources.sources.length > 3 || attachments.length > 3) && <details className="inspector-more" open={allSources} onToggle={(event) => setAllSources(event.currentTarget.open)}><summary><Link2 size={16} />{allSources ? t('View less', 'Ver menos') : t('View all', 'Ver todas')}</summary>
            {resources.sources.slice(3).map(resource)}
            {attachments.slice(3).map((file) => <a key={file.key} className="inspector-row inspector-resource" href={`data:${file.mediaType};base64,${file.data}`} download={file.name}><FileText size={16} /><span>{file.name}</span></a>)}
          </details>}
        </section>
        <details className="inspector-activity">
          <summary className="inspector-row"><Activity size={16} aria-hidden="true" /><span>{t('Activity', 'Actividad')}</span><span className="inspector-count">{notes.length}</span><ChevronRight size={13} className="inspector-row-arrow" aria-hidden="true" /></summary>
          {notes.length ? <ol>{notes.map((note) => <li key={note.key} title={note.text}>{note.text}</li>)}</ol> : <p className="inspector-empty">{t('No activity recorded yet.', 'Todavía no hay actividad registrada.')}</p>}
        </details>
        {error && <p role="alert" className="error-text inspector-error">{error}</p>}
      </>}
    </div>
  </aside>
}
