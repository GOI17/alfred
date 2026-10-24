import { spawn } from 'node:child_process'

/** Not a sandbox. Deliberately requires host-command authorization at the caller. */
export function executeAgentCommand(command: string, cwd: string, signal: AbortSignal, timeout = 60_000): Promise<{ output: string; exitCode: number | null; stopped: boolean; truncated: boolean }> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, detached: process.platform !== 'win32', windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Do not forward application tokens/provider keys. This is NOT filesystem isolation.
      env: Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP', 'LANG'].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : [])),
    })
    let output = ''
    let bytes = 0
    let stopped = false
    let truncated = false
    let escalation: ReturnType<typeof setTimeout> | undefined
    const kill = (force: boolean) => {
      if (!child.pid) return
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.on('error', () => { child.kill() })
      } else {
        try { process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM') } catch { /* Already exited. */ }
      }
    }
    const stop = () => {
      if (stopped) return
      stopped = true
      kill(false)
      escalation = setTimeout(() => kill(true), 1000)
    }
    const append = (chunk: Buffer) => {
      const room = Math.max(0, 100_000 - bytes)
      output += chunk.subarray(0, room).toString('utf8')
      bytes += chunk.length
      if (bytes > 100_000) { truncated = true; stop() }
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    const timer = setTimeout(stop, Math.min(120_000, Math.max(100, timeout)))
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
    const cleanup = () => {
      clearTimeout(timer)
      if (escalation) clearTimeout(escalation)
      signal.removeEventListener('abort', stop)
      // Best effort cleanup of descendants when the shell exits first.
      kill(true)
    }
    child.once('error', (error) => { cleanup(); reject(error) })
    child.once('close', (exitCode) => { cleanup(); resolve({ output, exitCode, stopped, truncated }) })
  })
}
