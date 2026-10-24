import { homedir, networkInterfaces } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { mkdir, readFile, realpath } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { tunnelConfig } from './cloudflare.js'
import { loadSecret } from './vault.js'
import { workspacePackageRoot } from './package-paths.js'

async function canonicalDestination(path: string): Promise<string> {
  const pending: string[] = []
  let existing = path
  while (true) {
    try {
      return resolve(await realpath(existing), ...pending)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      const parent = dirname(existing)
      if (parent === existing) throw error
      pending.unshift(existing.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)))
      existing = parent
    }
  }
}

/** Starts Workspace only when explicitly invoked; imports never open state or listen. */
export async function startWorkspace(options: { env?: NodeJS.ProcessEnv; args?: string[] } = {}) {
  const env = options.env ?? process.env
  const args = options.args ?? []
  const home = env.HOME || env.USERPROFILE || homedir()
  const directory = resolve(
    env.ALFRED_WORKSPACE_DATA_DIR || env.ALFRED_DATA_DIR || join(home, '.alfred-workspace'),
  )
  const destination = await canonicalDestination(directory)
  const within = relative(await realpath(workspacePackageRoot), destination)
  if (!within || (!within.startsWith(`..${sep}`) && within !== '..' && !isAbsolute(within)))
    throw new Error(
      'Workspace data must be outside the installed package. Choose --data-dir or ALFRED_WORKSPACE_DATA_DIR.',
    )
  const host =
    env.ALFRED_WORKSPACE_HOST ||
    env.ALFRED_HOST ||
    (args.includes('--share') ? '0.0.0.0' : '127.0.0.1')
  const port = Number(env.ALFRED_WORKSPACE_PORT || env.ALFRED_PORT || 4310)
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('Workspace port must be an integer from 0 to 65535.')
  const certPath = env.ALFRED_WORKSPACE_TLS_CERT || env.ALFRED_TLS_CERT
  const keyPath = env.ALFRED_WORKSPACE_TLS_KEY || env.ALFRED_TLS_KEY
  if (!!certPath !== !!keyPath)
    throw new Error('Workspace HTTPS requires both a certificate and a key.')
  const tls =
    certPath && keyPath
      ? { cert: await readFile(certPath), key: await readFile(keyPath) }
      : undefined
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const token =
    env.ALFRED_WORKSPACE_ACCESS_TOKEN ||
    env.ALFRED_ACCESS_TOKEN ||
    (await loadSecret(directory, 'access.key')).toString('base64url')
  const server = await createApp({
    directory,
    token,
    tunnel: tunnelConfig(env),
    dev: args.includes('--dev'),
    tls,
  })
  let stopping: Promise<void> | undefined
  const stop = () => {
    if (!stopping) {
      process.removeListener('SIGINT', interrupted)
      process.removeListener('SIGTERM', interrupted)
      stopping = server.app.close()
    }
    return stopping
  }
  const interrupted = () => {
    void stop().catch(() => {
      process.exitCode = 1
    })
  }
  server.app.addHook('onClose', async () => {
    process.removeListener('SIGINT', interrupted)
    process.removeListener('SIGTERM', interrupted)
  })
  try {
    await server.app.listen({ host, port })
  } catch (error) {
    await server.app.close()
    throw error
  }
  const address = server.app.server.address()
  const actualPort = address && typeof address !== 'string' ? address.port : port
  const scheme = tls ? 'https' : 'http'
  console.log(
    `\n  Alfred Workspace · ${scheme}://localhost:${actualPort}\n  Connection code: ${token}\n`,
  )
  if (host === '0.0.0.0') {
    for (const addresses of Object.values(networkInterfaces()))
      for (const address of addresses || [])
        if (address.family === 'IPv4' && !address.internal)
          console.log(`  On your phone: ${scheme}://${address.address}:${actualPort}`)
  }
  process.on('SIGINT', interrupted)
  process.on('SIGTERM', interrupted)
  return { ...server, stop, directory, address: `${scheme}://${host}:${actualPort}` }
}

let direct = false
try {
  direct =
    !!process.argv[1] &&
    realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
} catch {
  /* imported */
}
if (direct) {
  try {
    await startWorkspace({ args: process.argv.slice(2) })
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Workspace failed.')
    process.exitCode = 1
  }
}
