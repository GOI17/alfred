import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { projectSubagents, subagentPublicationSchema, type Subagent } from '../src/shared/subagents'
import { SubagentsPanel } from '../src/renderer/src/subagents-panel'
import { createApp } from '../src/server/app'
import { Store } from '../src/server/store'
import { gitFixture } from './fixtures'

const agent: Subagent = { id: 'explorer', name: 'Explorer', task: 'Inspect files', status: 'custom-running', activity: [] }
const date = '2025-01-01T00:00:00.000Z'
const snapshot = (revision = 1, agents = [agent]) => ({ type: 'snapshot' as const, revision, agents })
const initial = () => projectSubagents(undefined, 'harness', snapshot(), date)

describe('subagent projection contract', () => {
  it('accepts arbitrary harness statuses and old conversations need no projection', () => {
    const parsed = subagentPublicationSchema.parse(snapshot())
    expect(parsed.type === 'snapshot' && parsed.agents[0].status).toBe('custom-running')
    expect(renderToStaticMarkup(createElement(SubagentsPanel))).toBe('')
  })
  it('deduplicates revisions and requires contiguous deltas but allows snapshot recovery', () => {
    const current = initial()
    expect(projectSubagents(current, 'harness', snapshot(), date)).toBe(current)
    expect(() => projectSubagents(current, 'harness', { type: 'delta', revision: 3, upsert: [], remove: [] }, date)).toThrow('Missing revision')
    expect(() => projectSubagents(undefined, 'harness', { type: 'delta', revision: 1, upsert: [], remove: [] }, date)).toThrow('Missing revision')
    const next = projectSubagents(current, 'harness', { type: 'delta', revision: 2, upsert: [{ ...agent, status: 'done' }], remove: [] }, date)
    expect(next.agents[0].status).toBe('done')
    expect(projectSubagents(next, 'harness', snapshot(8, []), date).agents).toEqual([])
  })
  it('validates hierarchy and identifiers atomically', () => {
    for (const agents of [[agent, agent], [{ ...agent, parentId: agent.id }], [{ ...agent, parentId: 'missing' }]]) {
      expect(() => projectSubagents(undefined, 'harness', snapshot(1, agents), date)).toThrow()
    }
    const current = projectSubagents(undefined, 'harness', snapshot(1, [agent, { ...agent, id: 'child', parentId: agent.id }]), date)
    expect(() => projectSubagents(current, 'harness', { type: 'delta', revision: 2, upsert: [], remove: [agent.id] }, date)).toThrow('Parent not found')
    expect(projectSubagents(current, 'harness', { type: 'delta', revision: 2, upsert: [], remove: [agent.id, 'child'] }, date).agents).toEqual([])
    expect(current.agents).toHaveLength(2)
  })
  it('renders hierarchy, tools and results safely without lifecycle controls', () => {
    const projection = projectSubagents(undefined, 'harness', snapshot(1, [agent, {
      ...agent, id: 'child', parentId: agent.id, name: 'Child', result: '<script>bad()</script>',
      activity: [{ id: 'event-1', kind: 'tool', tool: 'read_file', text: 'src/index.ts' }],
    }]), date)
    const html = renderToStaticMarkup(createElement(SubagentsPanel, { projections: [projection] }))
    for (const text of ['Explorer', 'Child', 'Parent', 'read_file', 'src/index.ts', 'custom-running', 'No recent updates', '&lt;script&gt;']) expect(html).toContain(text)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<button')
  })
})

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
it('authenticates publications, persists projections, isolates harnesses and emits state changes', async () => {
  const files = await gitFixture()
  cleanup.push(() => rm(files.root, { recursive: true, force: true }))
  const directory = join(files.root, 'data')
  const { app, service } = await createApp({ directory, token: 'test-code', serve: false })
  cleanup.push(() => app.close())
  const project = await service.addProject(files.repository)
  const conversation = await service.addConversation(project.id, files.repository)
  const path = `/api/conversations/${conversation.id}/harnesses/test/subagents`
  expect((await app.inject({ method: 'POST', url: path, payload: snapshot() })).statusCode).toBe(401)
  const auth = await app.inject({ method: 'POST', url: '/api/auth', payload: { code: 'test-code' } })
  const headers = { cookie: auth.cookies.map((c) => `${c.name}=${c.value}`).join('; ') }
  expect((await app.inject({ method: 'POST', url: path, headers: { ...headers, origin: 'https://evil.invalid' }, payload: snapshot() })).statusCode).toBe(403)
  const changed = vi.fn()
  service.events.on('change', changed)
  const publish = (payload: Record<string, unknown>, url = path) => app.inject({ method: 'POST', url, headers, payload })
  expect((await publish(snapshot())).json()).toEqual({ applied: true, revision: 1 })
  expect(changed).toHaveBeenCalledTimes(1)
  expect((await publish(snapshot())).json()).toEqual({ applied: false, revision: 1 })
  expect(changed).toHaveBeenCalledTimes(1)
  expect((await publish({ type: 'delta', revision: 3 })).statusCode).toBe(409)
  expect((await publish({ type: 'snapshot', revision: 2, agents: [{ id: 'bad' }] })).statusCode).toBe(400)
  expect((await publish(snapshot(), path.replace(conversation.id, randomUUID()))).statusCode).toBe(404)
  expect((await publish(snapshot(), path.replace('/test/', '/other/'))).statusCode).toBe(200)
  const state = (await app.inject({ url: '/api/state', headers })).json()
  expect(state.conversations[0].subagents).toHaveLength(2)
  expect((await app.inject({ url: path, headers })).json().agents).toEqual([agent])
  const reopened = await new Store(directory).open()
  expect(reopened.get().conversations[0].subagents).toEqual(state.conversations[0].subagents)
  expect((await publish({ type: 'delta', revision: 2, remove: ['explorer'] })).json()).toEqual({ applied: true, revision: 2 })
  expect(service.conversation(conversation.id).subagents?.find((p) => p.harnessId === 'other')?.agents).toEqual([agent])
})
