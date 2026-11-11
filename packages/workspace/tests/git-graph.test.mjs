import { test } from 'node:test'
import assert from 'node:assert/strict'
import { graphRows } from '../src/shared/git-graph.ts'

test('linear history ends at the root', () => {
  const rows = graphRows([{ hash: 'b', parents: ['a'] }, { hash: 'a', parents: [] }])
  assert.deepEqual(rows.map(row => row.column), [0, 0])
  assert.deepEqual(rows[0].edges, [{ from: 0, to: 0 }])
  assert.deepEqual(rows[1].edges, [])
})
test('merge lanes split and converge at a common ancestor', () => {
  const rows = graphRows([
    { hash: 'merge', parents: ['left', 'right'] },
    { hash: 'left', parents: ['base'] },
    { hash: 'right', parents: ['base'] },
    { hash: 'base', parents: [] },
  ])
  assert.equal(rows[0].width, 2)
  assert.deepEqual(rows[0].edges, [{ from: 0, to: 0 }, { from: 0, to: 1 }])
  assert.deepEqual(rows[2].edges, [{ from: 0, to: 0 }, { from: 1, to: 0 }])
  assert.equal(rows[3].width, 1)
})
test('octopus merges, disconnected tips and page boundaries remain valid', () => {
  const rows = graphRows([
    { hash: 'merge', parents: ['a', 'b', 'c'] },
    { hash: 'other', parents: [] },
    { hash: 'c', parents: ['base'] },
  ])
  assert.equal(rows[0].width, 3)
  assert.equal(rows[1].column, 3)
  for (const row of rows) for (const edge of row.edges) {
    assert.ok(edge.from >= 0 && edge.from < row.width)
    assert.ok(edge.to >= 0 && edge.to < row.width)
  }
  assert.deepEqual(graphRows([]), [])
})
