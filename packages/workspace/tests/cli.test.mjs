import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  copyFile,
  symlink,
  realpath,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'workspace-cli-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const pkg = join(root, 'only workspace')
  const cwd = join(root, 'user project with spaces')
  const home = join(root, 'home')
  await Promise.all([mkdir(join(pkg, 'scripts'), { recursive: true }), mkdir(cwd), mkdir(home)])
  await copyFile(new URL('../scripts/cli.mjs', import.meta.url), join(pkg, 'scripts/cli.mjs'))
  await copyFile(new URL('../package.json', import.meta.url), join(pkg, 'package.json'))
  const cli = join(pkg, 'scripts/cli.mjs')
  const env = { PATH: process.env.PATH, HOME: home, TMPDIR: root }
  return { root, pkg, cwd, home, cli, env }
}

test('standalone help/version and imports need neither peer packages nor runtime dependencies', async (t) => {
  const f = await fixture(t)
  for (const args of [['--help'], ['help'], ['--version'], ['version']]) {
    const result = spawnSync(process.execPath, [f.cli, ...args], {
      cwd: f.cwd,
      env: f.env,
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(
      result.stdout,
      args.includes('help') || args.includes('--help')
        ? /Workspace.*projects/s
        : /alfred-workspace \d+\.\d+\.\d+/,
    )
  }
  const imported = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const {run}=await import(${JSON.stringify(pathToFileURL(f.cli).href)});console.log(typeof run);`,
    ],
    { cwd: f.cwd, env: f.env, encoding: 'utf8' },
  )
  assert.equal(imported.status, 0, imported.stderr)
  assert.equal(imported.stdout.trim(), 'function')
  assert.deepEqual(await readdir(f.home), [])
  assert.deepEqual(await readdir(f.cwd), [])
})

test('missing build or unknown command never installs dependencies or starts services', async (t) => {
  const f = await fixture(t)
  for (const [args, message] of [
    [['serve'], /Workspace is not built/],
    [['unknown'], /Unknown Workspace command/],
    [['serve', '--unexpected'], /Unknown option/],
  ]) {
    const result = spawnSync(process.execPath, [f.cli, ...args], {
      cwd: f.cwd,
      env: f.env,
      encoding: 'utf8',
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, message)
  }
  assert.deepEqual(await readdir(f.home), [])
  assert.deepEqual(await readdir(f.cwd), [])
})

test('CLI forwards explicit workspace options and preserves the invoking project', async (t) => {
  const f = await fixture(t)
  const output = join(f.root, 'called.json')
  await mkdir(join(f.pkg, 'dist/server/server'), { recursive: true })
  await writeFile(
    join(f.pkg, 'dist/server/server/index.js'),
    `import {writeFile} from 'node:fs/promises'; export async function startWorkspace(options) { await writeFile(options.env.RESULT,JSON.stringify({options,cwd:process.cwd()})); }`,
  )
  const result = spawnSync(
    process.execPath,
    [
      f.cli,
      'serve',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--data-dir',
      join(f.root, 'chosen state'),
      '--share',
    ],
    { cwd: f.cwd, env: { ...f.env, RESULT: output, ALFRED_PORT: '1234' }, encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
  const called = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(called.cwd, await realpath(f.cwd))
  assert.equal(called.options.env.ALFRED_WORKSPACE_PORT, '0')
  assert.equal(called.options.env.ALFRED_WORKSPACE_HOST, '127.0.0.1')
  assert.equal(called.options.env.ALFRED_WORKSPACE_DATA_DIR, join(f.root, 'chosen state'))
  assert.equal(called.options.env.ALFRED_PORT, '1234')
  assert.deepEqual(called.options.args, ['--share'])
})

test('standalone binary symlink executes the same entrypoint', async (t) => {
  const f = await fixture(t)
  const bin = join(f.root, 'alfred-workspace')
  await symlink(f.cli, bin)
  const result = spawnSync(process.execPath, [bin, '--version'], {
    cwd: f.cwd,
    env: f.env,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^alfred-workspace /)
})
