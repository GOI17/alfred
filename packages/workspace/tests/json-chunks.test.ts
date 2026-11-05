import { expect, test } from 'vitest'
import { jsonChunks } from '../src/server/json-chunks.js'

test.each([
  null, true, 42, 'quote" slash\\ unicode 🐱\n', [], {},
  { optional: undefined, array: [null, undefined, {}, [], 'á'], nested: { a: 1 } },
  { messages: Array.from({ length: 1000 }, (_, id) => ({ id, text: 'test'.repeat(50) })) },
])('checkpoint chunks match JSON serialization %#', value => {
  expect([...jsonChunks(value, 256)].join('')).toBe(JSON.stringify(value))
})
test('large snapshots yield between bounded batches rather than one global string', () => {
  const chunks = [...jsonChunks(Array.from({ length: 10000 }, () => ({ text: 'x'.repeat(100) })), 1024)]
  expect(chunks.length).toBeGreaterThan(100)
  expect(Math.max(...chunks.map(chunk => chunk.length))).toBeLessThan(1200)
})
