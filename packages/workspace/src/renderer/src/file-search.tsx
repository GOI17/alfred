import { useEffect, useId, useRef, useState } from 'react'
import { api, errorMessage } from './api'
import { Dialog } from './components/ui/dialog'
import { useUI } from './ui-preferences'
import './assets/file-search.css'

type Results = { files: string[]; truncated: boolean }
export default function FileSearch({ conversationId, close, select }: { conversationId: string; close: () => void; select: (path: string) => void }) {
  const { t } = useUI()
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Results>({ files: [], truncated: false })
  const [selected, setSelected] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void api<Results>(`/conversations/${conversationId}/files?query=${encodeURIComponent(query.trim())}`, undefined, undefined, controller.signal)
        .then(value => { if (!controller.signal.aborted) { setResults(value); setSelected(0); setLoading(false) } })
        .catch(error => { if (!controller.signal.aborted) { setError(errorMessage(error)); setLoading(false) } })
    }, 120)
    return () => { clearTimeout(timer); controller.abort() }
  }, [conversationId, query])
  useEffect(() => { document.getElementById(`${id}-${selected}`)?.scrollIntoView({ block: 'nearest' }) }, [id, selected])
  const files = loading || error ? [] : results.files
  return <Dialog open onClose={close} onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus({ preventScroll: true }) }} title={t('Open file', 'Abrir archivo')} description={t('Search by name or path. ↑ ↓ to navigate, Enter to open.', 'Busca por nombre o ruta. ↑ ↓ para navegar, Enter para abrir.')}>
    <input ref={input} className="file-search-input" role="combobox" aria-label={t('Search files', 'Buscar archivos')} aria-autocomplete="list" aria-expanded aria-controls={id} aria-activedescendant={files[selected] ? `${id}-${selected}` : undefined} value={query} maxLength={300} placeholder={t('File name or path…', 'Nombre o ruta del archivo…')} onChange={event => { setQuery(event.target.value); setLoading(true); setError(''); setSelected(0) }} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (files.length) setSelected(value => (value + (event.key === 'ArrowDown' ? 1 : -1) + files.length) % files.length)
      }
      if (event.key === 'Enter') { event.preventDefault(); if (files[selected]) select(files[selected]) }
    }} />
    <div className="file-search-results" id={id} role="listbox" aria-label={t('Files', 'Archivos')} aria-busy={loading}>
      {files.map((path, index) => <div key={path} id={`${id}-${index}`} role="option" aria-selected={selected === index} className="file-search-result" onMouseDown={event => event.preventDefault()} onClick={() => select(path)}>{path}</div>)}
    </div>
    {error ? <p role="alert">{error}</p> : <p role="status" className="muted">{loading ? t('Searching…', 'Buscando…') : !files.length ? t('No files found.', 'No se encontraron archivos.') : results.truncated ? t('Results limited. Refine your search.', 'Resultados limitados. Afina tu búsqueda.') : t(`${files.length} files`, `${files.length} archivos`)}</p>}
  </Dialog>
}
