import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, copyFile, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

test('daemon survives launcher exit, starts once, stops and restarts', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'awd-'))
  const pkg = join(root, 'pkg')
  const data = join(root, 'data')
  await mkdir(join(pkg, 'scripts'), { recursive: true })
  await mkdir(join(pkg, 'dist/server/server'), { recursive: true })
  await copyFile(new URL('../scripts/cli.mjs', import.meta.url), join(pkg, 'scripts/cli.mjs'))
  await writeFile(join(pkg, 'package.json'), JSON.stringify({ type: 'module' }))
  await writeFile(join(pkg, 'dist/server/server/index.js'), `
    import { appendFile } from 'node:fs/promises';
    export async function startWorkspace({env}) {
      await appendFile(env.ALFRED_WORKSPACE_DATA_DIR + '/starts', process.pid + '\\n');
      const timer = setInterval(() => {}, 1000);
      return { address: 'http://127.0.0.1:4310', stop: async () => clearInterval(timer) };
    }
  `)
  const cli = join(pkg, 'scripts/cli.mjs')
  function run(...args) {
    return spawnSync(process.execPath, [cli, ...args, '--data-dir', data], {
      encoding: 'utf8', timeout: 10000,
    })
  }
  t.after(async () => {
    const stopped = run('stop')
    // Do not erase the control endpoint if cleanup failed.
    if (stopped.status === 0) await rm(root, { recursive: true, force: true })
  })
  const started = run()
  assert.equal(started.status, 0, started.stderr)
  assert.match(started.stdout, /daemon started/)
  assert.equal((await readFile(join(data, 'starts'), 'utf8')).trim().split('\n').length, 1)
  const duplicate = run('start')
  assert.equal(duplicate.status, 0, duplicate.stderr)
  assert.match(duplicate.stdout, /already running/)
  const restarted = run('restart')
  assert.equal(restarted.status, 0, restarted.stderr)
  assert.equal((await readFile(join(data, 'starts'), 'utf8')).trim().split('\n').length, 2)
  const stopped = run('stop')
  assert.equal(stopped.status, 0, stopped.stderr)
  assert.match(stopped.stdout, /daemon stopped/)
  const again = run('stop')
  assert.equal(again.status, 0, again.stderr)
  assert.match(again.stdout, /not running/)
})
