import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { harnessSelectionSchema, resourceIdSchema } from '../shared/harnesses.js'
import type { WorkspaceService } from './service.js'
import type { HarnessRegistry } from './harness-runtime.js'

export function harnessRoutes(app: FastifyInstance, service: WorkspaceService, registry: HarnessRegistry) {
  const params = z.object({ id: z.string().uuid() })
  const scan = async (id: string, fresh = false) => registry.scan(await service.workspace(service.conversation(id)), fresh)
  app.get('/api/conversations/:id/harnesses', async (request) => {
    const { id } = params.parse(request.params)
    const { refresh } = z.object({ refresh: z.enum(['true', 'false']).optional() }).parse(request.query)
    return (await scan(id, refresh === 'true')).catalog
  })
  app.get('/api/conversations/:id/harnesses/resources/:resourceId', async (request) => {
    const { id, resourceId } = params.extend({ resourceId: resourceIdSchema }).parse(request.params)
    const entry = (await scan(id, true)).entries.get(resourceId)
    if (!entry) throw Object.assign(new Error('Resource no longer exists.'), { statusCode: 404 })
    return { resource: entry.public, content: entry.public.kind === 'mcp' ? entry.mcp?.summary || '' : entry.body }
  })
  app.put('/api/conversations/:id/harness', async (request) => {
    const { id } = params.parse(request.params)
    const { selection } = z.object({ selection: harnessSelectionSchema.nullable() }).parse(request.body)
    if (selection?.agent) {
      const entry = (await scan(id, true)).entries.get(selection.agent)
      if (!entry || entry.public.harness !== selection.id || entry.public.kind !== 'agent' || !entry.public.usable || entry.public.shadowedBy) throw new Error('Choose an available agent from this harness.')
    }
    await service.chat.setHarness(id, selection || undefined)
    return { ok: true }
  })
}
