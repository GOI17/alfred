import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, errorMessage } from './api'
import { useUI } from './ui-preferences'
import type { HarnessCatalog, HarnessResource, HarnessSelection } from '../../shared/harnesses'
import { liveRefresh } from './live-refresh'

type Props = {
  conversationId: string; value: string; onChange: (value: string) => void
  sending: boolean; busy: boolean; onSend: () => void; settings: () => void
  harness?: HarnessSelection
}
export function ComposerInput({ conversationId, value, onChange, sending, busy, onSend, settings, harness }: Props) {
  const { t } = useUI()
  const [harnessResources, setHarnessResources] = useState<{ conversation: string; harness: string; resources: HarnessResource[] }>()
  const [harnessError, setHarnessError] = useState('')
  useEffect(() => {
    if (!harness) return
    return liveRefresh(async (signal) => {
      const catalog = await api<HarnessCatalog>(`/conversations/${conversationId}/harnesses`, undefined, 'GET', signal)
      if (!signal.aborted) {
        setHarnessResources({ conversation: conversationId, harness: harness.id, resources: catalog.resources.filter((item) => item.harness === harness.id && item.invocation && item.usable && !item.shadowedBy) })
        setHarnessError('')
      }
    }, (error) => setHarnessError(errorMessage(error)), 15000)
  }, [conversationId, harness?.id])
  const commands = [
    { name: '/explore', description: t('Explore the project', 'Explorar el proyecto'), text: t('Explore this project and explain its structure.', 'Explora este proyecto y explica su estructura.') },
    { name: '/plan', description: t('Prepare a plan', 'Preparar un plan'), text: t('Help me plan the following feature: ', 'Ayúdame a planear la siguiente funcionalidad: ') },
    { name: '/review', description: t('Review code', 'Revisar código'), text: t('Review the code and suggest improvements: ', 'Revisa el código y sugiere mejoras: ') },
    { name: '/settings', description: t('Open settings', 'Abrir ajustes'), text: '' },
    ...(harnessResources?.conversation === conversationId && harnessResources.harness === harness?.id ? harnessResources.resources.map((resource) => ({ name: resource.invocation!, description: resource.description, text: resource.invocation + ' ' })) : []),
  ]
  const input = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const element = input.current
    if (!element) return
    const resize = () => {
      element.style.height = 'auto'
      element.style.height = `${element.scrollHeight}px`
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [value])
  const id = useId()
  const [caret, setCaret] = useState(value.length)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [selected, setSelected] = useState(0)
  const [result, setResult] = useState<{ key: string; files: string[]; truncated?: boolean; error?: string }>({ key: '', files: [] })
  const match = /(?:^|\s)([@/])([^\s@/]*)$/.exec(value.slice(0, caret))
  const fileMatch = /(?:^|\s)@([^\s@]*)$/.exec(value.slice(0, caret))
  const marker = fileMatch ? '@' : match?.[1]
  const query = fileMatch ? fileMatch[1] : match?.[2] || ''
  const open = focused && !dismissed && !sending && !!marker
  const [position, setPosition] = useState({ left: 0, bottom: 0, width: 0, maxHeight: 260 })
  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const rect = input.current?.getBoundingClientRect()
      if (!rect) return
      setPosition({ left: rect.left, bottom: window.innerHeight - rect.top + 6,
        width: rect.width, maxHeight: Math.max(0, Math.min(260, rect.top - 14)) })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const observer = new ResizeObserver(update)
    if (input.current) observer.observe(input.current)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      observer.disconnect()
    }
  }, [open])
  const key = `${conversationId}:${query}`
  useEffect(() => {
    if (!open || marker !== '@') return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void api<{ files: string[]; truncated: boolean }>(`/conversations/${conversationId}/files?query=${encodeURIComponent(query)}`, undefined, undefined, controller.signal)
        .then((data) => { if (!controller.signal.aborted) setResult({ key, ...data }) })
        .catch((error) => { if (!controller.signal.aborted) setResult({ key, files: [], error: errorMessage(error) }) })
    }, 180)
    return () => { clearTimeout(timer); controller.abort() }
  }, [open, marker, query, conversationId, key])
  const items = marker === '@'
    ? (result.key === key ? result.files : []).map((path) => ({ name: path, description: t('Workspace file', 'Archivo del espacio'), text: `@${JSON.stringify(path)} ` }))
    : commands.filter((command) => command.name.toLowerCase().includes(query.toLowerCase()))
  const active = Math.min(selected, Math.max(0, items.length - 1))
  function choose(index: number) {
    const item = items[index]
    if (!item) return
    const start = caret - query.length - 1
    onChange(value.slice(0, start) + item.text + value.slice(caret))
    setDismissed(true)
    if (item.name === '/settings' && marker === '/') { settings(); return }
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(start + item.text.length, start + item.text.length)
    })
  }
  const listLabel = marker === '@' ? t('Project files', 'Archivos del proyecto') : t('Commands', 'Comandos')
  return <div style={{ position: 'relative' }}>
    {open && createPortal(<div style={{ position: 'fixed', ...position, boxSizing: 'border-box', zIndex: 1000, overflowY: 'auto', background: 'var(--surface)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
      <div>{listLabel} · {t('↑ ↓ select · Enter accept · Esc close', '↑ ↓ seleccionar · Enter aceptar · Esc cerrar')}</div>
      {marker === '/' && harness && harnessError && <p role="status">{t('Could not refresh harness commands.', 'No se pudieron actualizar los comandos del harness.')}</p>}
      <div id={id} role="listbox" aria-label={listLabel}>
        {items.map((item, index) => <button id={`${id}-${index}`} key={item.name} type="button" role="option" aria-selected={active === index}
          style={{ display: 'block', width: '100%', textAlign: 'left', padding: 8, background: active === index ? 'var(--accent)' : 'transparent', color: 'inherit', border: 0 }}
          onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)}>
          <strong>{item.name}</strong> <small>{item.description}</small>
        </button>)}
      </div>
      {!items.length && <p role="status">{marker === '@' && result.key !== key ? t('Searching files…', 'Buscando archivos…') : result.key === key && marker === '@' && result.error ? result.error : t('No matches.', 'Sin coincidencias.')}</p>}
      {marker === '@' && result.key === key && result.truncated && <small>{t('List truncated; type a path to narrow the search.', 'Lista truncada; escribe una ruta para acotar la búsqueda.')}</small>}
    </div>, document.body)}
    <textarea ref={input} className="textarea" aria-label={t('Message for Alfred', 'Mensaje para Alfred')} value={value} readOnly={sending} aria-busy={sending}
      aria-autocomplete="list" aria-controls={open ? id : undefined} aria-expanded={open} aria-activedescendant={open && items.length ? `${id}-${active}` : undefined}
      placeholder={busy ? t('Type to queue a message…', 'Escribe para poner un mensaje en cola…') : t('Type / for commands or @ for files…', 'Escribe / para comandos o @ para archivos…')} rows={2}
      onFocus={() => { setFocused(true); setDismissed(false) }} onBlur={() => { setFocused(false); setDismissed(true) }}
      onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
      onChange={(event) => { onChange(event.target.value); setCaret(event.target.selectionStart); setDismissed(false); setSelected(0) }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Tab') {
          const element = event.currentTarget
          const start = element.selectionStart
          const lineStart = value.lastIndexOf('\n', start - 1) + 1
          // Preserve native focus navigation unless indenting a new blank line.
          if (!sending && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey &&
            start === element.selectionEnd && lineStart > 0 && /^[\t ]*$/.test(value.slice(lineStart, start))) {
            event.preventDefault()
            onChange(value.slice(0, start) + '\t' + value.slice(start))
            setCaret(start + 1); setDismissed(true)
            requestAnimationFrame(() => element.setSelectionRange(start + 1, start + 1))
          }
          return
        }
        if (open) {
          if (event.key === 'Escape') { event.preventDefault(); setDismissed(true); return }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setSelected(items.length ? (active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length : 0); return
          }
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (items.length) choose(active); return }
        }
        if (event.key === 'Enter' && !event.shiftKey && !matchMedia('(pointer: coarse)').matches) { event.preventDefault(); onSend() }
      }} />
  </div>
}
