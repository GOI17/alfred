import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { WorkspaceService } from './service.js'
import { isLoopback } from './local-access.js'
import { providerModels } from './provider-models.js'

export function chatgptRoutes(app: FastifyInstance, service: WorkspaceService) {
  providerModels(app, service)
  app.get('/api/chatgpt/availability', async (request) => ({ local: isLoopback(request.ip) }))
  app.post('/api/chatgpt/authorize', async (request) => {
    if (!isLoopback(request.ip))
      throw new Error(
        'Authorize ChatGPT from the browser on the computer running Alfred. You can then use it from this device.',
      )
    const { accountId } = z.object({ accountId: z.string().uuid().optional() }).parse(request.body)
    return service.chatgpt.start(accountId)
  })
  app.get('/api/chatgpt/models', async () => service.chatgpt.models())
  app.post('/api/chatgpt/select', async (request) => {
    const { accountId, model } = z
      .object({ accountId: z.string().uuid(), model: z.string().max(150).optional() })
      .parse(request.body)
    await service.chatgpt.select(accountId, model)
    return { ok: true }
  })
  app.post('/api/chatgpt/welcome', async (request) => {
    const { accountId } = z.object({ accountId: z.string().uuid() }).parse(request.body)
    await service.chatgpt.welcome(accountId)
    return { ok: true }
  })
  app.post('/api/chatgpt/disconnect', async (request) => {
    const { accountId } = z.object({ accountId: z.string().uuid() }).parse(request.body)
    await service.chat.stopProvider('chatgpt')
    return service.chatgpt.disconnect(accountId)
  })
}
