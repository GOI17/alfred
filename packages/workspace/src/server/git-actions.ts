import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { readFile, lstat } from 'node:fs/promises'
import { runProcess } from '../shared/child-process/run-process.js'
import { workspaceFile } from './workspace-files.js'
import type { WorkspaceService } from './service.js'

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('branch'), name: z.string().trim().min(1).max(150) }),
  z.object({ action: z.literal('fetch') }),
  z.object({ action: z.literal('pull') }),
  z.object({ action: z.literal('push') }),
  z.object({ action: z.literal('merge'), branch: z.string().min(1).max(250) }),
  z.object({ action: z.literal('unstage-all') }),
  z.object({ action: z.literal('stage'), path: z.string().min(1).max(4000) }),
  z.object({ action: z.literal('resolve'), path: z.string().min(1).max(4000) }),
  z.object({ action: z.literal('commit'), message: z.string().trim().min(1).max(10000) }),
])

async function git(root: string, args: string[]) {
  const result = await runProcess(
    'git',
    ['--literal-pathspecs', '-c', 'core.quotepath=false', ...args],
    root,
  )
  if (result.code !== 0)
    throw new Error(
      result.stderr.trim() || result.stdout.trim() || 'Git could not complete the operation.',
    )
  return result.stdout
}
export async function gitDetails(root: string) {
  const [branches, conflicts] = await Promise.all([
    git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/', 'refs/remotes/']),
    git(root, ['diff', '--name-only', '--diff-filter=U', '-z']),
  ])
  return {
    branches: branches.trim().split('\n').filter(Boolean),
    conflicts: conflicts.split('\0').filter(Boolean),
  }
}
export async function gitAction(root: string, input: unknown) {
  const body = schema.parse(input)
  if (body.action === 'branch') {
    if (body.name.startsWith('-')) throw new Error('Invalid branch name.')
    await git(root, ['check-ref-format', '--branch', body.name])
    return git(root, ['switch', '-c', body.name])
  }
  if (body.action === 'unstage-all') {
    const { conflicts } = await gitDetails(root)
    if (conflicts.length) throw new Error('Resolve merge conflicts before unstaging all files.')
    const refs = await git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads/'])
    const head = await runProcess('git', ['rev-parse', '--verify', 'HEAD'], root)
    if (head.code === 0) return git(root, ['reset', '--mixed', 'HEAD'])
    // An unborn branch has no HEAD: remove index entries, never working files.
    const symbolic = await git(root, ['symbolic-ref', 'HEAD'])
    if (refs.split('\n').includes(symbolic.trim())) throw new Error('Could not resolve HEAD.')
    return git(root, ['rm', '--cached', '-r', '-f', '--ignore-unmatch', '--', '.'])
  }
  if (body.action === 'push') return git(root, ['push'])
  if (body.action === 'fetch') return git(root, ['fetch', '--all'])
  if (body.action === 'pull') return git(root, ['-c', 'core.editor=true', 'pull', '--ff-only'])
  if (body.action === 'merge') {
    const { branches } = await gitDetails(root)
    if (body.branch.startsWith('-') || !branches.includes(body.branch))
      throw new Error('Select an existing branch.')
    return git(root, [
      '-c',
      'core.editor=true',
      'merge',
      '--no-edit',
      '--no-ff',
      '--no-commit',
      body.branch,
    ])
  }
  if (body.action === 'stage' || body.action === 'resolve') {
    const file = await workspaceFile(root, body.path, true)
    // A directory pathspec recursively stages children, bypassing per-file privacy checks.
    // Missing paths are allowed only for an exact tracked file, never a deleted directory.
    try {
      const info = await lstat(file)
      if (!info.isFile()) throw new Error('Select an individual file, not a directory.')
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      const tracked = (await git(root, ['ls-files', '-z', '--', body.path]))
        .split('\0').filter(Boolean)
      if (!tracked.length || tracked.some((path) => path !== body.path))
        throw new Error('Select an exact tracked file for deletion staging.')
    }
    const { conflicts } = await gitDetails(root)
    if (body.action === 'resolve') {
      if (!conflicts.includes(body.path))
        throw new Error('This file is no longer conflicted. Refresh the Git panel.')
      try {
        const info = await lstat(file)
        if (!info.isFile() || info.size > 2_000_000)
          throw new Error('Resolve this file with an external Git tool.')
        const text = await readFile(file, 'utf8')
        if (text.includes('\0'))
          throw new Error('Resolve binary conflicts with an external Git tool.')
        if (/^(<{7}|={7}|>{7}|\|{7})(?: |$)/m.test(text))
          throw new Error('Remove all conflict markers before marking the file resolved.')
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
    } else if (conflicts.includes(body.path))
      throw new Error('Use Mark resolved for conflicted files.')
    return git(root, ['add', '--', body.path])
  }
  const { conflicts } = await gitDetails(root)
  if (conflicts.length) throw new Error('Resolve all merge conflicts before committing.')
  return git(root, ['-c', 'core.editor=true', 'commit', '-m', body.message])
}

export function gitActionRoutes(app: FastifyInstance, service: WorkspaceService) {
  const locks = new Set<string>()
  const workspace = async (params: unknown) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(params)
    return service.workspace(service.conversation(id))
  }
  app.get('/api/conversations/:id/git/details', async (request) =>
    gitDetails(await workspace(request.params)),
  )
  app.post('/api/conversations/:id/git/action', async (request, reply) => {
    const root = await workspace(request.params)
    if (locks.has(root))
      return reply
        .code(409)
        .send({ error: 'A Git operation is already running in this workspace.' })
    locks.add(root)
    try {
      const output = await gitAction(root, request.body)
      service.changed()
      return { output }
    } finally {
      locks.delete(root)
    }
  })
}
