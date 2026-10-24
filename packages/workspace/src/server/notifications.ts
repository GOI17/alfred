import webpush from 'web-push'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { WorkspaceService } from './service.js'

// Restrict destinations: subscriptions must never become an arbitrary server-side POST proxy.
export function allowedPushEndpoint(value: string) {
  let url: URL
  try { url = new URL(value) } catch { return false }
  return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
    (['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(url.hostname) ||
      url.hostname.endsWith('.push.apple.com') || url.hostname.endsWith('.notify.windows.com'))
}
const subscriptionSchema = z.object({
  endpoint: z.string().url().max(4096).refine(allowedPushEndpoint),
  keys: z.object({ p256dh: z.string().regex(/^[\w-]+={0,2}$/).min(80).max(100), auth: z.string().regex(/^[\w-]+={0,2}$/).min(20).max(30) }),
})
export type ChatNotice = 'completed' | 'error' | 'approval'
export async function notificationRoutes(app: FastifyInstance, service: WorkspaceService) {
  if (!service.store.get().pushKeys) {
    const keys = webpush.generateVAPIDKeys()
    await service.store.update((db) => { db.pushKeys = service.vault.encrypt(JSON.stringify(keys)) })
  }
  const keys = JSON.parse(service.vault.decrypt(service.store.get().pushKeys!)) as { publicKey: string; privateKey: string }
  const subject = process.env.ALFRED_PUSH_SUBJECT || 'mailto:admin@example.com'
  const hash = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex')
  app.get('/api/notifications', async () => ({ publicKey: keys.publicKey }))
  app.post('/api/notifications', async (request) => {
    const subscription = subscriptionSchema.parse(request.body)
    const id = hash(subscription.endpoint)
    await service.store.update((db) => {
      const entries = db.pushSubscriptions ||= []
      const existing = entries.find((item) => item.id === id)
      const encrypted = service.vault.encrypt(JSON.stringify(subscription))
      if (existing) existing.encrypted = encrypted
      else {
        if (entries.length >= 100) throw new Error('Too many notification devices.')
        entries.push({ id, encrypted })
      }
    })
    return { ok: true }
  })
  app.delete('/api/notifications', async (request) => {
    const { endpoint } = z.object({ endpoint: z.string().max(4096) }).parse(request.body)
    await service.store.update((db) => { db.pushSubscriptions = db.pushSubscriptions?.filter((item) => item.id !== hash(endpoint)) })
    return { ok: true }
  })
  let closed = false
  const pending = new Set<Promise<void>>()
  service.chat.notice = (conversationId, kind) => {
    if (closed) return
    const send = async () => {
      for (const item of service.store.get().pushSubscriptions || []) {
        if (closed) break
        try {
          const subscription = subscriptionSchema.parse(JSON.parse(service.vault.decrypt(item.encrypted)))
          await webpush.sendNotification(subscription, JSON.stringify({ conversationId, kind }), {
            TTL: 600, urgency: kind === 'approval' ? 'high' : 'normal', timeout: 10000,
            vapidDetails: { subject, ...keys },
          })
        } catch (error) {
          const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined
          if (status === 404 || status === 410) {
            await service.store.update((db) => { db.pushSubscriptions = db.pushSubscriptions?.filter((entry) => entry.id !== item.id) })
          } else app.log.warn('Web Push delivery failed; no automatic retry.')
        }
      }
    }
    // Delivery failures never fail or repeat an agent operation.
    const task = send().catch(() => { app.log.warn('Could not update push subscriptions.') })
    pending.add(task)
    void task.finally(() => pending.delete(task))
  }
  app.addHook('onClose', async () => {
    closed = true
    service.chat.notice = undefined
    await Promise.all(pending)
  })
}
