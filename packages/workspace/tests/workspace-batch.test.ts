import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { workspaceTools } from '../src/server/workspace-files.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'alfred-batch-'))
  roots.push(root)
  await writeFile(join(root, 'a.txt'), 'original')
  return root
}
const files = [{ path: 'a.txt', content: 'updated' }, { path: 'b.txt', content: 'new' }]
const options = { toolCallId: 'batch-test', messages: [], context: {} }

describe('batch write approval', () => {
  it('shows exact contents and waits for one explicit approval for the entire batch', async () => {
    const root = await fixture()
    const approve = vi.fn(async (path: string, content: string) => {
      expect(path).toBe('Batch of 2 file(s)')
      expect(JSON.parse(content)).toEqual({ files })
      expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('original')
      await expect(readFile(join(root, 'b.txt'))).rejects.toThrow()
      return true
    })
    const tool = workspaceTools(root, approve).write_files
    expect(await tool.execute!({ files }, options)).toEqual({ saved: ['a.txt', 'b.txt'] })
    expect(approve).toHaveBeenCalledTimes(1)
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('updated')
    expect(await readFile(join(root, 'b.txt'), 'utf8')).toBe('new')

    // A later batch must request fresh approval against the current file state.
    const nextFiles = [{ path: 'a.txt', content: 'updated again' }, { path: 'b.txt', content: 'new again' }]
    approve.mockImplementationOnce(async (path: string, content: string) => {
      expect(path).toBe('Batch of 2 file(s)')
      expect(JSON.parse(content)).toEqual({ files: nextFiles })
      expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('updated')
      expect(await readFile(join(root, 'b.txt'), 'utf8')).toBe('new')
      return true
    })
    expect(await tool.execute!({ files: nextFiles }, options)).toEqual({ saved: ['a.txt', 'b.txt'] })
    expect(approve).toHaveBeenCalledTimes(2)
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('updated again')
    expect(await readFile(join(root, 'b.txt'), 'utf8')).toBe('new again')
  })
  it('writes nothing when rejected', async () => {
    const root = await fixture()
    const tool = workspaceTools(root, async () => false).write_files
    expect(await tool.execute!({ files }, options)).toEqual({ saved: [], rejected: true })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('original')
    await expect(readFile(join(root, 'b.txt'))).rejects.toThrow()
  })
  it('rechecks all files before writing any of the batch', async () => {
    const root = await fixture()
    const tool = workspaceTools(root, async () => {
      await writeFile(join(root, 'b.txt'), 'external edit')
      return true
    }).write_files
    await expect(tool.execute!({ files }, options)).rejects.toThrow('changed')
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('original')
    expect(await readFile(join(root, 'b.txt'), 'utf8')).toBe('external edit')
  })
  it('rejects duplicate destinations and private paths before asking approval', async () => {
    const root = await fixture()
    const approve = vi.fn(async () => true)
    const tool = workspaceTools(root, approve).write_files
    await expect(tool.execute!({ files: [files[0], { path: './a.txt', content: 'other' }] }, options)).rejects.toThrow('duplicate')
    await expect(tool.execute!({ files: [{ path: '.env', content: 'test' }] }, options)).rejects.toThrow('Private')
    expect(approve).not.toHaveBeenCalled()
  })
})
