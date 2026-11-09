import type { FastifyInstance } from 'fastify'
import { relative, sep } from 'node:path'
import { z } from 'zod'
import type { WorkspaceService } from './service.js'
import { ExternalFiles } from './external-files.js'
import { isLoopback } from './local-access.js'
import { pickNativeFolder } from './native-folder-picker.js'

export function externalFileRoutes(app: FastifyInstance, service: WorkspaceService, pick = pickNativeFolder) {
  const files = new ExternalFiles()
  if (service.adapter.legacyBindings) service.adapter.legacyBindings.readPath = (id, root, path) => files.readPath(id, root, path)
  const context = async (params: unknown) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(params)
    return { id, root: await service.workspace(service.conversation(id)) }
  }
  app.get('/api/conversations/:id/files', async (request, reply) => {
    const { id, root } = await context(request.params)
    const { query } = z.object({ query: z.string().max(4096).default('') }).parse(request.query)
    const controller = new AbortController()
    const abort = () => controller.abort()
    reply.raw.on('close', abort)
    reply.header('Cache-Control', 'no-store')
    try { return await files.search(id, root, query, controller.signal) }
    finally { reply.raw.off('close', abort) }
  })
  app.post('/api/conversations/:id/files/authorize', async request => {
    const { id, root } = await context(request.params)
    const { folder, confirmed } = z.object({ folder: z.string().min(1).max(4096), confirmed: z.literal(true) }).parse(request.body)
    if (confirmed) await files.authorize(id, root, folder)
    return { ok: true }
  })
  app.delete('/api/conversations/:id/files/authorize', async request => {
    const { id, root } = await context(request.params)
    const { folder } = z.object({ folder: z.string().min(1).max(4096) }).parse(request.body)
    files.revoke(id, root, folder)
    return { ok: true }
  })
  let picker: AbortController | undefined
  app.post('/api/conversations/:id/files/pick', async (request, reply) => {
    if (!isLoopback(request.ip)) return reply.code(403).send({ error: 'Choose folders on the computer running Alfred.' })
    const { root } = await context(request.params)
    if (picker) return reply.code(409).send({ error: 'A folder picker is already open.' })
    const controller = new AbortController()
    picker = controller
    const abort = () => controller.abort()
    reply.raw.on('close', abort)
    try {
      const folder = await pick(controller.signal)
      controller.signal.throwIfAborted()
      // Selection alone does not grant access. The popup still asks for confirmation.
      return { folder, query: folder ? relative(root, folder).split(sep).join('/') + '/' : null }
    } finally { reply.raw.off('close', abort); picker = undefined }
  })
  app.addHook('onClose', async () => { picker?.abort() })
  app.addHook('onResponse', async request => {
    if (request.method === 'DELETE' && request.routeOptions.url === '/api/conversations/:id') {
      const { id } = z.object({ id: z.string() }).parse(request.params)
      files.clear(id)
    }
  })
}
