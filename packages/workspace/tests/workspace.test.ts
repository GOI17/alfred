import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { WorkspaceService } from '../src/server/service.js'
import { history, createWorktree, listWorktrees, diff } from '../src/server/git.js'
import { workspaceFile } from '../src/server/workspace-files.js'
import { gitFixture } from './fixtures.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})
async function fixture() {
  const files = await gitFixture()
  cleanup.push(() => rm(files.root, { recursive: true, force: true }))
  const service = await WorkspaceService.open(join(files.root, 'data'))
  cleanup.push(() => service.close())
  return { ...files, service }
}
describe('project lifecycle', () => {
  it('persists projects and conversations without deleting source files when unregistered', async () => {
    const { repository, service, root } = await fixture()
    const project = await service.addProject(repository)
    expect(project.kind).toBe('git')
    expect(project.name).toBe('project with spaces')
    await expect(service.addProject(repository)).rejects.toThrow('already been added')
    const conversation = await service.addConversation(project.id, repository)
    const reopened = await WorkspaceService.open(join(root, 'data'))
    expect(reopened.state().conversations[0].id).toBe(conversation.id)
    await reopened.close()
    await service.removeProject(project.id)
    expect(service.state().projects).toHaveLength(0)
    expect(service.state().conversations).toHaveLength(0)
    expect(await readFile(join(repository, 'hello.txt'), 'utf8')).toBe('hello\n')
  })
  it('supports plain folders and rejects foreign workspace paths', async () => {
    const { service, root, repository } = await fixture()
    const folder = join(root, 'folder')
    await mkdir(folder)
    const project = await service.addProject(folder)
    expect(project.kind).toBe('folder')
    expect(await listWorktrees(project)).toEqual([
      { path: folder, branch: 'Folder', main: true, locked: false },
    ])
    await expect(service.addConversation(project.id, repository)).rejects.toThrow('no longer belongs')
    await expect(createWorktree(project, 'feature', service.worktreeDirectory())).rejects.toThrow(
      'is not a Git repository',
    )
  })
  it('creates real worktrees, refuses dirty deletion, and preserves the branch after removal', async () => {
    const { repository, service, git } = await fixture()
    const project = await service.addProject(repository)
    const path = await createWorktree(project, 'feature/phone', service.worktreeDirectory())
    expect((await listWorktrees(project)).map((item) => item.branch)).toEqual([
      'main',
      'feature/phone',
    ])
    await service.addConversation(project.id, path)
    await writeFile(join(path, 'hello.txt'), 'changes to preserve')
    await expect(service.removeTree(project.id, path)).rejects.toThrow()
    expect(await readFile(join(path, 'hello.txt'), 'utf8')).toBe('changes to preserve')
    await writeFile(join(path, 'hello.txt'), 'hello\n')
    await service.removeTree(project.id, path)
    expect(await listWorktrees(project)).toHaveLength(1)
    expect(service.state().conversations).toHaveLength(0)
    expect(await git('branch', '--list', 'feature/phone')).toContain('feature/phone')
    await expect(service.removeTree(project.id, repository)).rejects.toThrow('main workspace')
  })
  it('reads commits and bounded working diffs without shell expansion', async () => {
    const { repository } = await fixture()
    await writeFile(join(repository, 'hello.txt'), 'next idea\n')
    await writeFile(join(repository, 'new file.txt'), 'new')
    const result = await history(repository)
    expect(result.branch).toBe('main')
    expect(result.commits[0].subject).toBe('The first idea')
    expect(result.changes.map((item) => item.path)).toContain('new file.txt')
    expect((await diff(repository, 'working')).stdout).toContain('+next idea')
    await expect(diff(repository, '--output=bad')).rejects.toThrow('Invalid')
  })
  it('prevents duplicate pane ownership and requires one native chat', async () => {
    const { repository, service } = await fixture()
    const project = await service.addProject(repository)
    const first = await service.addConversation(project.id, repository)
    const second = await service.addConversation(project.id, repository)
    await expect(service.setLayout(second.id, first.layout)).rejects.toThrow('another conversation')
    await expect(
      service.setLayout(first.id, { type: 'pane', id: randomUUID(), kind: 'terminal' }),
    ).rejects.toThrow('one chat')
  })
  it('blocks file traversal, private files, and symlinks escaping the workspace', async () => {
    const { root, repository } = await fixture()
    await writeFile(join(root, 'secret.txt'), 'private')
    await symlink(join(root, 'secret.txt'), join(repository, 'link.txt'))
    await expect(workspaceFile(repository, '../secret.txt')).rejects.toThrow()
    await expect(workspaceFile(repository, '.env')).rejects.toThrow()
    await expect(workspaceFile(repository, 'link.txt')).rejects.toThrow('link')
    expect(await workspaceFile(repository, 'new.txt', true)).toBe(join(repository, 'new.txt'))
  })
})
