import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, Globe, CornerDownLeft, ShieldAlert } from 'lucide-react'
import { socketUrl } from './api'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'

export function BrowserPanel({
  conversationId,
  paneId,
}: {
  conversationId: string
  paneId: string
}) {
  const socket = useRef<WebSocket>(null),
    canvas = useRef<HTMLDivElement>(null),
    image = useRef<HTMLImageElement>(null),
    viewport = useRef({ width: 1100, height: 760 }),
    frame = useRef('')
  const [address, setAddress] = useState(''),
    [url, setUrl] = useState(''),
    [insecure, setInsecure] = useState(false),
    [error, setError] = useState(''),
    [text, setText] = useState(''),
    [online, setOnline] = useState(false)
  const touch = useRef({ x: 0, y: 0, moved: false })
  const send = (value: unknown) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(value))
  }
  useEffect(() => {
    let disposed = false,
      retry: ReturnType<typeof setTimeout> | undefined
    const resize = () => {
      if (canvas.current && canvas.current.clientWidth > 0 && canvas.current.clientHeight > 0)
        send({
          type: 'resize',
          width: Math.max(320, Math.min(1920, Math.floor(canvas.current.clientWidth))),
          height: Math.max(240, Math.min(1080, Math.floor(canvas.current.clientHeight))),
        })
    }
    function connect() {
      let firstLocation = true
      const current = new WebSocket(socketUrl(`/conversations/${conversationId}/browser/${paneId}`))
      socket.current = current
      current.binaryType = 'blob'
      current.onopen = () => setOnline(true)
      current.onmessage = (event) => {
        if (event.data instanceof Blob) {
          const next = URL.createObjectURL(event.data)
          if (image.current) image.current.src = next
          URL.revokeObjectURL(frame.current)
          frame.current = next
        } else {
          const message = JSON.parse(event.data)
          if (message.type === 'ready') resize()
          if (message.type === 'location') {
            if (firstLocation) {
              setInsecure(message.insecure)
              firstLocation = false
            }
            setUrl(message.url)
            viewport.current = { width: message.width, height: message.height }
          }
          if (message.type === 'error') setError(message.message)
        }
      }
      current.onclose = (event) => {
        setOnline(false)
        if (!disposed && event.code !== 1011) retry = setTimeout(connect, 2000)
      }
    }
    connect()
    const observer = new ResizeObserver(resize)
    if (canvas.current) observer.observe(canvas.current)
    return () => {
      disposed = true
      clearTimeout(retry)
      observer.disconnect()
      socket.current?.close()
      URL.revokeObjectURL(frame.current)
    }
  }, [conversationId, paneId])
  useEffect(() => {
    if (url && url !== 'about:blank') setAddress(url)
  }, [url])
  function navigate() {
    setError('')
    send({ type: 'navigate', url: address, insecure })
  }
  return (
    <div className="browser-panel">
      <form
        className="browser-toolbar"
        onSubmit={(event) => {
          event.preventDefault()
          navigate()
        }}
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back"
          onClick={() => send({ type: 'back' })}
        >
          <ArrowLeft size={15} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Forward"
          onClick={() => send({ type: 'forward' })}
        >
          <ArrowRight size={15} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Reload page"
          onClick={() => {
            setError('')
            send({ type: 'reload' })
          }}
        >
          <RotateCw size={14} />
        </Button>
        <Input
          aria-label="Web address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="URL or localhost:3000"
        />
        <Button
          type="submit"
          variant="secondary"
          size="icon"
          aria-label="Open address"
          disabled={!online}
        >
          <CornerDownLeft size={15} />
        </Button>
      </form>
      <div className="browser-security">
        <label>
          <input
            type="checkbox"
            checked={insecure}
            onChange={(event) => setInsecure(event.target.checked)}
          />
          <ShieldAlert size={13} />
          Allow self-signed certificates
        </label>
        <span>{online ? 'On the server' : 'Connecting…'}</span>
      </div>
      {error && (
        <div className="browser-error" role="alert">
          {error}
        </div>
      )}
      <div
        className="browser-canvas"
        ref={canvas}
        onWheel={(event) => {
          send({ type: 'scroll', x: event.deltaX, y: event.deltaY })
        }}
        onTouchStart={(event) => {
          touch.current = { x: event.touches[0].clientX, y: event.touches[0].clientY, moved: false }
        }}
        onTouchMove={(event) => {
          const point = event.touches[0]
          const delta = touch.current.y - point.clientY
          if (Math.abs(delta) > 3) {
            touch.current.moved = true
            send({ type: 'scroll', x: 0, y: delta })
            touch.current.y = point.clientY
          }
        }}
      >
        <img
          ref={image}
          className="browser-image"
          alt="Interactive view of the page on the server"
          tabIndex={0}
          data-visible={Boolean(url && url !== 'about:blank')}
          onClick={(event) => {
            if (touch.current.moved) {
              touch.current.moved = false
              return
            }
            const bounds = event.currentTarget.getBoundingClientRect()
            send({
              type: 'click',
              x: ((event.clientX - bounds.left) * viewport.current.width) / bounds.width,
              y: ((event.clientY - bounds.top) * viewport.current.height) / bounds.height,
            })
            event.currentTarget.focus()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Tab') return
            event.preventDefault()
            if (event.key.length === 1 && !event.ctrlKey && !event.metaKey)
              send({ type: 'text', text: event.key })
            else {
              const modifier = navigator.userAgent.includes('Mac') ? event.metaKey : event.ctrlKey
              send({
                type: 'key',
                key: `${modifier ? 'Control+' : ''}${event.altKey ? 'Alt+' : ''}${event.shiftKey ? 'Shift+' : ''}${event.key}`,
              })
            }
          }}
        />
        {(!url || url === 'about:blank') && (
          <div className="browser-placeholder">
            <Globe size={34} strokeWidth={1.3} />
            <h3>Your website, alongside your work.</h3>
            <p>
              Open a page or your project server.
              <br />
              Works from your phone too.
            </p>
          </div>
        )}
      </div>
      <form
        className="browser-text-entry"
        onSubmit={(event) => {
          event.preventDefault()
          send({ type: 'text', text })
          setText('')
        }}
      >
        <Input
          aria-label="Text for the page"
          placeholder="Type in the selected field…"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <Button variant="ghost" size="small" type="submit">
          Type
        </Button>
        <Button variant="ghost" size="small" onClick={() => send({ type: 'key', key: 'Enter' })}>
          Enter
        </Button>
      </form>
    </div>
  )
}
