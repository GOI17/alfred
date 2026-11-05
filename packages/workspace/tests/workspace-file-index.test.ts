import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { invalidateWorkspaceFiles, listWorkspaceFiles } from '../src/server/workspace-files.js'
vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>() }))
let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'workspace-index-')) })
afterEach(async () => { await invalidateWorkspaceFiles(root); await rm(root, { recursive: true, force: true }) })
test('indexes beyond the initial result limit and searches case-insensitively', async () => {
  await Promise.all(Array.from({ length: 105 }, (_, n) => writeFile(join(root, `file-${n}.ts`), '')))
  await writeFile(join(root, 'ZZ-target.ts'), '')
  expect((await listWorkspaceFiles(root)).files).toHaveLength(100)
  expect(await listWorkspaceFiles(root, 'zz-TARGET')).toEqual({ files: ['ZZ-target.ts'], truncated: false })
})
test('excludes private directories and symbolic links', async () => {
  await mkdir(join(root, 'node_modules'))
  await writeFile(join(root, 'node_modules', 'hidden.ts'), '')
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'visible.ts'), '')
  await symlink(join(root, 'src'), join(root, 'alias'))
  expect((await listWorkspaceFiles(root)).files).toEqual(['src/visible.ts'])
})
test('reuses a bounded cache and supports explicit invalidation', async () => {
  await writeFile(join(root, 'first.ts'), '')
  await listWorkspaceFiles(root)
  await writeFile(join(root, 'second.ts'), '')
  expect((await listWorkspaceFiles(root, 'second')).files).toEqual([])
  await invalidateWorkspaceFiles(root)
  expect((await listWorkspaceFiles(root, 'second')).files).toEqual(['second.ts'])
})
test('honors cancellation even with a populated cache', async () => {
  await listWorkspaceFiles(root)
  const controller = new AbortController()
  controller.abort()
  await expect(listWorkspaceFiles(root, '', controller.signal)).rejects.toThrow()
})


test('concurrent searches share traversal and one canceled reader cannot cancel another', async () => {
  // Hold traversal until cancellation has been observed (no timer race).
  const fs = await import('node:fs/promises')
  const original = fs.readdir
  let traversals = 0
  let release!: () => void
  const barrier = new Promise<void>(resolve => { release = resolve })
  const spy = vi.spyOn(fs, 'readdir').mockImplementation((async (...args: Parameters<typeof original>) => {
    traversals++
    await barrier
    return original(...args)
  }) as typeof original)
  try {
    await writeFile(join(root, 'shared.ts'), '')
    const controller = new AbortController()
    const canceled = listWorkspaceFiles(root, '', controller.signal)
    const live = listWorkspaceFiles(root, 'shared')
    const rejection = expect(canceled).rejects.toThrow()
    await vi.waitFor(() => expect(traversals).toBe(1))
    controller.abort()
    await rejection
    release()
    expect((await live).files).toEqual(['shared.ts'])
    expect(traversals).toBe(1)
  } finally { release(); spy.mockRestore() }
})
