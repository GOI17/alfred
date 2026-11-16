import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { socketUrl } from './api'
import { terminalWordNavigation } from './terminal-keyboard'
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
    const readTheme = () => {
      const styles = getComputedStyle(document.documentElement)
      return {
        background: styles.getPropertyValue('--terminal').trim(),
        foreground: styles.getPropertyValue('--terminal-foreground').trim(),
        cursor: styles.getPropertyValue('--terminal-foreground').trim(),
        cursorAccent: styles.getPropertyValue('--terminal').trim(),
      }
    }
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: tokens.getPropertyValue('--font-mono'),
      theme: readTheme(),
      scrollback: 5000,
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(container.current)
    // ADS changes these attributes for explicit themes and automatic OS changes.
    // Update xterm in place: recreating it would discard output and reconnect the PTY.
    let themeFrame = 0
    const themeObserver = new MutationObserver(() => {
      cancelAnimationFrame(themeFrame)
      themeFrame = requestAnimationFrame(() => {
        terminal.options.theme = readTheme()
      })
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-color-mode', 'data-theme', 'style'],
    })
    let disposed = false,
      wasVisible = false,
      retry: ReturnType<typeof setTimeout> | undefined
    const resize = () => {
      const visible = Boolean(
        container.current &&
          container.current.clientWidth > 0 &&
          container.current.clientHeight > 0,
      )
      const becameVisible = visible && !wasVisible
      wasVisible = visible
      if (visible) {
        fit.fit()
        // Focus only when opening or revealing this session, not on every resize.
        if (becameVisible) terminal.focus()
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
    terminal.attachCustomKeyEventHandler((event) => {
      const data = terminalWordNavigation(event, navigator.platform)
      if (data === undefined) return true
      event.preventDefault()
      // Use xterm's input path so onData sends exactly one sequence to the PTY.
      terminal.input(data, true)
      return false
    })
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
      themeObserver.disconnect()
      cancelAnimationFrame(themeFrame)
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
