import { afterEach, expect, it } from 'vitest'
import { lstat, mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { homedir } from 'node:os'
import { createApp } from '../src/server/app.js'
import { gitFixture } from './fixtures.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})
async function setup() {
  const files = await gitFixture()
  cleanup.push(() => rm(files.root, { recursive: true, force: true }))
  const directory = join(files.root, 'custom Alfred data')
  const { app, service } = await createApp({ directory, token: 'worktree-test', serve: false })
  cleanup.push(() => app.close())
  const auth = await app.inject({ method: 'POST', url: '/api/auth', payload: { code: 'worktree-test' } })
  const headers = { cookie: auth.cookies.map((item) => `${item.name}=${item.value}`).join('; ') }
  const project = await service.addProject(files.repository)
  const url = `/api/projects/${project.id}/worktrees`
  return { ...files, app, service, project, directory, headers, url }
}

it('previews the configured default without creating files and creates at that exact path', async () => {
  const { app, project, directory, headers, url, git } = await setup()
  const preview = await app.inject({ url: `${url}/location`, headers })
  expect(preview.statusCode).toBe(200)
  const { path } = preview.json<{ path: string }>()
  expect(dirname(path)).toBe(join(directory, 'worktrees', project.id))
  await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  const created = await app.inject({ method: 'POST', url, headers, payload: { branch: 'feature/default', path } })
  expect(created.statusCode).toBe(200)
  expect(created.json().path).toBe(path)
  expect((await app.inject({ url, headers })).json()).toContainEqual({ path, branch: 'feature/default', main: false, locked: false })
  expect(await git('rev-parse', 'feature/default')).toBe(await git('rev-parse', 'HEAD'))
  // Existing clients can still omit the path.
  const legacy = await app.inject({ method: 'POST', url, headers, payload: { branch: 'feature/legacy' } })
  expect(legacy.statusCode).toBe(200)
  expect(dirname(legacy.json().path)).toBe(dirname(path))
})

it('creates and removes native worktrees in custom locations, including spaces and home-relative paths', async () => {
  const { app, service, project, root, headers, url } = await setup()
  for (const name of ['absolute', 'home']) {
    const destination = join(root, 'chosen folder', `worktree ${name}`)
    const path = name === 'home' ? `~/${relative(homedir(), destination)}` : destination
    const created = await app.inject({ method: 'POST', url, headers, payload: { branch: `feature/${name}`, path } })
    expect(created.statusCode, created.body).toBe(200)
    expect(created.json().path).toBe(destination)
    expect(await readFile(join(destination, 'hello.txt'), 'utf8')).toBe('hello\n')
    const conversation = await service.addConversation(project.id, destination)
    expect(conversation.workspacePath).toBe(destination)
    const removed = await app.inject({ method: 'DELETE', url, headers, payload: { path: destination } })
    expect(removed.statusCode).toBe(200)
    await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  }
})

it('rejects invalid and occupied destinations without creating a branch or changing existing files', async () => {
  const { app, root, repository, headers, url, git } = await setup()
  const empty = join(root, 'existing empty folder'), link = join(root, 'existing link')
  await mkdir(empty)
  await symlink(empty, link)
  for (const path of ['relative/folder', '', `${root}/bad\0path`, repository, empty, link, join(repository, 'hello.txt')]) {
    const result = await app.inject({ method: 'POST', url, headers, payload: { branch: 'feature/rejected', path } })
    expect(result.statusCode, result.body).toBe(400)
    expect(await git('branch', '--list', 'feature/rejected')).toBe('')
  }
  expect(await readFile(join(repository, 'hello.txt'), 'utf8')).toBe('hello\n')
  expect((await app.inject({ url, headers })).json()).toHaveLength(1)
})

it('requires authentication for location previews and rejects projects that are not Git repositories', async () => {
  const { app, service, root, headers, url } = await setup()
  expect((await app.inject(`${url}/location`)).statusCode).toBe(401)
  const folder = join(root, 'ordinary folder')
  await mkdir(folder)
  const project = await service.addProject(folder)
  expect((await app.inject({ url: `/api/projects/${project.id}/worktrees/location`, headers })).statusCode).toBe(400)
})
