import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { selectedLinePatch } from '../src/shared/git-patch.ts'

// Runs with Node's built-in TypeScript stripping; no package installation required.
for (const scenario of [
  { base: 'base\nend\n', next: 'base\nfirst\nsecond\nend\n', select: '+first', expected: 'base\nfirst\nend\n' },
  { base: 'base\nfirst\nsecond\nend\n', next: 'base\nend\n', select: '-first', expected: 'base\nsecond\nend\n' },
  { base: 'before\nold\nafter\n', next: 'before\nnew\nafter\n', select: '+new', expected: 'before\nold\nnew\nafter\n' },
]) {
  test(`selected lines: ${scenario.select}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'alfred-patch-test-'))
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      git('init', '-b', 'main')
      git('config', 'core.hooksPath', join(root, 'no-hooks'))
      const file = join(root, 'file.txt')
      writeFileSync(file, scenario.base)
      git('add', 'file.txt')
      git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'base')
      writeFileSync(file, scenario.next)
      const snapshot = git('diff', '--no-ext-diff', '--no-textconv', '--no-color', '--', 'file.txt')
      const patchFile = join(root, 'selected.patch')
      const selected = snapshot.split('\n').indexOf(scenario.select)
      writeFileSync(patchFile, selectedLinePatch(snapshot, 0, [selected], false))
      git('apply', '--cached', '--whitespace=nowarn', patchFile)
      assert.equal(git('show', ':file.txt'), scenario.expected)
      assert.equal(readFileSync(file, 'utf8'), scenario.next)
      const staged = git('diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-color')
      const reverseLine = staged.split('\n').indexOf(scenario.select)
      writeFileSync(patchFile, selectedLinePatch(staged, 0, [reverseLine], true))
      git('apply', '--cached', '--whitespace=nowarn', patchFile)
      assert.equal(git('diff', '--cached'), '')
      assert.equal(readFileSync(file, 'utf8'), scenario.next)
      assert.throws(() => selectedLinePatch(snapshot, 0, [selected, selected], false))
      assert.throws(() => selectedLinePatch(snapshot, 10, [selected], false))
      assert.throws(() => selectedLinePatch(snapshot, 0, [0], false))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
