import { z } from 'zod'

const identifier = z.string().trim().min(1).max(128)
export const subagentSchema = z.object({
  id: identifier,
  parentId: identifier.optional(),
  name: z.string().trim().min(1).max(200),
  task: z.string().max(4000),
  // Status is reported by the harness; Workspace never drives transitions.
  status: z.string().trim().min(1).max(100),
  activity: z.array(z.object({
    id: identifier,
    kind: z.enum(['message', 'tool', 'result']),
    text: z.string().max(8000),
    tool: z.string().max(200).optional(),
    timestamp: z.string().datetime().optional(),
  })).max(100).default([]),
  result: z.string().max(16000).optional(),
}).strict()
export type Subagent = z.infer<typeof subagentSchema>
export const harnessProjectionSchema = z.object({
  harnessId: identifier,
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  receivedAt: z.string().datetime(),
  agents: z.array(subagentSchema).max(100),
})
export type HarnessProjection = z.infer<typeof harnessProjectionSchema>
export const subagentPublicationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('snapshot'),
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    agents: z.array(subagentSchema).max(100),
  }).strict(),
  z.object({
    type: z.literal('delta'),
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    upsert: z.array(subagentSchema).max(100).default([]),
    remove: z.array(identifier).max(100).default([]),
  }).strict(),
])
export type SubagentPublication = z.infer<typeof subagentPublicationSchema>
export const harnessParamsSchema = z.object({ id: z.string().uuid(), harnessId: identifier })

function conflict(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 409 })
}

/** Pure projection reducer, not an agent lifecycle manager. */
export function projectSubagents(
  current: HarnessProjection | undefined,
  harnessId: string,
  publication: SubagentPublication,
  receivedAt: string,
): HarnessProjection {
  if (current && publication.revision <= current.revision) return current
  if (publication.type === 'delta' && (!current || publication.revision !== current.revision + 1))
    conflict('Missing revision. Publish a snapshot to resynchronize.')
  const updates = publication.type === 'snapshot' ? publication.agents : publication.upsert
  if (new Set(updates.map((agent) => agent.id)).size !== updates.length)
    conflict('Duplicate subagent identifiers.')
  if (publication.type === 'delta' && publication.upsert.some((agent) => publication.remove.includes(agent.id)))
    conflict('An identifier cannot be both upserted and removed.')
  const agents = publication.type === 'snapshot' ? updates : [
    ...(current?.agents || []).filter((agent) => !publication.remove.includes(agent.id) && !updates.some((update) => update.id === agent.id)),
    ...updates,
  ]
  if (agents.length > 100) conflict('Maximum 100 subagents per harness.')
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  for (const agent of agents) {
    if (new Set(agent.activity.map((entry) => entry.id)).size !== agent.activity.length)
      conflict('Duplicate activity identifiers.')
    const seen = new Set([agent.id])
    let parent = agent.parentId
    while (parent !== undefined) {
      if (seen.has(parent)) conflict('Cyclic subagent hierarchy.')
      const ancestor = byId.get(parent)
      if (!ancestor) conflict('Parent not found in this harness projection.')
      seen.add(parent)
      parent = ancestor.parentId
    }
  }
  const next = { harnessId, revision: publication.revision, receivedAt, agents }
  if (JSON.stringify(next).length > 200_000) conflict('Harness projection exceeds 200000 characters.')
  return next
}
