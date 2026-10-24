import { layoutKey, point, pointMap, stringList, usePersistentLayout } from './use-persistent-layout'
import { useEffect, useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from 'react'
import { Columns2, PanelTop, X, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import type { Conversation } from '../../shared/contracts'
import { Button } from './components/ui/button'
import { useUI } from './ui-preferences'
import './assets/chat-deck.css'

/** Layout is persisted per workspace. Closing a column never deletes a conversation. */
export function ChatDeck({ conversation, conversations, render, floatingIds, setFloatingIds, onActiveChatChange }: {
  onActiveChatChange?: (id: string) => void
  floatingIds?: string[]
  setFloatingIds?: Dispatch<SetStateAction<string[]>>
  conversation: Conversation
  conversations: Conversation[]
  render: (conversation: Conversation) => ReactNode
}) {
  const { t } = useUI()
  const [popupBlocked, setPopupBlocked] = useState<string | null>(null)
  const key = (part: string) => layoutKey(conversation.projectId, conversation.workspacePath, part)
  const [ids, setIds] = usePersistentLayout<string[]>(key('columns'), [], stringList)
  const [localFloating, setLocalFloating] = useState<string[]>([])
  const floating = floatingIds ?? localFloating
  const setFloating = setFloatingIds ?? setLocalFloating
  const [focused, setFocused] = usePersistentLayout<string>(key('focused'), conversation.id, (value): value is string => typeof value === 'string')
  const [positions, setPositions] = usePersistentLayout<Record<string, { x: number; y: number }>>(key('positions'), {}, pointMap)
  const [camera, setCamera] = usePersistentLayout(key('camera'), { x: 0, y: 0 }, point)
  const [sizes, setSizes] = usePersistentLayout<Record<string, { x: number; y: number }>>(key('sizes'), {}, pointMap)
  const previousFloating = useRef(floating)
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const positionFor = (id: string) => positions[id] || { x: 16 + Math.max(0, floating.indexOf(id)) * 24, y: 16 + Math.max(0, floating.indexOf(id)) * 24 }
  useEffect(() => {
    const last = floating[floating.length - 1]
    if (last) {
      if (previousFloating.current.join('\0') !== floating.join('\0')) setFocused(last)
      setPositions((current) => current[last] ? current : {
        ...current,
        [last]: { x: 24 + ((floating.length - 1) % 6) * 28 - camera.x, y: 24 + ((floating.length - 1) % 6) * 28 - camera.y },
      })
    }
    previousFloating.current = floating
  }, [floating])
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function saveSizes() {
      if (!window.matchMedia('(min-width: 701px)').matches) return
      const updates: Record<string, { x: number; y: number }> = {}
      root.current?.querySelectorAll<HTMLElement>('[data-floating="true"]').forEach((element) => {
        if (element.dataset.chatColumn && element.offsetWidth > 0 && element.offsetHeight > 0) {
          updates[element.dataset.chatColumn] = { x: element.offsetWidth, y: element.offsetHeight }
        }
      })
      if (Object.keys(updates).length) setSizes((current) => ({ ...current, ...updates }))
    }
    window.addEventListener('pointerup', saveSizes)
    return () => window.removeEventListener('pointerup', saveSizes)
  }, [setSizes])
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const available = conversations.filter((item) => item.projectId === conversation.projectId && item.workspacePath === conversation.workspacePath && item.id !== conversation.id)
  const chats = [conversation, ...[...new Set([...ids, ...floating])].flatMap((id) => available.find((item) => item.id === id) || [])]
  const active = chats.some((item) => item.id === focused) ? focused : conversation.id
  useEffect(() => { onActiveChatChange?.(active) }, [active, onActiveChatChange])
  function openWindow(id: string) {
    const url = new URL(window.location.href)
    url.search = ''
    url.hash = ''
    url.searchParams.set('chatWindow', id)
    const popup = window.open(url.href, `alfred-chat-${id}`, 'popup=yes,width=720,height=900,resizable=yes,scrollbars=yes')
    setPopupBlocked(popup ? null : id)
    popup?.focus()
  }
  function reveal(id: string) {
    setFocused(id)
    requestAnimationFrame(() => {
      const column = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-chat-column]') || []).find((item) => item.dataset.chatColumn === id)
      column?.scrollIntoView({ block: 'nearest', inline: 'center' })
      column?.querySelector<HTMLElement>('.chat-column-title')?.focus()
    })
  }
  function move(id: string, x: number, y: number) {
    setPositions((current) => ({ ...current, [id]: { x, y } }))
  }
  function centerChat() {
    const id = floating.includes(active) ? active : floating[floating.length - 1]
    if (!id) return
    const position = positionFor(id)
    setCamera({ x: 24 - position.x, y: 24 - position.y })
  }

  return <div className="chat-deck" ref={root}>
    {!floating.length && <div className="chat-deck-toolbar" aria-label={t('Chat layout', 'Disposición de chats')}>
      <Columns2 size={16} aria-hidden="true" />
      <select disabled={!available.some((item) => !ids.includes(item.id))} aria-label={t('Add chat column', 'Agregar columna de chat')} value="" onChange={(event) => {
        const id = event.target.value
        if (!id) return
        setIds((current) => [...current, id]); reveal(id)
      }}>
        <option value="">{t('Add chat column…', 'Agregar columna de chat…')}</option>
        {available.filter((item) => !ids.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
      {chats.length > 1 && <div className="chat-deck-navigation">
      <Button variant="ghost" size="icon" aria-label={t('Previous chat', 'Chat anterior')} disabled={chats.length < 2} onClick={() => reveal(chats[(chats.findIndex((item) => item.id === active) + chats.length - 1) % chats.length].id)}><ChevronLeft size={16} /></Button>
      <Button variant="ghost" size="icon" aria-label={t('Next chat', 'Chat siguiente')} disabled={chats.length < 2} onClick={() => reveal(chats[(chats.findIndex((item) => item.id === active) + 1) % chats.length].id)}><ChevronRight size={16} /></Button>
      <span className="chat-deck-count">{chats.findIndex((item) => item.id === active) + 1} / {chats.length}</span>
      </div>}
    </div>}
    {floating.length > 0 && <div className="chat-canvas-controls">
      <span>{t('Drag the background to pan', 'Arrastra el fondo para recorrer el lienzo')}</span>
      <Button variant="ghost" onClick={centerChat}>{t('Return to active chat', 'Volver al chat activo')}</Button>
    </div>}
    <div className="chat-columns" data-canvas={floating.length > 0} data-multiple={chats.length > 1}
      style={floating.length ? { backgroundPosition: `${camera.x}px ${camera.y}px` } : undefined}
      tabIndex={floating.length ? 0 : undefined}
      aria-label={floating.length ? t('Chat canvas', 'Lienzo de chats') : undefined}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || !floating.length) return
        const delta = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] }[event.key]
        if (!delta) return
        event.preventDefault()
        setCamera((current) => ({ x: current.x + delta[0], y: current.y + delta[1] }))
      }}
      onPointerDown={(event) => {
        if (!floating.length || event.target !== event.currentTarget || event.button !== 0) return
        pan.current = { x: event.clientX, y: event.clientY, left: camera.x, top: camera.y }
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget.focus()
      }}
      onPointerMove={(event) => {
        if (pan.current) setCamera({ x: pan.current.left + event.clientX - pan.current.x, y: pan.current.top + event.clientY - pan.current.y })
      }}
      onPointerUp={() => { pan.current = null }} onPointerCancel={() => { pan.current = null }} onLostPointerCapture={() => { pan.current = null }}>

      {chats.map((chat) => <section key={chat.id} className="chat-column" data-chat-column={chat.id} data-floating={floating.includes(chat.id)} data-focused={active === chat.id} aria-label={chat.title} style={floating.includes(chat.id) ? { width: sizes[chat.id]?.x, height: sizes[chat.id]?.y, left: positionFor(chat.id).x + camera.x, top: positionFor(chat.id).y + camera.y, zIndex: active === chat.id ? 6 + floating.length : 5 + floating.indexOf(chat.id) } : undefined} onPointerDownCapture={() => setFocused(chat.id)} onFocusCapture={() => setFocused(chat.id)}>
        <div className="chat-column-heading">
          <button className="chat-column-title" title={floating.includes(chat.id) ? t('Drag to move; use arrow keys to reposition', 'Arrastra para mover; usa las flechas para reposicionar') : chat.title} onPointerDown={(event) => {
            if (!floating.includes(chat.id) || event.button !== 0) return
            drag.current = { x: event.clientX, y: event.clientY, left: positionFor(chat.id).x, top: positionFor(chat.id).y }
            event.currentTarget.setPointerCapture(event.pointerId)
          }} onPointerMove={(event) => {
            if (drag.current) move(chat.id, drag.current.left + event.clientX - drag.current.x, drag.current.top + event.clientY - drag.current.y)
          }} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }} onKeyDown={(event) => {
            if (!floating.includes(chat.id) || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
            event.preventDefault()
            move(chat.id, positionFor(chat.id).x + (event.key === 'ArrowLeft' ? -20 : event.key === 'ArrowRight' ? 20 : 0), positionFor(chat.id).y + (event.key === 'ArrowUp' ? -20 : event.key === 'ArrowDown' ? 20 : 0))
          }}>{chat.title}</button>
          <Button variant="ghost" size="icon" aria-label={t('Open in separate window', 'Abrir en ventana independiente')} title={t('Open in separate window', 'Abrir en ventana independiente')} onClick={() => openWindow(chat.id)}><ExternalLink size={16} /></Button>
          <span className="chat-float-control"><Button variant="ghost" size="icon" aria-label={floating.includes(chat.id) ? t('Dock chat', 'Acoplar chat') : t('Float chat', 'Hacer flotante el chat')} title={floating.includes(chat.id) ? t('Dock chat', 'Acoplar chat') : t('Float chat', 'Hacer flotante el chat')} aria-pressed={floating.includes(chat.id)} onClick={() => { if (!floating.includes(chat.id)) move(chat.id, 24 - camera.x, 24 - camera.y); setFloating((current) => current.includes(chat.id) ? current.filter((id) => id !== chat.id) : [...current, chat.id]); setIds((current) => chat.id === conversation.id || current.includes(chat.id) ? current : [...current, chat.id]) }}><PanelTop size={15} /></Button></span>
          {chat.id !== conversation.id && <Button variant="ghost" size="icon" aria-label={`${t('Close column', 'Cerrar columna')}: ${chat.title}`} onClick={() => {
            setIds((current) => current.filter((id) => id !== chat.id))
            setFloating((current) => current.filter((id) => id !== chat.id))
            reveal(conversation.id)
          }}><X size={15} /></Button>}
        </div>
        {popupBlocked === chat.id && <p role="alert" className="chat-window-error">{t('Allow pop-ups for Alfred and try again.', 'Permite las ventanas emergentes de Alfred y vuelve a intentarlo.')}</p>}
        <div className="chat-column-body">{render(chat)}</div>
      </section>)}
    </div>
  </div>
}
