import { afterEach, expect, it } from 'vitest'
import Fastify from 'fastify'
import { link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { authentication } from '../src/server/auth.js'
import { privatePath } from '../src/server/workspace-path-policy.js'
import { listWorkspaceFiles, workspaceFile } from '../src/server/workspace-files.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

it.each([
  '.ENV', '.Env.local', '.GIT/config', '.SSH/id_rsa', '.AWS/config',
  '.NPMRC', 'NODE_MODULES/package/index.js', 'cert.PEM', 'private.KEY',
  '.git./config', '.env ', '.env:stream', 'normal.txt:stream', 'bad\0name',
])('rejects private path aliases: %s', (path) => {
  expect(privatePath(path)).toBe(true)
})

it.each(['.', 'src/main.ts', 'README.md', 'docs/environment.md', 'src/key.ts'])
('preserves ordinary paths: %s', (path) => {
  expect(privatePath(path)).toBe(false)
})

async function workspace() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'alfred-security-')))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const project = join(root, 'project')
  await mkdir(project)
  return { root, project }
}

it('blocks hard links to files outside the workspace for reads and writes', async () => {
  const { root, project } = await workspace()
  const outside = join(root, 'synthetic.txt')
  await writeFile(outside, 'synthetic test data')
  await link(outside, join(project, 'alias.txt'))
  await expect(workspaceFile(project, 'alias.txt')).rejects.toThrow('Hard-linked')
  await expect(workspaceFile(project, 'alias.txt', true)).rejects.toThrow('Hard-linked')
})

it('checks canonical symlink targets against the same private-name policy', async () => {
  const { project } = await workspace()
  await writeFile(join(project, 'private.KEY'), 'synthetic test data')
  await symlink(join(project, 'private.KEY'), join(project, 'alias.txt'))
  await expect(workspaceFile(project, 'alias.txt')).rejects.toThrow('Private')
})

it('does not expose private-name variants in file suggestions', async () => {
  const { project } = await workspace()
  await writeFile(join(project, '.ENV'), 'synthetic test data')
  await writeFile(join(project, 'cert.PEM'), 'synthetic test data')
  await writeFile(join(project, 'hello.txt'), 'hello')
  expect((await listWorkspaceFiles(project)).files).toEqual(['hello.txt'])
})

it('fails closed when configured with an empty access code', async () => {
  const app = Fastify()
  cleanup.push(() => app.close())
  await expect(authentication(app, '   ')).rejects.toThrow('non-empty')
})

it('checks fetch metadata, authenticated logout, and ordinary session access', async () => {
  const app = Fastify()
  cleanup.push(() => app.close())
  await authentication(app, 'synthetic-test-code')
  app.get('/api/protected', async () => ({ ok: true }))
  expect((await app.inject({ method: 'DELETE', url: '/api/auth' })).statusCode).toBe(401)
  const login = await app.inject({
    method: 'POST', url: '/api/auth', payload: { code: 'synthetic-test-code' },
  })
  expect(login.statusCode).toBe(200)
  const cookie = login.cookies.map((item) => `${item.name}=${item.value}`).join('; ')
  expect((await app.inject({ url: '/api/protected', headers: { cookie } })).statusCode).toBe(200)
  expect((await app.inject({
    url: '/api/protected', headers: { cookie, 'sec-fetch-site': 'cross-site' },
  })).statusCode).toBe(403)
  expect((await app.inject({ method: 'DELETE', url: '/api/auth', headers: { cookie } })).statusCode).toBe(200)
})
