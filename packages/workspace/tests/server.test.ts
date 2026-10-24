import { afterEach, expect, it, vi } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'
import { createApp } from '../src/server/app.js'
import { gitFixture } from './fixtures.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})
async function setup(pickFolder?: (signal: AbortSignal) => Promise<string | null>) {
  const files = await gitFixture()
  cleanup.push(() => rm(files.root, { recursive: true, force: true }))
  const server = await createApp({
    directory: join(files.root, 'data'),
    token: 'test-access-code',
    serve: false,
    pickFolder,
  })
  cleanup.push(() => server.app.close())
  const address = await server.app.listen({ port: 0, host: '127.0.0.1' })
  const auth = await server.app.inject({
    method: 'POST',
    url: '/api/auth',
    payload: { code: 'test-access-code' },
  })
  const cookie = auth.cookies.map((item) => `${item.name}=${item.value}`).join('; ')
  return { ...files, ...server, address, cookie }
}
it('requires authentication, checks origins, and never returns provider secrets', async () => {
  const { app, cookie, root } = await setup()
  expect((await app.inject('/api/state')).statusCode).toBe(401)
  expect(
    (await app.inject({ method: 'POST', url: '/api/auth', payload: { code: 'wrong' } })).statusCode,
  ).toBe(401)
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: { cookie, origin: 'https://untrusted.example' },
        payload: { path: root },
      })
    ).statusCode,
  ).toBe(403)
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/providers/openai',
        headers: { cookie },
        payload: { apiKey: 'test-provider-secret', model: 'test-model' },
      })
    ).statusCode,
  ).toBe(200)
  const state = await app.inject({ url: '/api/state', headers: { cookie } })
  expect(state.body).toContain('test-model')
  expect(state.body).not.toContain('test-provider-secret')
  expect(state.body).not.toContain('encryptedKey')
  expect(await readFile(join(root, 'data', 'workspace.json'), 'utf8')).not.toContain(
    'test-provider-secret',
  )
})
it('derives project names without accepting files', async () => {
  const { app, cookie, root, repository } = await setup()
  const folder = join(root, 'My folder')
  await mkdir(folder)
  const file = join(folder, 'document.txt')
  await writeFile(file, 'not a project')
  for (const path of [file, join(root, 'missing')]) {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/projects',
          headers: { cookie },
          payload: { path },
        })
      ).statusCode,
    ).toBe(400)
  }
  const added = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: { cookie },
    payload: { path: folder, name: 'Manual name' },
  })
  expect(added.statusCode).toBe(200)
  expect(added.json().name).toBe('My folder')
  const nested = join(repository, 'src')
  await mkdir(nested)
  const project = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: { cookie },
    payload: { path: nested },
  })
  expect(project.json()).toMatchObject({
    name: 'project with spaces',
    path: repository,
    kind: 'git',
  })
})
it('opens the native picker only for authenticated local requests and handles cancellation', async () => {
  const pick = vi.fn<(signal: AbortSignal) => Promise<string | null>>()
  const { app, cookie, repository, service } = await setup(pick)
  pick.mockResolvedValue(repository)
  const request = { method: 'POST' as const, url: '/api/projects/pick' }
  expect((await app.inject(request)).statusCode).toBe(401)
  expect(
    (await app.inject({ ...request, headers: { cookie, origin: 'https://untrusted.example' } }))
      .statusCode,
  ).toBe(403)
  expect(
    (await app.inject({ ...request, headers: { cookie }, remoteAddress: '192.168.1.42' }))
      .statusCode,
  ).toBe(403)
  expect(pick).not.toHaveBeenCalled()
  const result = await app.inject({ ...request, headers: { cookie } })
  expect(result.statusCode).toBe(200)
  expect(result.json().project).toMatchObject({ path: repository, name: 'project with spaces' })
  pick.mockResolvedValue(null)
  expect((await app.inject({ ...request, headers: { cookie } })).json()).toEqual({ project: null })
  expect(service.state().projects).toHaveLength(1)
  pick.mockResolvedValue(join(repository, 'hello.txt'))
  expect((await app.inject({ ...request, headers: { cookie } })).statusCode).toBe(400)
  expect(service.state().projects).toHaveLength(1)
})
it('keeps one native picker per host and cancels it when the requesting browser disconnects', async () => {
  let signal: AbortSignal | undefined
  const pick = vi.fn<(signal: AbortSignal) => Promise<string | null>>().mockImplementation(
    (received) =>
      new Promise((_resolve, reject) => {
        signal = received
        received.addEventListener('abort', () => reject(received.reason), { once: true })
      }),
  )
  const { app, cookie, address, service } = await setup(pick)
  const controller = new AbortController()
  const pending = fetch(`${address}/api/projects/pick`, {
    method: 'POST',
    headers: { cookie },
    signal: controller.signal,
  }).catch(() => null)
  await expect.poll(() => pick.mock.calls.length).toBe(1)
  expect(
    (await app.inject({ method: 'POST', url: '/api/projects/pick', headers: { cookie } }))
      .statusCode,
  ).toBe(409)
  controller.abort()
  await pending
  await expect.poll(() => signal?.aborted).toBe(true)
  pick.mockResolvedValue(null)
  await expect
    .poll(
      async () =>
        (await app.inject({ method: 'POST', url: '/api/projects/pick', headers: { cookie } }))
          .statusCode,
    )
    .toBe(200)
  expect(service.state().projects).toHaveLength(0)
})
it('runs a real PTY and replays output after a client disconnects', async () => {
  const { service, repository, address, cookie } = await setup()
  const project = await service.addProject(repository)
  const conversation = await service.addConversation(project.id, repository)
  const paneId = randomUUID()
  await service.setLayout(conversation.id, {
    type: 'split',
    id: randomUUID(),
    direction: 'row',
    ratio: 0.5,
    children: [conversation.layout, { type: 'pane', id: paneId, kind: 'terminal' }],
  })
  const url = `${address.replace('http:', 'ws:')}/api/conversations/${conversation.id}/terminal/${paneId}`
  const socket = new WebSocket(url, { headers: { cookie, origin: address } })
  cleanup.push(async () => {
    socket.terminate()
  })
  let output = '',
    ready = false
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString())
    if (message.type === 'output') output += message.data
    if (message.type === 'ready') ready = true
    if (message.type === 'error') output += `ERROR:${message.message}`
  })
  await expect.poll(() => ready || output.includes('ERROR:')).toBe(true)
  expect(output).not.toContain('ERROR:')
  const command =
    process.platform === 'win32' ? 'echo ALFRED_%COMSPEC%\r' : "printf 'ALFRED_%s_DONE\\n' 'PTY'\r"
  socket.send(JSON.stringify({ type: 'input', data: command }))
  await expect
    .poll(() => output)
    .toContain(process.platform === 'win32' ? 'cmd.exe' : 'ALFRED_PTY_DONE')
  socket.close()
  const second = new WebSocket(url, { headers: { cookie, origin: address } })
  cleanup.push(async () => {
    second.terminate()
  })
  let replay = ''
  let exitCode: number | undefined
  second.on('message', (data) => {
    const message = JSON.parse(data.toString())
    if (message.type === 'output') replay += message.data
    if (message.type === 'exit') exitCode = message.code
  })
  await expect
    .poll(() => replay)
    .toContain(process.platform === 'win32' ? 'cmd.exe' : 'ALFRED_PTY_DONE')
  second.send(JSON.stringify({ type: 'input', data: 'exit 7\r' }))
  await expect.poll(() => exitCode).toBe(7)
  second.close()
  const third = new WebSocket(url, { headers: { cookie, origin: address } })
  cleanup.push(async () => {
    third.terminate()
  })
  let replayedExit: number | undefined
  third.on('message', (data) => {
    const message = JSON.parse(data.toString())
    if (message.type === 'exit') replayedExit = message.code
  })
  await expect.poll(() => replayedExit).toBe(7)
})
it('rejects websocket connections from another site', async () => {
  const { address, cookie } = await setup()
  const status = await new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(
      `${address.replace('http:', 'ws:')}/api/conversations/${randomUUID()}/terminal/${randomUUID()}`,
      { headers: { cookie, origin: 'https://untrusted.example' } },
    )
    socket.on('unexpected-response', (_request, response) => {
      resolve(response.statusCode || 0)
      response.resume()
      socket.terminate()
    })
    socket.on('error', reject)
  })
  expect(status).toBe(403)
})
