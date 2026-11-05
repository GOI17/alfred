import { afterEach, beforeEach, expect, test } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { viewerDirectory, viewerFile } from '../src/server/file-viewer.js'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'alfred-viewer-test-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

test('lists folders first and reads UTF-8 text', async () => {
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'hello.ts'), '// ¡Hola!\n')
  expect(await viewerDirectory(root, '.')).toEqual({ entries: [
    { name: 'src', directory: true }, { name: 'hello.ts', directory: false },
  ], truncated: false })
  expect(await viewerFile(root, 'hello.ts')).toEqual({ content: '// ¡Hola!\n' })
})

test('hides restricted directories and symbolic links', async () => {
  await mkdir(join(root, 'node_modules'))
  await mkdir(join(root, 'src'))
  await symlink(join(root, 'src'), join(root, 'alias'))
  expect((await viewerDirectory(root, '.')).entries).toEqual([{ name: 'src', directory: true }])
})

test('rejects private paths and paths outside the workspace', async () => {
  await expect(viewerFile(root, '.env')).rejects.toThrow()
  await expect(viewerDirectory(root, '..')).rejects.toThrow()
  await symlink(tmpdir(), join(root, 'outside'))
  await expect(viewerDirectory(root, 'outside')).rejects.toThrow()
})

test('rejects binary, invalid UTF-8, oversized files and directories', async () => {
  await writeFile(join(root, 'binary'), Buffer.from([0, 1, 2]))
  await writeFile(join(root, 'invalid'), Buffer.from([255]))
  await writeFile(join(root, 'large'), Buffer.alloc(1_000_001, 65))
  await expect(viewerFile(root, 'binary')).rejects.toThrow('Binary')
  await expect(viewerFile(root, 'invalid')).rejects.toThrow('UTF-8')
  await expect(viewerFile(root, 'large')).rejects.toThrow('1 MB')
  await expect(viewerFile(root, '.')).rejects.toThrow('regular')
})

test('caps directory listings at 500 entries', async () => {
  await Promise.all(Array.from({ length: 501 }, (_, i) => writeFile(join(root, `${i}.txt`), '')))
  const listing = await viewerDirectory(root, '.')
  expect(listing.entries).toHaveLength(500)
  expect(listing.truncated).toBe(true)
})
