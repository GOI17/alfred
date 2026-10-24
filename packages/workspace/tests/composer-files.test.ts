import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listWorkspaceFiles } from '../src/server/workspace-files'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'alfred-composer-'))
  roots.push(root)
  return root
}
it('lists nested workspace paths and filters case-insensitively', async () => {
  const root = await fixture()
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'hello world.ts'), '')
  await writeFile(join(root, 'README.md'), '')
  expect((await listWorkspaceFiles(root, 'SRC/hello')).files).toEqual(['src/hello world.ts'])
  expect((await listWorkspaceFiles(root, 'absent')).files).toEqual([])
})
it('excludes private files, dependencies and symbolic links', async () => {
  const root = await fixture()
  for (const directory of ['node_modules', '.git', '.ssh']) {
    await mkdir(join(root, directory))
    await writeFile(join(root, directory, 'hidden.txt'), '')
  }
  for (const file of ['.env', '.env.local', 'private.key', 'cert.pem', 'safe.ts']) await writeFile(join(root, file), '')
  await symlink(join(root, 'safe.ts'), join(root, 'link.ts'))
  expect((await listWorkspaceFiles(root)).files).toEqual(['safe.ts'])
})
it('limits results and reports truncation', async () => {
  const root = await fixture()
  await Promise.all(Array.from({ length: 110 }, (_, index) => writeFile(join(root, `${index}.txt`), '')))
  const result = await listWorkspaceFiles(root)
  expect(result.files).toHaveLength(100)
  expect(result.truncated).toBe(true)
})
