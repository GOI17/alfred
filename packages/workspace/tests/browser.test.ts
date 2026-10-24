import { afterEach, expect, it } from 'vitest'
import { createServer as httpServer } from 'node:http'
import { createServer as httpsServer } from 'node:https'
import { generate } from 'selfsigned'
import { WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import { createApp } from '../src/server/app.js'
import { browserUrl } from '../src/server/browsers.js'
import { gitFixture } from './fixtures.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})
it('normalizes local URLs and rejects file access and credential-bearing URLs', () => {
  expect(browserUrl('localhost:3000')).toBe('http://localhost:3000/')
  expect(browserUrl('example.com')).toBe('https://example.com/')
  expect(() => browserUrl('file:///etc/passwd')).toThrow()
  expect(() => browserUrl('https://user:password@example.com')).toThrow()
})
it('renders HTTP and self-signed HTTPS pages using a real headless browser', async () => {
  const files = await gitFixture()
  cleanup.push(() => rm(files.root, { recursive: true, force: true }))
  const certificate = await generate([{ name: 'commonName', value: 'localhost' }], {
    keySize: 2048,
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }],
  })
  const pageHtml =
    '<!doctype html><title>Alfred browser test</title><h1>Local workspace</h1><form action="/submitted"><input name="idea" style="position:absolute;left:10px;top:90px"><button>Save idea</button></form>'
  const plain = httpServer((_request, reply) => {
    reply.setHeader('X-Frame-Options', 'DENY')
    reply.setHeader('Content-Type', 'text/html')
    reply.end(pageHtml)
  })
  const secure = httpsServer(
    { key: certificate.private, cert: certificate.cert },
    (_request, reply) => {
      reply.setHeader('Content-Type', 'text/html')
      reply.end(pageHtml)
    },
  )
  for (const server of [plain, secure]) {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanup.push(
      () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
          server.closeAllConnections()
        }),
    )
  }
  const plainAddress = plain.address(),
    secureAddress = secure.address()
  if (
    !plainAddress ||
    typeof plainAddress === 'string' ||
    !secureAddress ||
    typeof secureAddress === 'string'
  )
    throw new Error('No test server')
  const { app, service } = await createApp({
    directory: join(files.root, 'data'),
    token: 'browser-test',
    serve: false,
  })
  cleanup.push(() => app.close())
  const address = await app.listen({ host: '127.0.0.1', port: 0 })
  const auth = await app.inject({
    method: 'POST',
    url: '/api/auth',
    payload: { code: 'browser-test' },
  })
  const cookie = auth.cookies.map((item) => `${item.name}=${item.value}`).join('; ')
  const project = await service.addProject(files.repository)
  const conversation = await service.addConversation(project.id, files.repository)
  const paneId = randomUUID()
  await service.setLayout(conversation.id, {
    type: 'split',
    id: randomUUID(),
    direction: 'row',
    ratio: 0.5,
    children: [conversation.layout, { type: 'pane', id: paneId, kind: 'browser' }],
  })
  const socket = new WebSocket(
    `${address.replace('http:', 'ws:')}/api/conversations/${conversation.id}/browser/${paneId}`,
    { headers: { origin: address, cookie } },
  )
  cleanup.push(async () => socket.terminate())
  let ready = false,
    frames = 0,
    location = '',
    error = ''
  socket.on('message', (data, binary) => {
    if (binary) {
      frames++
      return
    }
    const message = JSON.parse(data.toString())
    if (message.type === 'ready') ready = true
    if (message.type === 'location') location = message.url
    if (message.type === 'error') error = message.message
  })
  await expect.poll(() => ready, { timeout: 10_000 }).toBe(true)
  socket.send(
    JSON.stringify({
      type: 'navigate',
      url: `http://127.0.0.1:${plainAddress.port}`,
      insecure: false,
    }),
  )
  await expect.poll(() => location).toBe(`http://127.0.0.1:${plainAddress.port}/`)
  await expect.poll(() => frames).toBeGreaterThan(0)
  socket.send(JSON.stringify({ type: 'click', x: 70, y: 100 }))
  socket.send(JSON.stringify({ type: 'text', text: 'From phone' }))
  socket.send(JSON.stringify({ type: 'key', key: 'Enter' }))
  await expect.poll(() => location, { timeout: 5000 }).toContain('/submitted?idea=From+phone')
  socket.send(
    JSON.stringify({
      type: 'navigate',
      url: `https://127.0.0.1:${secureAddress.port}`,
      insecure: false,
    }),
  )
  await expect.poll(() => error).toContain('CERT')
  socket.send(
    JSON.stringify({
      type: 'navigate',
      url: `https://127.0.0.1:${secureAddress.port}`,
      insecure: true,
    }),
  )
  await expect.poll(() => location).toBe(`https://127.0.0.1:${secureAddress.port}/`)
})
