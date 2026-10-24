import type { FastifyInstance } from 'fastify'
import { harnessParamsSchema, projectSubagents, subagentPublicationSchema } from '../shared/subagents.js'
import type { WorkspaceService } from './service.js'

/** Authenticated ingestion only. No orchestration or harness callbacks. */
export function subagentRoutes(app: FastifyInstance, service: WorkspaceService) {
  const path = '/api/conversations/:id/harnesses/:harnessId/subagents'
  app.get(path, async (request) => {
    const { id, harnessId } = harnessParamsSchema.parse(request.params)
    const conversation = service.conversation(id)
    return conversation.subagents?.find((item) => item.harnessId === harnessId) || null
  })
  app.post(path, async (request) => {
    const { id, harnessId } = harnessParamsSchema.parse(request.params)
    const publication = subagentPublicationSchema.parse(request.body)
    const result = await service.store.update((db) => {
      const conversation = db.conversations.find((item) => item.id === id)
      if (!conversation) throw Object.assign(new Error('Conversation not found.'), { statusCode: 404 })
      const projections = conversation.subagents || []
      const current = projections.find((item) => item.harnessId === harnessId)
      if (!current && projections.length >= 10)
        throw Object.assign(new Error('Maximum 10 harnesses per conversation.'), { statusCode: 409 })
      const next = projectSubagents(current, harnessId, publication, new Date().toISOString())
      if (next === current) return { applied: false, revision: current.revision }
      conversation.subagents = [...projections.filter((item) => item.harnessId !== harnessId), next]
      return { applied: true, revision: next.revision }
    })
    if (result.applied) service.changed()
    return result
  })
}
