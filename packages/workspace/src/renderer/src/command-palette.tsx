import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Dialog } from './components/ui/dialog'
import { useUI } from './ui-preferences'
import './assets/file-search.css'

import type { WorkspaceCommand } from './command-registry'
export type { WorkspaceCommand } from './command-registry'

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export default function CommandPalette({ commands, close }: { commands: WorkspaceCommand[]; close: () => void }) {
  const { t } = useUI()
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const indexed = useMemo(() => commands.map(command => ({ command, label: normalize(command.label) })), [commands])
  const results = useMemo(() => {
    const words = normalize(query).split(/\s+/).filter(Boolean)
    return indexed.filter(item => words.every(word => item.label.includes(word))).map(item => item.command)
  }, [indexed, query])
  useEffect(() => { document.getElementById(`${id}-${selected}`)?.scrollIntoView({ block: 'nearest' }) }, [id, selected, query])
  function run(command: WorkspaceCommand) {
    if (command.disabled) return
    close()
    // Let the modal release focus before opening a panel or another dialog.
    setTimeout(command.run, 0)
  }
  return <Dialog open onClose={close} onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus() }} title={t('Command palette', 'Paleta de comandos')} description={t('Workspace and current view actions. ↑ ↓ to navigate, Enter to run.', 'Acciones del espacio y de la vista actual. ↑ ↓ para navegar, Enter para ejecutar.')}>
    <input ref={input} className="file-search-input" role="combobox" aria-label={t('Search commands', 'Buscar comandos')} aria-autocomplete="list" aria-expanded aria-controls={id} aria-activedescendant={results[selected] ? `${id}-${selected}` : undefined} placeholder={t('Search commands…', 'Buscar comandos…')} value={query} onChange={event => { setQuery(event.target.value); setSelected(0) }} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (results.length) setSelected(value => (value + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length) }
      if (event.key === 'Enter') { event.preventDefault(); if (results[selected]) run(results[selected]) }
    }} />
    <div className="file-search-results" id={id} role="listbox" aria-label={t('Commands', 'Comandos')}>
      {results.map((command, index) => <div key={command.id} id={`${id}-${index}`} role="option" aria-selected={selected === index} aria-disabled={command.disabled || undefined} className="file-search-result" style={command.disabled ? { opacity: 0.45 } : undefined} onMouseDown={event => event.preventDefault()} onClick={() => run(command)}>{command.label}{command.disabled && ` — ${t('Unavailable', 'No disponible')}`}</div>)}
    </div>
    <p className="muted" role="status">{results.length ? t(`${results.length} commands`, `${results.length} comandos`) : t('No commands found.', 'No se encontraron comandos.')}</p>
  </Dialog>
}
