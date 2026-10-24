import { isAbsolute } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { WorkspaceService } from './service.js'
import { isLoopback } from './local-access.js'
import { pickNativeFolder } from './native-folder-picker.js'

export function projectSelection(
  app: FastifyInstance,
  service: WorkspaceService,
  pick: (signal: AbortSignal) => Promise<string | null> = pickNativeFolder,
) {
  let active: AbortController | undefined
  app.post('/api/projects/pick', async (request, reply) => {
    if (!isLoopback(request.ip))
      return reply.code(403).send({
        error:
          'Add projects from localhost on the computer running Alfred. The native picker opens there; you can use existing projects from this device.',
      })
    if (active)
      return reply.code(409).send({
        error:
          'A folder picker is already open. Select a folder or cancel in that dialog.',
      })
    const controller = new AbortController()
    active = controller
    const cancel = () => controller.abort()
    reply.raw.on('close', cancel)
    try {
      const path = await pick(controller.signal)
      controller.signal.throwIfAborted()
      if (path === null) return { project: null }
      if (!isAbsolute(path)) throw new Error('Select a valid system folder.')
      return { project: await service.addProject(path) }
    } finally {
      reply.raw.off('close', cancel)
      active = undefined
    }
  })
  app.addHook('onClose', async () => {
    active?.abort()
  })
}
