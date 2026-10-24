import * as pty from 'node-pty'
import { z } from 'zod'
import type { WebSocket } from 'ws'

const input = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), data: z.string().max(16384) }),
  z.object({
    type: z.literal('resize'),
    cols: z.number().int().min(2).max(400),
    rows: z.number().int().min(2).max(200),
  }),
])
type Session = {
  process: pty.IPty
  sockets: Set<WebSocket>
  history: string
  exited: boolean
  exitCode?: number
}
export class Terminals {
  private sessions = new Map<string, Session>()
  attach(id: string, cwd: string, socket: WebSocket) {
    let session = this.sessions.get(id)
    if (!session) {
      const shell =
        process.platform === 'win32'
          ? process.env.COMSPEC || 'cmd.exe'
          : process.env.SHELL || '/bin/sh'
      const environment = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] =>
            entry[1] !== undefined &&
            !/^(ALFRED_|OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY)/.test(
              entry[0],
            ),
        ),
      )
      const terminal = pty.spawn(shell, [], {
        cwd,
        env: { ...environment, TERM: 'xterm-256color' },
        name: 'xterm-256color',
        cols: 100,
        rows: 30,
      })
      const created: Session = { process: terminal, sockets: new Set(), history: '', exited: false }
      terminal.onData((data) => {
        created.history = (created.history + data).slice(-256_000)
        for (const client of created.sockets) {
          if (client.bufferedAmount > 1_000_000)
            client.close(1013, 'Slow client; reconnect.')
          else if (client.readyState === client.OPEN)
            client.send(JSON.stringify({ type: 'output', data }))
        }
      })
      terminal.onExit(({ exitCode }) => {
        created.exited = true
        created.exitCode = exitCode
        for (const client of created.sockets)
          client.send(JSON.stringify({ type: 'exit', code: exitCode }))
      })
      this.sessions.set(id, created)
      session = created
    }
    const current = session
    current.sockets.add(socket)
    socket.send(JSON.stringify({ type: 'output', data: current.history }))
    if (current.exited) socket.send(JSON.stringify({ type: 'exit', code: current.exitCode }))
    socket.on('message', (raw) => {
      try {
        const message = input.parse(JSON.parse(raw.toString()))
        if (current.exited) return
        if (message.type === 'input') current.process.write(message.data)
        else current.process.resize(message.cols, message.rows)
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid terminal input.' }))
      }
    })
    socket.on('close', () => current.sockets.delete(socket))
    socket.send(JSON.stringify({ type: 'ready' }))
  }
  remove(id: string) {
    const session = this.sessions.get(id)
    if (!session) return
    for (const socket of session.sockets) socket.close()
    if (!session.exited) session.process.kill()
    this.sessions.delete(id)
  }
  close() {
    for (const id of this.sessions.keys()) this.remove(id)
  }
}
