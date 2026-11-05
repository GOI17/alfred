import { afterEach, expect, it, vi } from 'vitest'
import { lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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


it('changes the current conversation folder locally, retaining history and identity', async () => {
  const { app, service, project, repository, root, headers } = await setup()
  const conversation = await service.addConversation(project.id, repository)
  const folder = join(repository, 'nested folder')
  await mkdir(folder)
  const url = `/api/conversations/${conversation.id}/messages`
  const send = (text: string) => app.inject({ method: 'POST', url, headers, payload: { text, provider: 'openai' } })
  expect((await send('/cd "nested folder"')).statusCode).toBe(200)
  expect(service.conversation(conversation.id).workspacePath).toBe(folder)
  expect(service.conversation(conversation.id).projectId).toBe(project.id)
  expect(service.conversation(conversation.id).messages).toHaveLength(1)
  expect((await send('/cd ..')).statusCode).toBe(200)
  expect(service.conversation(conversation.id).workspacePath).toBe(repository)
  const other = join(root, 'other folder')
  await mkdir(other)
  expect((await send(`/cd ${other}`)).statusCode).toBe(200)
  expect(service.conversation(conversation.id).workspacePath).toBe(other)
  expect(service.conversation(conversation.id).messages).toHaveLength(3)
  expect(service.state().conversations).toHaveLength(1)
  for (const text of ['/cd', '/cd missing', `/cd ${join(repository, 'hello.txt')}`]) {
    expect((await send(text)).statusCode).toBe(400)
    expect(service.conversation(conversation.id).workspacePath).toBe(other)
    expect(service.conversation(conversation.id).messages).toHaveLength(3)
  }
})


it('completes cd paths with directories only, relative to the current conversation', async () => {
  const { app, service, project, repository, headers } = await setup()
  const conversation = await service.addConversation(project.id, repository)
  await mkdir(join(repository, 'nested folder', 'child'), { recursive: true })
  const url = `/api/conversations/${conversation.id}/directories`
  expect((await app.inject(url)).statusCode).toBe(401)
  const suggest = async (query: string) => {
    const response = await app.inject({ url: `${url}?query=${encodeURIComponent(query)}`, headers })
    expect(response.statusCode, response.body).toBe(200)
    return response.json().files
  }
  expect(await suggest('nest')).toEqual(['nested folder/'])
  expect(await suggest('"nested folder/')).toEqual(['nested folder/child/'])
  expect(await suggest(join(repository, 'nest'))).toEqual([join(repository, 'nested folder') + '/'])
  expect(await suggest(`~/${relative(homedir(), repository)}/nest`)).toEqual([`~/${relative(homedir(), repository)}/nested folder/`])
  expect(await suggest('hello')).toEqual([])
  await service.changeDirectory(conversation.id, 'nested folder')
  expect(await suggest('')).toEqual(['child/'])
  expect(await suggest('../nest')).toEqual(['../nested folder/'])
  expect(service.conversation(conversation.id).messages).toHaveLength(1)
})


it('recovers an abandoned preparation lock without forcing deletion', async () => {
  const { app, headers, url, git } = await setup()
  const created = await app.inject({ method: 'POST', url, headers, payload: { branch: 'stale-lock' } })
  const { path } = created.json()
  await git('worktree', 'lock', '--reason', 'orca-create-preparation:v1:2147483647:2147483647-47c78fa4-ae97-41ab-927b-469f952280f5', path)
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('exited'), { code: 'ESRCH' }) })
  try {
    const removed = await app.inject({ method: 'DELETE', url, headers, payload: { path } })
    expect(removed.statusCode, removed.body).toBe(200)
    expect(kill).toHaveBeenCalledWith(2147483647, 0)
    await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await git('branch', '--list', 'stale-lock')).toContain('stale-lock')
  } finally { kill.mockRestore() }
})

it('preserves active and unknown locks and offers diagnostic errors', async () => {
  const { app, headers, url, git } = await setup()
  for (const [branch, reason] of [
    ['active-lock', `orca-create-preparation:v1:${process.pid}:${process.pid}-47c78fa4-ae97-41ab-927b-469f952280f5`],
    ['unknown-lock', 'user-owned lock'],
  ]) {
    const created = await app.inject({ method: 'POST', url, headers, payload: { branch } })
    const { path } = created.json()
    await git('worktree', 'lock', '--reason', reason, path)
    const removed = await app.inject({ method: 'DELETE', url, headers, payload: { path } })
    expect(removed.statusCode).toBe(400)
    expect(removed.json().error).toContain('No automatic changes made')
    expect((await app.inject({ url, headers })).json().find((tree: { path: string }) => tree.path === path).locked).toBe(true)
    expect(await readFile(join(path, 'hello.txt'), 'utf8')).toBe('hello\n')
  }
})

it('preserves modified and untracked files and conversations when removal fails', async () => {
  const { app, service, project, headers, url } = await setup()
  const created = await app.inject({ method: 'POST', url, headers, payload: { branch: 'dirty-tree' } })
  const { path } = created.json()
  const chat = await service.addConversation(project.id, path)
  await writeFile(join(path, 'hello.txt'), 'local changes')
  await writeFile(join(path, 'untracked.txt'), 'unsaved work')
  const removed = await app.inject({ method: 'DELETE', url, headers, payload: { path } })
  expect(removed.statusCode).toBe(400)
  expect(removed.json().error).toContain('modified or untracked')
  expect(await readFile(join(path, 'hello.txt'), 'utf8')).toBe('local changes')
  expect(await readFile(join(path, 'untracked.txt'), 'utf8')).toBe('unsaved work')
  expect(service.conversation(chat.id).workspacePath).toBe(path)
})
