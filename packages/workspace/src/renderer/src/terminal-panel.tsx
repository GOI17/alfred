import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { socketUrl } from './api'
import { Button } from './components/ui/button'

export function TerminalPanel({
  conversationId,
  paneId,
}: {
  conversationId: string
  paneId: string
}) {
  const container = useRef<HTMLDivElement>(null),
    socket = useRef<WebSocket>(null)
  const [status, setStatus] = useState('Connecting…')
  useEffect(() => {
    if (!container.current) return
    const tokens = getComputedStyle(document.documentElement)
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: tokens.getPropertyValue('--font-mono'),
      theme: {
        background: tokens.getPropertyValue('--terminal').trim(),
        foreground: tokens.getPropertyValue('--terminal-foreground').trim(),
        cursor: tokens.getPropertyValue('--terminal-foreground').trim(),
      },
      scrollback: 5000,
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(container.current)
    let disposed = false,
      retry: ReturnType<typeof setTimeout> | undefined
    const resize = () => {
      if (container.current && container.current.clientWidth > 0) {
        fit.fit()
        if (socket.current?.readyState === WebSocket.OPEN)
          socket.current.send(
            JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }),
          )
      }
    }
    function connect() {
      const current = new WebSocket(
        socketUrl(`/conversations/${conversationId}/terminal/${paneId}`),
      )
      socket.current = current
      current.onopen = () => {
        terminal.reset()
        setStatus('Shared session')
        resize()
      }
      current.onmessage = (event) => {
        const message = JSON.parse(event.data)
        if (message.type === 'output') terminal.write(message.data)
        else if (message.type === 'ready') resize()
        else if (message.type === 'exit') setStatus(`Session ended · code ${message.code}`)
        else if (message.type === 'error') setStatus(message.message)
      }
      current.onclose = (event) => {
        if (!disposed && event.code !== 1011) {
          setStatus('Reconnecting…')
          retry = setTimeout(connect, 2000)
        }
      }
    }
    connect()
    const subscription = terminal.onData((data) => {
      if (socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(JSON.stringify({ type: 'input', data }))
    })
    const observer = new ResizeObserver(resize)
    observer.observe(container.current)
    return () => {
      disposed = true
      clearTimeout(retry)
      observer.disconnect()
      subscription.dispose()
      socket.current?.close()
      terminal.dispose()
    }
  }, [conversationId, paneId])
  return (
    <div className="terminal-panel">
      <div ref={container} className="terminal-canvas" />
      <div className="terminal-footer">
        <span>{status}</span>
        <div className="terminal-keys">
          {[
            { label: 'Esc', data: '\u001b' },
            { label: 'Tab', data: '\t' },
            { label: 'Ctrl+C', data: '\u0003' },
            { label: '↑', data: '\u001b[A' },
            { label: '↓', data: '\u001b[B' },
          ].map((key) => (
            <Button
              key={key.label}
              variant="ghost"
              size="small"
              onClick={() => {
                if (socket.current?.readyState === WebSocket.OPEN)
                  socket.current.send(JSON.stringify({ type: 'input', data: key.data }))
              }}
            >
              {key.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
