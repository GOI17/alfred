import { afterEach, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { createHmac } from 'node:crypto'
import { authentication } from '../src/server/auth.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) await close()
})
async function setup() {
  const app = Fastify()
  cleanup.push(() => app.close())
  await authentication(app, 'synthetic-session-code')
  app.get('/api/protected', async () => ({ ok: true }))
  const login = async (cookie?: string) => {
    const response = await app.inject({
      method: 'POST', url: '/api/auth',
      headers: cookie ? { cookie } : {},
      payload: { code: 'synthetic-session-code' },
    })
    expect(response.statusCode).toBe(200)
    return response.cookies.map((item) => `${item.name}=${item.value}`).join('; ')
  }
  const status = async (cookie: string) =>
    (await app.inject({ url: '/api/protected', headers: { cookie } })).statusCode
  return { app, login, status }
}

it('revokes logout cookies without revoking another device', async () => {
  const { app, login, status } = await setup()
  const first = await login()
  const second = await login()
  expect(first).not.toBe(second)
  expect(await status(first)).toBe(200)
  expect((await app.inject({ method: 'DELETE', url: '/api/auth', headers: { cookie: first } })).statusCode).toBe(200)
  expect(await status(first)).toBe(401)
  expect(await status(second)).toBe(200)
})

it('enforces expiration on the server, even when a client replays the cookie', async () => {
  const { login, status } = await setup()
  const start = Date.now()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(start)
  const cookie = await login()
  expect(await status(cookie)).toBe(200)
  clock.mockReturnValue(start + 30 * 24 * 60 * 60 * 1000)
  expect(await status(cookie)).toBe(401)
})

it('rotates the current session on authentication', async () => {
  const { login, status } = await setup()
  const old = await login()
  const current = await login(old)
  expect(await status(old)).toBe(401)
  expect(await status(current)).toBe(200)
})

it('rejects legacy deterministic cookies and cookies from another server instance', async () => {
  const first = await setup()
  const cookie = await first.login()
  const second = await setup()
  expect(await second.status(cookie)).toBe(401)
  const legacy = createHmac('sha256', 'synthetic-session-code').update('alfred-session-v1').digest('hex')
  expect(await second.status(`alfred_session=${legacy}`)).toBe(401)
})
