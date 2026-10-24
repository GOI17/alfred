import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import webpush from 'web-push'
import { createApp } from '../src/server/app.js'
import { allowedPushEndpoint } from '../src/server/notifications.js'
import { worker } from '../src/server/pwa.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
  vi.restoreAllMocks()
})
it('restricts push delivery to known HTTPS push services', () => {
  for (const url of ['https://fcm.googleapis.com/fcm/send/test', 'https://web.push.apple.com/test', 'https://updates.push.services.mozilla.com/wpush/v2/test']) expect(allowedPushEndpoint(url)).toBe(true)
  for (const url of ['invalid', 'http://fcm.googleapis.com/test', 'https://localhost/test', 'https://fcm.googleapis.com.evil.test/', 'https://user@fcm.googleapis.com/', 'https://fcm.googleapis.com:8443/']) expect(allowedPushEndpoint(url)).toBe(false)
})
it('authenticates subscriptions, sends private alerts, and removes expired subscriptions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'alfred-push-test-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const { app, service } = await createApp({ directory: root, token: 'test-code', serve: false })
  cleanup.push(() => app.close())
  expect((await app.inject('/api/notifications')).statusCode).toBe(401)
  const auth = await app.inject({ method: 'POST', url: '/api/auth', payload: { code: 'test-code' } })
  const headers = { cookie: auth.cookies.map((item) => `${item.name}=${item.value}`).join('; ') }
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) } }
  const send = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({ statusCode: 201, body: '', headers: {} })
  expect((await app.inject({ method: 'POST', url: '/api/notifications', headers, payload: subscription })).statusCode).toBe(200)
  await app.inject({ method: 'POST', url: '/api/notifications', headers, payload: subscription })
  expect(service.store.get().pushSubscriptions).toHaveLength(1)
  expect(JSON.stringify(service.store.get())).not.toContain(subscription.endpoint)
  expect(JSON.stringify(service.state())).not.toContain('pushKeys')
  for (const kind of ['completed', 'error', 'approval'] as const) {
    service.chat.notice?.('test-conversation', kind)
    await expect.poll(() => send.mock.calls.length).toBe(['completed', 'error', 'approval'].indexOf(kind) + 1)
    expect(JSON.parse(send.mock.calls.at(-1)![1] as string)).toEqual({ conversationId: 'test-conversation', kind })
  }
  send.mockRejectedValue({ statusCode: 410 })
  service.chat.notice?.('test-conversation', 'completed')
  await expect.poll(() => service.store.get().pushSubscriptions?.length).toBe(0)
  expect((await app.inject('/manifest.webmanifest')).json().display).toBe('standalone')
  expect((await app.inject('/sw.js')).body).toBe(worker)
  expect((await app.inject({ method: 'POST', url: '/api/notifications', headers, payload: { ...subscription, endpoint: 'https://localhost/private' } })).statusCode).toBe(400)
  await app.inject({ method: 'POST', url: '/api/notifications', headers, payload: subscription })
  expect((await app.inject({ method: 'DELETE', url: '/api/notifications', headers, payload: { endpoint: subscription.endpoint } })).statusCode).toBe(200)
  expect(service.store.get().pushSubscriptions).toHaveLength(0)
})
