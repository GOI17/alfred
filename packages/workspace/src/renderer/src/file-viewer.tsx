import { memo, lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2, Minus } from 'lucide-react'
import { api, errorMessage } from './api'
import { useUI } from './ui-preferences'
import { Button } from './components/ui/button'
import './assets/panel-content.css'
import './assets/file-viewer.css'
const Editor = lazy(() => import('./file-editor'))
type Listing = { entries: { name: string; directory: boolean }[]; truncated: boolean }
const Folder = memo(function Folder({ base, path, select, activePath }: { base: string; path: string; select: (path: string) => void; activePath: string }) {
  const { t } = useUI()
  const [listing, setListing] = useState<Listing>()
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string[]>([])
  const activeFile = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const prefix = path === '.' ? '' : `${path}/`
    if (!activePath.startsWith(prefix)) return
    const relative = activePath.slice(prefix.length)
    const separator = relative.indexOf('/')
    if (separator < 0) return
    const ancestor = `${prefix}${relative.slice(0, separator)}`
    setExpanded(items => items.includes(ancestor) ? items : [...items, ancestor])
  }, [activePath, path])
  useEffect(() => {
    activeFile.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activePath, listing])
  useEffect(() => {
    const controller = new AbortController()
    void api<Listing>(`${base}/tree?path=${encodeURIComponent(path)}`, undefined, undefined, controller.signal).then(result => { if (!controller.signal.aborted) setListing(result) }).catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)) })
    return () => controller.abort()
  }, [base, path])
  return <ul className="file-tree">{error ? <li role="alert">{error}</li> : !listing ? <li>{t('Loading…', 'Cargando…')}</li> : <>{listing.entries.map(entry => {
    const child = path === '.' ? entry.name : `${path}/${entry.name}`
    const open = expanded.includes(child)
    const active = !entry.directory && child === activePath
    return <li key={child}><button ref={active ? activeFile : undefined} title={child} aria-current={active ? 'true' : undefined} aria-expanded={entry.directory ? open : undefined} onClick={() => entry.directory ? setExpanded(items => open ? items.filter(item => item !== child) : [...items, child]) : select(child)}>{entry.directory ? (open ? '▾ ' : '▸ ') : active ? '● ' : '· '}{entry.name}</button>{entry.directory && open && <Folder base={base} path={child} select={select} activePath={activePath} />}</li>
  })}{listing.truncated && <li>{t('Limited to 500 entries.', 'Limitado a 500 entradas.')}</li>}</>}</ul>
})
export default function FileViewer({ conversationId, close, openFile }: { conversationId: string; close: () => void; openFile?: { path: string } }) {
  const { t } = useUI()
  const base = `/conversations/${conversationId}/viewer`
  const [maximized, setMaximized] = useState(false)
  const [path, setPath] = useState(openFile?.path || '')
  useEffect(() => { if (openFile) setPath(openFile.path) }, [openFile])
  const [loaded, setLoaded] = useState<{ path: string; content: string }>()
  const content = loaded?.path === path ? loaded.content : undefined
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const cache = useRef(new Map<string, { content: string; scroll: number }>())
  useEffect(() => {
    setError(''); setLoaded(undefined)
    if (!path) return
    const controller = new AbortController()
    const cached = cache.current.get(path)
    if (cached) setLoaded({ path, content: cached.content })
    else void api<{ content: string }>(`${base}/content?path=${encodeURIComponent(path)}`, undefined, undefined, controller.signal).then(result => {
      if (controller.signal.aborted) return
      if (cache.current.size >= 5) cache.current.delete(cache.current.keys().next().value!)
      cache.current.set(path, { content: result.content, scroll: 0 }); setLoaded({ path, content: result.content })
    }).catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)) })
    return () => controller.abort()
  }, [base, path, revision])
  return <section className="file-viewer" data-maximized={maximized} aria-label={t('Files', 'Archivos')}>
    <div className="tool-dock-heading">
      <span>{t('Files', 'Archivos')}</span>
      <div className="tool-dock-actions">
        <Button variant="ghost" size="icon" aria-label={maximized ? t('Restore Files', 'Restaurar Archivos') : t('Maximize Files', 'Maximizar Archivos')} aria-pressed={maximized} onClick={() => setMaximized(value => !value)}>
          {maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </Button>
        <Button variant="ghost" size="icon" aria-label={t('Hide Files', 'Ocultar Archivos')} onClick={close}><Minus size={15} /></Button>
      </div>
    </div>
    <div className="file-viewer-toolbar"><span>{t('Read only', 'Solo lectura')}</span><Button variant="ghost" size="small" onClick={() => { cache.current.clear(); setLoaded(undefined); setRevision(v => v + 1) }}>{t('Refresh', 'Actualizar')}</Button></div>
    <div className="file-viewer-body"><nav aria-label={t('File tree', 'Árbol de archivos')}><Folder key={revision} base={base} path="." select={setPath} activePath={path} /></nav><div className="file-preview"><div className="file-preview-path" title={path}>{path || t('Select a file', 'Selecciona un archivo')}{content !== undefined && <Button variant="ghost" size="small" onClick={() => { void navigator.clipboard.writeText(content).catch(e => setError(errorMessage(e))) }}>{t('Copy', 'Copiar')}</Button>}</div>{error ? <p role="alert">{error}</p> : content !== undefined ? <Suspense fallback={<p>{t('Loading viewer…', 'Cargando visor…')}</p>}><Editor key={`${path}:${revision}`} path={path} content={content} scroll={cache.current.get(path)?.scroll || 0} saveScroll={scroll => { const item = cache.current.get(path); if (item) item.scroll = scroll }} /></Suspense> : path && <p>{t('Loading…', 'Cargando…')}</p>}</div></div>
  </section>
}
