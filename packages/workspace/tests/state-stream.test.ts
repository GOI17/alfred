import { expect, test } from 'vitest'
import { applyStateDelta, stateDelta } from '../src/shared/state-delta.js'
import { StateStream } from '../src/server/state-stream.js'

const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value))
test('patches streaming text without replacing unrelated messages or conversations', () => {
  const before = { conversations: [{ messages: [{ text: 'a'.repeat(2000) }, { text: 'other' }] }, { messages: [] }] }
  const after = wire(before)
  after.conversations[0].messages[0].text += ' next'
  const delta = wire(stateDelta(before, after)!)
  const result = applyStateDelta(before, delta)
  expect(result).toEqual(after)
  expect(result.conversations[1]).toBe(before.conversations[1])
  expect(result.conversations[0].messages[1]).toBe(before.conversations[0].messages[1])
  expect(JSON.stringify(delta).length).toBeLessThan(300)
  expect(before.conversations[0].messages[0].text).toHaveLength(2000)
})
test.each([
  [{ a: 1, b: true }, { b: false, c: null }],
  [[{ id: 1 }], [{ id: 1 }, { id: 2 }]],
  [[1, 2, 3], [3]],
  [{ value: {} }, { value: [] }],
  [{ text: 'x'.repeat(50) }, { text: 'replacement' }],
  [null, { a: 1 }],
])('round trips structural changes %#', (before, after) => {
  expect(applyStateDelta(before, wire(stateDelta(before, after)!))).toEqual(after)
})
test('unchanged wire values produce no patch', () => {
  expect(stateDelta({ a: [1, 2] }, { a: [1, 2] })).toBeUndefined()
})
test('special property names do not mutate prototypes', () => {
  const after = JSON.parse('{"__proto__":{"injected":true}}')
  const result = applyStateDelta({}, wire(stateDelta({}, after)!))
  expect(result).toEqual(after)
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
})
test('serializes once per invalidation and recovers lagging clients with snapshots', () => {
  let reads = 0
  const state = { text: 'x'.repeat(2000) }
  const stream = new StateStream(() => { reads++; return state })
  const initial = stream.frame()
  expect(initial.data).toContain('event: state')
  stream.frame()
  expect(reads).toBe(1)
  state.text += ' token'
  stream.invalidate()
  const update = stream.frame(initial.revision)
  expect(update.data).toContain('event: patch')
  expect(stream.frame(initial.revision)).toEqual(update)
  expect(reads).toBe(2)
  state.text += ' another'
  stream.invalidate()
  expect(stream.frame(initial.revision).data).toContain('event: state')
  expect(stream.frame().data).toContain('event: state')
})
