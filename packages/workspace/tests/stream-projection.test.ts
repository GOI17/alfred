import { expect, test } from 'vitest'
import { StreamProjection } from '../src/server/stream-projection.js'
import { conversationSchema } from '../src/shared/contracts.js'
import { randomUUID } from 'node:crypto'

function fixture() {
  return conversationSchema.parse({ id: randomUUID(), projectId: randomUUID(), workspacePath: '/synthetic', title: 'Test', createdAt: new Date().toISOString(), layout: { type: 'pane', id: randomUUID(), kind: 'chat' },
    messages: [{ id: randomUUID(), role: 'assistant', text: 'stored', notes: [], createdAt: new Date().toISOString() }] })
}
test('idle projections retain the array; unknown and removed conversations do not leak', () => {
  const projection = new StreamProjection(), source = [fixture()]
  expect(projection.conversations(source, {})).toBe(source)
  expect(projection.conversations(source, { missing: source[0].messages[0] })).toBe(source)
  const empty: typeof source = []
  expect(projection.conversations(empty, { [source[0].id]: source[0].messages[0] })).toBe(empty)
})
test('mutable partials are detached and cached histories invalidate on persistence', () => {
  const projection = new StreamProjection(), source = [fixture(), fixture()]
  const partial = { ...source[0].messages[0], text: 'stream', notes: ['first'] }
  const first = projection.conversations(source, { [source[0].id]: partial })
  partial.text += ' next'; partial.notes.push('second')
  const second = projection.conversations(source, { [source[0].id]: partial })
  expect(first[0].messages[0]).toMatchObject({ text: 'stream', notes: ['first'] })
  expect(second[0].messages).toHaveLength(1)
  expect(second[0].messages[0].text).toBe('stream next')
  expect(second[1]).toBe(source[1])
  const added = { ...partial, id: randomUUID(), text: 'new persisted' }
  const updated = [{ ...source[0], messages: [...source[0].messages, added] }, source[1]]
  const third = projection.conversations(updated, { [source[0].id]: partial })
  expect(third[0].messages).toEqual([added, partial])
  expect(projection.conversations(updated, {})).toBe(updated)
})
test('indexes survive reordering and simultaneous partials', () => {
  const projection = new StreamProjection(), source = [fixture(), fixture()]
  const partials = Object.fromEntries(source.map(item => [item.id, { ...item.messages[0], text: item.id }]))
  projection.conversations(source, partials)
  const result = projection.conversations([...source].reverse(), partials)
  expect(result.map(item => item.messages[0].text)).toEqual(source.map(item => item.id).reverse())
})
