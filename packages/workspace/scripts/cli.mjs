#!/usr/bin/env node
import { readFileSync, realpathSync, openSync, closeSync } from 'node:fs'
import { access, mkdir, realpath, chmod } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { createServer, createConnection } from 'node:net'
import { spawn } from 'node:child_process'

const manifest = new URL('../package.json', import.meta.url)
const entrypoint = new URL('../dist/server/server/index.js', import.meta.url)
const help = `Alfred Workspace — projects, conversations and local tools

Usage: alfred-workspace [start|stop|restart|serve] [options]
       alfred workspace [start|stop|restart|serve] [options]

Commands:
  start (default)    Start a daemon independent of this terminal
  stop               Gracefully stop the daemon for this data directory
  restart            Stop the daemon, then start with the supplied options
  serve              Run in the foreground (Ctrl+C to stop)

Options:
  --host <address>   Listen interface (default: 127.0.0.1)
  --port <number>    Listen port (default: 4310)
  --data-dir <path>  Workspace state outside the installed package
  --share           Listen on the local network
  --dev             Use the source Vite development frontend
  -h, --help        Show this help without starting services
  -v, --version     Show the Workspace package version

Workspace runs independently. Memory and Agent Harness are optional external
capabilities; opening Workspace does not start or connect to either one.
The daemon does not automatically start after a reboot. Restart uses the current
options/environment. Server output and connection code are in workspace.log.
`

function request(endpoint, command) {
  return new Promise((resolveRequest, reject) => {
    const socket = createConnection(endpoint)
    let output = ''
    socket.setTimeout(30000, () => socket.destroy(new Error('Workspace daemon timed out.')))
    socket.on('connect', () => socket.write(`${command}\n`))
    socket.on('data', (chunk) => { output += chunk })
    socket.on('error', reject)
    socket.on('end', () => {
      try { resolveRequest(JSON.parse(output)) } catch { reject(new Error('Invalid daemon response.')) }
    })
  })
}

async function daemonEndpoint(env, create) {
  const directory = resolve(env.ALFRED_WORKSPACE_DATA_DIR || env.ALFRED_DATA_DIR ||
    join(env.HOME || env.USERPROFILE || homedir(), '.alfred-workspace'))
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 })
  let canonical
  try { canonical = await realpath(directory) } catch (error) {
    if (!create && error.code === 'ENOENT') return { directory, endpoint: null }
    throw error
  }
  const endpoint = process.platform === 'win32'
    ? `\\\\.\\pipe\\alfred-workspace-${createHash('sha256').update(canonical).digest('hex')}`
    : join(canonical, 'daemon.sock')
  return { directory: canonical, endpoint }
}

async function status(endpoint, command = 'status') {
  if (!endpoint) return null
  try { return await request(endpoint, command) } catch (error) {
    if (error.code === 'ENOENT') return null
    // Never unlink a socket belonging to a concurrent startup or signal a reused PID.
    if (error.code === 'ECONNREFUSED') throw new Error(
      `Workspace control socket is unavailable: ${endpoint}. If a previous daemon crashed, verify it is stopped and remove the stale socket before starting again.`,
    )
    throw error
  }
}

async function runDaemon(options, args) {
  const { endpoint } = await daemonEndpoint(options, true)
  let workspace
  let stopping = false
  const control = createServer((socket) => {
    socket.setTimeout(30000, () => socket.destroy())
    socket.once('data', async (chunk) => {
      const command = chunk.toString().trim()
      if (command === 'status') {
        socket.end(JSON.stringify({ running: true, address: workspace?.address }))
      } else if (command === 'stop' && !stopping && workspace) {
        stopping = true
        try {
          await workspace.stop()
          control.close()
          socket.end(JSON.stringify({ stopped: true }))
        } catch (error) {
          socket.end(JSON.stringify({ error: error.message }))
          stopping = false
        }
      } else socket.end(JSON.stringify({ error: 'Daemon is starting or stopping.' }))
    })
  })
  await new Promise((resolveListen, reject) => {
    control.once('error', reject)
    control.listen(endpoint, resolveListen)
  })
  try {
    if (process.platform !== 'win32') await chmod(endpoint, 0o600)
    const { startWorkspace } = await import(entrypoint.href)
    workspace = await startWorkspace({ env: options, args })
    // The server's own signal handler closes its resources; also close control.
    process.once('SIGTERM', () => control.close())
    process.once('SIGINT', () => control.close())
    process.send?.({ ready: true, address: workspace.address })
    process.disconnect?.()
  } catch (error) {
    control.close()
    throw error
  }
}

