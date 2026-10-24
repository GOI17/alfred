import { lstat, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { runProcess } from '../shared/child-process/run-process.js'
import type { GitHistory, Project, Worktree } from '../shared/contracts.js'

async function git(path: string, args: string[]) {
  const result = await runProcess('git', ['-c', 'core.quotepath=false', ...args], path)
  if (result.code !== 0)
    throw new Error(result.stderr.trim() || 'Git could not complete the operation.')
  return result
}
export async function inspectProject(input: string): Promise<Project> {
  const path = await realpath(input)
  if (!(await stat(path)).isDirectory()) throw new Error('Select a folder.')
  const repository = await runProcess('git', ['rev-parse', '--show-toplevel'], path)
  const root = repository.code === 0 ? await realpath(repository.stdout.trim()) : path
  return {
    id: randomUUID(),
    name: basename(root) || root,
    path: root,
    kind: repository.code === 0 ? 'git' : 'folder',
    createdAt: new Date().toISOString(),
  }
}
export async function listWorktrees(project: Project): Promise<Worktree[]> {
  if (project.kind === 'folder')
    return [{ path: project.path, branch: 'Folder', main: true, locked: false }]
  const output = (await git(project.path, ['worktree', 'list', '--porcelain'])).stdout
  return output
    .trim()
    .split('\n\n')
    .filter(Boolean)
    .map((block, index) => {
      const lines = block.split('\n')
      const rawPath = lines.find((line) => line.startsWith('worktree '))?.slice(9) ?? ''
      let path = rawPath
      if (rawPath.startsWith('"')) {
        try {
          const decoded: unknown = JSON.parse(rawPath)
          if (typeof decoded === 'string') path = decoded
        } catch {
          throw new Error('Git returned a path that could not be parsed.')
        }
      }
      return {
        path,
        branch:
          lines
            .find((line) => line.startsWith('branch '))
            ?.slice(7)
            .replace(/^refs\/heads\//, '') || 'Detached HEAD',
        main: index === 0,
        locked: lines.some((line) => line.startsWith('locked')),
      }
    })
}
export async function verifyWorkspace(project: Project, path: string) {
  const canonical = await realpath(path)
  if (!(await listWorktrees(project)).some((tree) => tree.path === canonical))
    throw new Error('The workspace no longer belongs to this project.')
  return canonical
}
export function defaultWorktreePath(project: Project, directory: string) {
  if (project.kind !== 'git') throw new Error('This folder is not a Git repository.')
  return resolve(directory, project.id, randomUUID())
}
export async function createWorktree(project: Project, branch: string, directory: string, destination?: string) {
  if (project.kind !== 'git') throw new Error('This folder is not a Git repository.')
  await git(project.path, ['check-ref-format', '--branch', branch])
  if (branch.startsWith('-')) throw new Error('Invalid branch name.')
  const input = destination ?? defaultWorktreePath(project, directory)
  const expanded = /^~[\\/]/.test(input) ? join(homedir(), input.slice(2)) : input
  if (!isAbsolute(expanded) || expanded.includes('\0'))
    throw new Error('Use an absolute path for the new worktree folder.')
  const path = resolve(expanded)
  const existing = await lstat(path).catch((error) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (existing) throw new Error('The destination already exists. Choose a new folder for the worktree.')
  await git(project.path, ['worktree', 'add', '-b', branch, path, 'HEAD'])
  return realpath(path)
}
export async function removeWorktree(project: Project, path: string) {
  const canonical = await realpath(path)
  const tree = (await listWorktrees(project)).find((item) => item.path === canonical)
  if (!tree || tree.main || tree.path === project.path)
    throw new Error('The main workspace cannot be deleted.')
  await git(project.path, ['worktree', 'remove', '--', tree.path])
}
export async function history(path: string, skip = 0): Promise<GitHistory> {
  const [branch, status, head] = await Promise.all([
    runProcess('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], path),
    git(path, ['status', '--porcelain=v1', '-z']),
    runProcess('git', ['rev-parse', '--verify', 'HEAD'], path),
  ])
  const commits =
    head.code === 0
      ? (
          await git(path, [
            'log',
            '--max-count=51',
            `--skip=${skip}`,
            '--format=%H%x00%h%x00%an%x00%aI%x00%s%x00',
            'HEAD',
            '--',
          ])
        ).stdout
          .split('\0\n')
          .filter(Boolean)
          .map((record) => {
            const [hash, shortHash, author, date, subject] = record.split('\0')
            return { hash, shortHash, author, date, subject }
          })
      : []
  const records = status.stdout.split('\0').filter(Boolean)
  const changes = []
  for (let i = 0; i < records.length; i++) {
    const entry = records[i]
    changes.push({ status: entry.slice(0, 2), path: entry.slice(3) })
    if (/R|C/.test(entry.slice(0, 2))) i++
  }
  return {
    branch: branch.stdout.trim() || 'Detached HEAD',
    commits: commits.slice(0, 50),
    changes,
    hasMore: commits.length > 50,
  }
}
export async function diff(path: string, revision: string) {
  if (revision === 'working')
    return git(path, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--', '.'])
  if (revision === 'staged')
    return git(path, [
      'diff',
      '--cached',
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--',
      '.',
    ])
  if (!/^[a-f0-9]{40,64}$/.test(revision)) throw new Error('Invalid commit.')
  return git(path, [
    'show',
    '--format=fuller',
    '--no-ext-diff',
    '--no-textconv',
    '--no-color',
    revision,
    '--',
  ])
}
