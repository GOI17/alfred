import { timingSafeEqual, randomBytes, createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { z } from 'zod'

function matches(left: string, right: string) {
  const a = Buffer.from(left),
    b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
const lifetime = 60 * 60 * 24 * 30
const sessionKey = (value: string) => createHash('sha256').update(value).digest('hex')

export async function authentication(app: FastifyInstance, token: string, publicOrigin?: string) {
  if (!token.trim()) throw new Error('A non-empty server access code is required.')
  await app.register(cookie)
  await app.register(rateLimit, { global: false })
  // Store only hashes of independent, revocable bearer tokens. Restarting the
  // server deliberately requires devices to authenticate again.
  const sessions = new Map<string, number>()
  const pairingCodes = new Map<string, number>()
  const prune = () => {
    const now = Date.now()
    for (const [key, expires] of sessions) if (expires <= now) sessions.delete(key)
  }
  app.addHook('onClose', async () => { sessions.clear(); pairingCodes.clear() })
  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY')
    if (!request.url.startsWith('/api/')) return
    reply.header('Cache-Control', 'no-store')
    const origin = request.headers.origin
    const remote = publicOrigin && request.headers.host === new URL(publicOrigin).host
    const expected = remote ? publicOrigin : `${request.protocol}://${request.headers.host}`
    // Fetch Metadata also covers cross-site browser requests that omit Origin.
    if (request.headers['sec-fetch-site'] === 'cross-site' ||
        (origin && origin !== expected) || (request.headers.upgrade && !origin))
      return reply.code(403).send({ error: 'Origin not allowed.' })
    if (request.method === 'POST' && request.url.split('?')[0] === '/api/auth') return
    const value = request.cookies.alfred_session || ''
    const key = sessionKey(value)
    const expires = sessions.get(key)
    if (!expires || expires <= Date.now()) {
      sessions.delete(key)
      return reply.code(401).send({ error: 'Connect this device using the server code.' })
    }
  })
  // Authenticated devices can issue a short-lived, single-use pairing code.
  app.post('/api/connection/pairing', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (_request, reply) => {
    if (!publicOrigin) return reply.code(409).send({ error: 'Public access is not configured.' })
    for (const [key, expires] of pairingCodes) if (expires <= Date.now()) pairingCodes.delete(key)
    if (pairingCodes.size >= 100) return reply.code(429).send({ error: 'Too many pending pairing codes.' })
    const code = randomBytes(32).toString('hex')
    const expiresAt = Date.now() + 5 * 60 * 1000
    pairingCodes.set(sessionKey(code), expiresAt)
    const url = new URL(publicOrigin)
    url.hash = new URLSearchParams({ connectionCode: code }).toString()
    return { url: url.toString(), expiresAt }
  })
  app.post(
    '/api/auth',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { code } = z.object({ code: z.string().max(200) }).parse(request.body)
      const pairingKey = sessionKey(code)
      const pairingExpiry = pairingCodes.get(pairingKey)
      const paired = pairingExpiry !== undefined && pairingExpiry > Date.now()
      if (!matches(code, token) && !paired) return reply.code(401).send({ error: 'Incorrect or expired code.' })
      prune()
      const previous = request.cookies.alfred_session
      if (previous) sessions.delete(sessionKey(previous))
      // Bound memory without silently revoking other active devices.
      if (sessions.size >= 1000)
        return reply.code(429).send({ error: 'Too many active sessions. Sign out on another device.' })
      if (paired) pairingCodes.delete(pairingKey)
      const session = randomBytes(32).toString('hex')
      sessions.set(sessionKey(session), Date.now() + lifetime * 1000)
      reply.setCookie('alfred_session', session, {
        httpOnly: true,
        sameSite: 'strict',
        secure: request.protocol === 'https' || Boolean(publicOrigin && request.headers.host === new URL(publicOrigin).host),
        path: '/',
        maxAge: lifetime,
      })
      return { ok: true }
    },
  )
  app.delete('/api/auth', async (request, reply) => {
    sessions.delete(sessionKey(request.cookies.alfred_session || ''))
    reply.clearCookie('alfred_session', { path: '/' })
    return { ok: true }
  })
}
