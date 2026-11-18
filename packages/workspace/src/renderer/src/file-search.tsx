import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react'
import type { Conversation, Project, Worktree } from '../../shared/contracts'
import { api, errorMessage } from './api'
import { Dialog } from './components/ui/dialog'
import { Button } from './components/ui/button'
import { useUI } from './ui-preferences'
import { searchWorkspace, type SearchKind, type SearchResult } from './workspace-search'
import './assets/file-search.css'

type Results = { files: string[]; truncated: boolean }
export default function FileSearch({ conversationId, projects, conversations, initialFilter = 'all', close, select }: {
  conversationId?: string; projects: Project[]; conversations: Conversation[]; initialFilter?: SearchKind | 'all'; close: () => void; select: (result: SearchResult) => void
}) {
  const { t } = useUI()
  const id = useId(), input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<SearchKind | 'all'>(initialFilter)
  const [files, setFiles] = useState<Results>({ files: [], truncated: false })
  const [trees, setTrees] = useState<{ projectId: string; tree: Worktree }[]>([])
  const [selected, setSelected] = useState(0), [loading, setLoading] = useState(false)
  const [error, setError] = useState(''), [treeError, setTreeError] = useState(''), [treeLoading, setTreeLoading] = useState(true)
  const worktreeErrorText = useEffectEvent(() => t('Some worktrees could not be loaded.', 'No se pudieron cargar algunos worktrees.'))
  const projectKey = JSON.stringify(projects.map(project => project.id))
  useEffect(() => {
    const controller = new AbortController()
    setTreeLoading(true); setTreeError(''); setTrees([])
    const ids: string[] = JSON.parse(projectKey)
    void Promise.allSettled(ids.map(async projectId => {
      const values = await api<Worktree[]>(`/projects/${projectId}/worktrees`, undefined, undefined, controller.signal)
      return values.map(tree => ({ projectId, tree }))
    })).then(results => {
      if (controller.signal.aborted) return
      setTrees(results.flatMap(result => result.status === 'fulfilled' ? result.value : []))
      if (results.some(result => result.status === 'rejected')) setTreeError(worktreeErrorText())
      setTreeLoading(false)
    })
    return () => controller.abort()
  }, [projectKey])
  useEffect(() => {
    const controller = new AbortController()
    setFiles({ files: [], truncated: false }); setError('')
    if (!conversationId || (filter !== 'all' && filter !== 'files')) { setLoading(false); return }
    setLoading(true)
    const timer = setTimeout(() => {
      void api<Results>(`/conversations/${conversationId}/files?query=${encodeURIComponent(query.trim())}`, undefined, undefined, controller.signal)
        .then(value => { if (!controller.signal.aborted) { setFiles(value); setLoading(false) } })
        .catch(error => { if (!controller.signal.aborted) { setError(errorMessage(error)); setLoading(false) } })
    }, 120)
    return () => { clearTimeout(timer); controller.abort() }
  }, [conversationId, query, filter])
  const local = useMemo(() => searchWorkspace(query, projects, conversations, trees), [query, projects, conversations, trees])
  const labels: Record<SearchKind, string> = { files: t('Files (active chat)', 'Archivos (chat activo)'), conversations: t('Conversations', 'Conversaciones'), messages: t('Messages', 'Mensajes'), worktrees: 'Worktrees' }
  const kinds: SearchKind[] = ['conversations', 'messages', 'worktrees', 'files']
  const active = conversations.find(item => item.id === conversationId)
  const fileResults: SearchResult[] = loading || error ? [] : files.files.slice(0, 50).map(path => ({ id: `file:${path}`, kind: 'files', label: path, context: active?.title || '', projectId: active?.projectId || '', conversationId, path }))
  const groups = kinds.filter(kind => filter === 'all' || filter === kind).map(kind => ({ kind, results: [...local, ...fileResults].filter(item => item.kind === kind) }))
  const results = groups.flatMap(group => group.results)
  const index = Math.min(selected, Math.max(0, results.length - 1))
  useEffect(() => { document.getElementById(`${id}-${index}`)?.scrollIntoView({ block: 'nearest' }) }, [id, index])
  return <Dialog open onClose={close} onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus({ preventScroll: true }) }} title={t('Search workspace', 'Buscar en el espacio')} description={t('Search across spaces. ↑ ↓ to navigate, Enter to open.', 'Busca en todos los espacios. ↑ ↓ para navegar, Enter para abrir.')}>
    <div className="workspace-search-filters" role="group" aria-label={t('Search context', 'Contexto de búsqueda')}>
      {(['all', ...kinds] as const).map(kind => <Button key={kind} variant="secondary" size="small" aria-pressed={filter === kind} onClick={() => { setFilter(kind); setSelected(0); input.current?.focus() }}>{kind === 'all' ? t('All', 'Todos') : labels[kind]}</Button>)}
    </div>
    <input ref={input} className="file-search-input" role="combobox" aria-label={t('Search workspace', 'Buscar en el espacio')} aria-autocomplete="list" aria-expanded aria-controls={id} aria-activedescendant={results[index] ? `${id}-${index}` : undefined} value={query} maxLength={300} placeholder={t('Title, message, branch or path…', 'Título, mensaje, rama o ruta…')} onChange={event => { setQuery(event.target.value); setFiles({ files: [], truncated: false }); setSelected(0) }} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (results.length) setSelected((index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length)
      }
      if (event.key === 'Enter') { event.preventDefault(); if (results[index]) select(results[index]) }
    }} />
    <div className="file-search-results" id={id} role="listbox" aria-label={t('Search results', 'Resultados de búsqueda')} aria-busy={loading || treeLoading}>
      {groups.filter(group => group.results.length).map(group => <div role="group" aria-label={labels[group.kind]} key={group.kind}>
        <div className="workspace-search-heading" aria-hidden="true">{labels[group.kind]}</div>
        {group.results.map(result => { const position = results.indexOf(result); return <div key={result.id} id={`${id}-${position}`} role="option" aria-selected={index === position} className="file-search-result" onMouseDown={event => event.preventDefault()} onClick={() => select(result)}><div>{result.label}</div><small className="muted">{result.context}</small></div> })}
      </div>)}
    </div>
    {(error || treeError) && <p role="alert">{[error, treeError].filter(Boolean).join(' ')}</p>}
    <p role="status" className="muted">{loading || treeLoading ? t('Searching…', 'Buscando…') : !results.length ? t('No results found.', 'No se encontraron resultados.') : t(`${results.length} results`, `${results.length} resultados`)} {t('Up to 50 results per context. Refine your search.', 'Hasta 50 resultados por contexto. Afina tu búsqueda.')}</p>
    {!conversationId && (filter === 'all' || filter === 'files') && <p className="muted">{t('Open a conversation to search its files.', 'Abre una conversación para buscar sus archivos.')}</p>}
  </Dialog>
}
