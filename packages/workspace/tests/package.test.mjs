import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, cp, copyFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))

for (const dev of [false, true])
  test(`${dev ? 'development' : 'built'} Workspace serves assets and local state with peer products absent and external cwd`, async (t) => {
    assert.ok(
      existsSync(join(packageRoot, 'dist/client/index.html')),
      'Run the Workspace build before test:package.',
    )
    const root = await mkdtemp(join(tmpdir(), 'workspace-built-'))
    const pkg = join(root, 'isolated workspace package')
    const cwd = join(root, 'unrelated project with spaces')
    const home = join(root, 'home')
    await Promise.all([mkdir(join(pkg, 'scripts'), { recursive: true }), mkdir(cwd), mkdir(home)])
    await cp(join(packageRoot, 'dist'), join(pkg, 'dist'), { recursive: true })
    await copyFile(join(packageRoot, 'package.json'), join(pkg, 'package.json'))
    await copyFile(join(packageRoot, 'scripts/cli.mjs'), join(pkg, 'scripts/cli.mjs'))
    if (dev) {
      await cp(join(packageRoot, 'src/renderer'), join(pkg, 'src/renderer'), { recursive: true })
      await cp(join(packageRoot, 'src/shared'), join(pkg, 'src/shared'), { recursive: true })
      await copyFile(join(packageRoot, 'vite.config.ts'), join(pkg, 'vite.config.ts'))
    }
    if (dev) {
      // Model pnpm's individual dependency links, not a link to all node_modules.
      await mkdir(join(pkg, 'node_modules'))
      for (const name of await readdir(join(packageRoot, 'node_modules')))
        await symlink(join(packageRoot, 'node_modules', name), join(pkg, 'node_modules', name))
    } else await symlink(join(packageRoot, 'node_modules'), join(pkg, 'node_modules'), 'dir')
    const child = spawn(
      process.execPath,
      [join(pkg, 'scripts/cli.mjs'), 'serve', '--port', '0', ...(dev ? ['--dev'] : [])],
      {
        cwd,
        env: {
          PATH: process.env.PATH,
          HOME: home,
          TMPDIR: root,
          SHELL: '/bin/sh',
          ORCA_BACKGROUND_LAUNCH: '1',
          ALFRED_WORKSPACE_ACCESS_TOKEN: 'package-fixture-only',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let output = '',
      errors = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      errors += chunk
    })
    const exited = new Promise((resolve) =>
      child.once('exit', (code, signal) => resolve({ code, signal })),
    )
    t.after(async () => {
      if (child.exitCode === null && !child.killed) child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000)
      await exited
      clearTimeout(timer)
      await rm(root, { recursive: true, force: true })
    })
    const started = Date.now()
    while (
      !/http:\/\/localhost:(\d+)/.test(output) &&
      child.exitCode === null &&
      Date.now() - started < 15000
    )
      await new Promise((resolve) => setTimeout(resolve, 20))
    const match = /http:\/\/localhost:(\d+)/.exec(output)
    assert.ok(match, `Workspace failed to start: ${errors}`)
    const origin = `http://127.0.0.1:${match[1]}`
    const page = await fetch(origin)
    assert.equal(page.status, 200)
    const html = await page.text()
    assert.match(html, /Alfred Workspace/)
    const asset = dev
      ? /src="([^"]*main\.tsx[^"]*)"/.exec(html)
      : /(?:src|href)="([^"]*\/assets\/[^"]+)"/.exec(html)
    assert.ok(asset, 'Built client references an asset.')
    assert.equal((await fetch(new URL(asset[1], origin))).status, 200)
    if (dev) {
      const require = createRequire(join(pkg, 'package.json'))
      for (const name of ['manrope', 'dm-sans']) {
        const directory = dirname(require.resolve(`@fontsource-variable/${name}`))
        const font = join(directory, 'files', `${name}-latin-wght-normal.woff2`)
        const response = await fetch(new URL('/@fs' + font, origin))
        assert.equal(response.status, 200)
        assert.match(response.headers.get('content-type'), /font|woff/)
      }
    }
    assert.equal((await fetch(`${origin}/api/state`)).status, 401)
    const auth = await fetch(`${origin}/api/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'package-fixture-only' }),
    })
    assert.equal(auth.status, 200)
    const cookie = auth.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    const state = await fetch(`${origin}/api/state`, { headers: { cookie } })
    assert.equal(state.status, 200)
    assert.deepEqual((await state.json()).projects, [])
    assert.deepEqual(await readdir(cwd), [])
    assert.ok(existsSync(join(home, '.alfred-workspace/workspace.json')))
    assert.equal(existsSync(join(pkg, '.alfred-workspace')), false)
    assert.equal(existsSync(join(home, '.alfred')), false)
    child.kill('SIGTERM')
    const result = await exited
    assert.deepEqual(result, { code: 0, signal: null })
  })

test('startup rejects package-owned state and invalid options before writing state', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-rejected-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const pkg = join(root, 'only workspace')
  const home = join(root, 'home')
  await mkdir(join(pkg, 'scripts'), { recursive: true })
  await mkdir(home)
  await cp(join(packageRoot, 'dist'), join(pkg, 'dist'), { recursive: true })
  await copyFile(join(packageRoot, 'package.json'), join(pkg, 'package.json'))
  await copyFile(join(packageRoot, 'scripts/cli.mjs'), join(pkg, 'scripts/cli.mjs'))
  await symlink(join(packageRoot, 'node_modules'), join(pkg, 'node_modules'), 'dir')
  const alias = join(root, 'package alias')
  await symlink(pkg, alias, 'dir')
  const env = { PATH: process.env.PATH, HOME: home, TMPDIR: root }
  for (const args of [
    ['--data-dir', join(pkg, 'state')],
    ['--data-dir', join(alias, 'state')],
    ['--port', '65536'],
  ]) {
    const result = spawnSync(process.execPath, [join(pkg, 'scripts/cli.mjs'), 'serve', ...args], {
      env,
      encoding: 'utf8',
    })
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /outside the installed package|port must be/)
  }
  const tls = spawnSync(process.execPath, [join(pkg, 'scripts/cli.mjs'), 'serve'], {
    env: { ...env, ALFRED_WORKSPACE_TLS_CERT: join(root, 'absent.pem') },
    encoding: 'utf8',
  })
  assert.equal(tls.status, 1)
  assert.match(tls.stderr, /both a certificate and a key/)
  assert.deepEqual(await readdir(home), [])
  assert.equal(existsSync(join(pkg, 'state')), false)
})

test('public createApp accepts an independent runtime without legacy settings or peer products', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-port-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const pkg = join(root, 'only workspace')
  const home = join(root, 'home')
  await mkdir(pkg)
  await mkdir(home)
  await cp(join(packageRoot, 'dist'), join(pkg, 'dist'), { recursive: true })
  await copyFile(join(packageRoot, 'package.json'), join(pkg, 'package.json'))
  await symlink(join(packageRoot, 'node_modules'), join(pkg, 'node_modules'), 'dir')
  const script = join(pkg, 'integration.mjs')
  await writeFile(
    script,
    `
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { createApp } from '@alfred-labs/workspace/app'
globalThis.fetch = async () => { throw new Error('No external requests are allowed in this fixture.') }
let closed = false
const session = {
  states: () => ({}), partials: () => ({}), isRunning: () => false,
  start: async () => {}, stop: async () => {}, resume: async () => {},
  removeQueued: async () => {}, decide: () => {}, setPermission: async () => {},
  setHarness: async () => {}, compact: async () => {}, stopProvider: async () => {},
  close: async () => { closed = true },
}
const directory = join(process.env.HOME, 'runtime-state')
const server = await createApp({ directory, token: 'test-only', serve: false,
  sessionAdapter: () => ({ session, describe: async () => ({
    id: 'independent-runtime', name: 'Independent runtime',
    capabilities: { resume: true, cancel: true, compact: false, permissions: true },
    commands: [], skills: null, mcpServers: null,
  }) }),
})
try {
  const auth = await server.app.inject({ method: 'POST', url: '/api/auth', payload: { code: 'test-only' } })
  assert.equal(auth.statusCode, 200)
  const headers = { cookie: auth.cookies.map(c => c.name + '=' + c.value).join('; ') }
  const runtime = await server.app.inject({ url: '/api/runtime', headers })
  assert.equal(runtime.statusCode, 200)
  assert.equal(runtime.json().id, 'independent-runtime')
  assert.deepEqual(runtime.json().commands, [])
  assert.equal(runtime.json().skills, null)
  assert.equal((await server.app.inject({ url: '/api/harnesses', headers })).statusCode, 404)
  assert.equal((await server.app.inject({ url: '/api/conversations/test/agent-access', headers })).statusCode, 404)
  assert.equal(server.service.chat, session)
  assert.equal('capabilities' in session, false)
  assert.equal(existsSync(join(directory, 'agent-access.json')), false)
} finally { await server.app.close() }
assert.equal(closed, true)
`,
  )
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: home, TMPDIR: root },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
})