async function launch(options, args, directory) {
  const log = join(directory, 'workspace.log')
  const fd = openSync(log, 'a', 0o600)
  let child
  try {
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args], {
      cwd: process.cwd(), env: options, detached: true,
      stdio: ['ignore', fd, fd, 'ipc'], windowsHide: true,
    })
  } finally { closeSync(fd) }
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      child.disconnect()
      child.unref()
      reject(new Error(`Workspace startup is still pending; inspect ${log} before retrying.`))
    }, 30000)
    const cleanup = () => {
      clearTimeout(timer)
      child.removeListener('error', failed)
      child.removeListener('exit', exited)
      child.removeListener('message', ready)
    }
    const failed = (error) => { cleanup(); reject(error) }
    const exited = (code) => failed(new Error(`Workspace failed to start (${code}); inspect ${log}.`))
    const ready = (message) => {
      if (!message.ready) return
      cleanup()
      child.unref()
      process.stdout.write(`Workspace daemon started: ${message.address}\nLog and connection code: ${log}\n`)
      resolveReady()
    }
    child.once('error', failed)
    child.once('exit', exited)
    child.on('message', ready)
  })
}

/** Product composition and the standalone binary use the same lazy entrypoint. */
export async function run(args = [], env = process.env) {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
      host: { type: 'string' }, port: { type: 'string' }, 'data-dir': { type: 'string' },
      share: { type: 'boolean' }, dev: { type: 'boolean' },
    },
  })
  const command = positionals[0] || 'start'
  if (values.help || command === 'help') { process.stdout.write(help); return 0 }
  if (values.version || command === 'version') {
    const { version } = JSON.parse(readFileSync(manifest, 'utf8'))
    process.stdout.write(`alfred-workspace ${version}\n`)
    return 0
  }
  if (!['serve', 'start', 'stop', 'restart'].includes(command) || positionals.length > 1)
    throw new Error('Unknown Workspace command. Use alfred-workspace --help.')
  const options = { ...env }
  if (values.host !== undefined) options.ALFRED_WORKSPACE_HOST = values.host
  if (values.port !== undefined) options.ALFRED_WORKSPACE_PORT = values.port
  if (values['data-dir'] !== undefined) options.ALFRED_WORKSPACE_DATA_DIR = values['data-dir']
  const serverArgs = [...(values.share ? ['--share'] : []), ...(values.dev ? ['--dev'] : [])]
  if (command !== 'stop') {
    try { await access(entrypoint) } catch {
      throw new Error('Workspace is not built. Build @alfred-labs/workspace or install an Alfred runtime that includes Workspace.')
    }
  }
  if (command === 'serve') {
    const { startWorkspace } = await import(entrypoint.href)
    await startWorkspace({ env: options, args: serverArgs })
    return 0
  }
  // Only children spawned with an IPC channel enter the daemon worker.
  if (command === 'start' && process.send) {
    await runDaemon(options, serverArgs)
    return 0
  }
  const { directory, endpoint } = await daemonEndpoint(options, command !== 'stop')
  if (command === 'stop' || command === 'restart') {
    const result = await status(endpoint, 'stop')
    if (result?.error) throw new Error(result.error)
    process.stdout.write(result ? 'Workspace daemon stopped.\n' : 'Workspace daemon is not running.\n')
    if (command === 'stop') return 0
  } else {
    const result = await status(endpoint)
    if (result) { process.stdout.write(`Workspace daemon is already running${result.address ? `: ${result.address}` : ''}.\n`); return 0 }
  }
  // Pass parsed options, never the stop/restart positional, to the worker.
  const childArgs = ['start', ...serverArgs]
  options.ALFRED_WORKSPACE_DATA_DIR = directory
  await launch(options, childArgs, directory)
  return 0
}

let direct = false
try {
  direct = !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
} catch { /* imported or missing caller */ }
if (direct) {
  try { process.exitCode = await run(process.argv.slice(2), process.env) } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Workspace failed.'}\n`)
    process.exitCode = 1
    if (process.connected) process.disconnect()
  }
}
