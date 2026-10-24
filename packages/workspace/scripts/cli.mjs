#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const manifest = new URL('../package.json', import.meta.url)
const entrypoint = new URL('../dist/server/server/index.js', import.meta.url)
const help = `Alfred Workspace — projects, conversations and local tools

Usage: alfred-workspace [serve|start] [options]
       alfred workspace [serve|start] [options]

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
`

/** Product composition and the standalone binary use the same lazy entrypoint. */
export async function run(args = [], env = process.env) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      host: { type: 'string' },
      port: { type: 'string' },
      'data-dir': { type: 'string' },
      share: { type: 'boolean' },
      dev: { type: 'boolean' },
    },
  })
  const command = positionals[0] || 'serve'
  if (values.help || command === 'help') {
    process.stdout.write(help)
    return 0
  }
  if (values.version || command === 'version') {
    const { version } = JSON.parse(readFileSync(manifest, 'utf8'))
    process.stdout.write(`alfred-workspace ${version}\n`)
    return 0
  }
  if (!['serve', 'start'].includes(command) || positionals.length > 1)
    throw new Error('Unknown Workspace command. Use alfred-workspace --help.')
  try {
    await access(entrypoint)
  } catch {
    throw new Error(
      'Workspace is not built. Build @alfred-labs/workspace or install an Alfred runtime that includes Workspace.',
    )
  }
  const options = { ...env }
  if (values.host !== undefined) options.ALFRED_WORKSPACE_HOST = values.host
  if (values.port !== undefined) options.ALFRED_WORKSPACE_PORT = values.port
  if (values['data-dir'] !== undefined) options.ALFRED_WORKSPACE_DATA_DIR = values['data-dir']
  const { startWorkspace } = await import(entrypoint.href)
  await startWorkspace({
    env: options,
    args: [...(values.share ? ['--share'] : []), ...(values.dev ? ['--dev'] : [])],
  })
  return 0
}

let direct = false
try {
  direct =
    !!process.argv[1] &&
    realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
} catch {
  /* imported or missing caller */
}
if (direct) {
  try {
    process.exitCode = await run(process.argv.slice(2), process.env)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Workspace failed.'}\n`)
    process.exitCode = 1
  }
}
