import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { resolve, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { diff } from './git.js'
import { selectedLinePatch } from '../shared/git-patch.js'
import { readFile, lstat, realpath, mkdtemp, writeFile, rm, rename } from 'node:fs/promises'
import { runProcess } from '../shared/child-process/run-process.js'
import { workspaceFile } from './workspace-files.js'
import type { WorkspaceService } from './service.js'

const objectId = z.string().regex(/^[a-f0-9]{40,64}$/)
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('discard-preview'), path: z.string().min(1).max(4000).optional() }),
  z.object({ action: z.literal('discard-unstaged'), path: z.string().min(1).max(4000).optional(), snapshot: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.object({ action: z.literal('discard'), path: z.string().min(1).max(4000), snapshot: z.string().max(2_000_000) }),
  z.object({ action: z.literal('ignore-file'), path: z.string().min(1).max(4000) }),
  z.object({ action: z.literal('track'), ref: z.string().min(1).max(250), name: z.string().trim().min(1).max(150) }),
  z.object({ action: z.literal('stash-branch'), hash: objectId, name: z.string().trim().min(1).max(150) }),
  z.object({ action: z.literal('file-history'), path: z.string().min(1).max(4000) }),
  z.object({ action: z.literal('blame'), path: z.string().min(1).max(4000) }),
  z.object({ action: z.literal('reset'), hash: objectId, head: objectId, mode: z.enum(['soft', 'mixed', 'hard']) }),
  z.object({ action: z.literal('amend'), head: objectId, message: z.string().trim().min(1).max(10000) }),
  z.object({ action: z.literal('rebase-plan'), base: objectId }),
  z.object({ action: z.literal('rebase-apply'), base: objectId, head: objectId, plan: z.string().max(100000) }),
  z.object({ action: z.literal('conflict-read'), path: z.string().min(1).max(4000) }),
  z.object({ action: z.literal('conflict-save'), path: z.string().min(1).max(4000), snapshot: z.string().regex(/^[a-f0-9]{64}$/), content: z.string().max(100_000) }),
  z.object({ action: z.literal('branch'), name: z.string().trim().min(1).max(150) }),
  z.object({ action: z.literal('switch'), branch: z.string().min(1).max(250) }),
  z.object({ action: z.literal('publish'), remote: z.string().min(1).max(250) }),
  z.object({ action: z.literal('continue'), operation: z.enum(['merge', 'rebase', 'cherry-pick', 'revert']) }),
  z.object({ action: z.literal('skip'), operation: z.enum(['rebase', 'cherry-pick', 'revert']) }),
  z.object({ action: z.literal('abort'), operation: z.enum(['merge', 'rebase', 'cherry-pick', 'revert']) }),
  z.object({ action: z.literal('unstage'), path: z.string().min(1).max(4000) }),
  z.object({ action: z.literal('stash-create'), message: z.string().trim().min(1).max(1000), untracked: z.enum(['yes', 'no']) }),
  z.object({ action: z.literal('stash-show'), hash: objectId }),
  z.object({ action: z.literal('stash-apply'), hash: objectId }),
  z.object({ action: z.literal('stash-pop'), hash: objectId }),
  z.object({ action: z.literal('stash-drop'), hash: objectId }),
  z.object({ action: z.literal('cherry-pick'), hash: objectId }),
  z.object({ action: z.literal('revert'), hash: objectId }),
  z.object({ action: z.literal('recover'), hash: objectId, name: z.string().trim().min(1).max(150) }),
  z.object({ action: z.literal('tag'), hash: objectId, name: z.string().trim().min(1).max(150) }),
  z.object({ action: z.literal('branch-delete'), branch: z.string().min(1).max(250) }),
  z.object({ action: z.literal('branch-rename'), branch: z.string().min(1).max(250), name: z.string().trim().min(1).max(150) }),
  z.object({ action: z.literal('hunk'), path: z.string().min(1).max(4000), revision: z.enum(['working', 'staged']), snapshot: z.string().max(2_000_000), index: z.string().regex(/^\d+$/), lines: z.string().max(100_000).optional() }),
  z.object({ action: z.literal('compare'), from: z.string().min(1).max(250), to: z.string().min(1).max(250) }),
  z.object({ action: z.literal('fetch'), prune: z.enum(['yes', 'no']).optional() }),
  z.object({ action: z.literal('pull'), strategy: z.enum(['ff-only', 'merge', 'rebase']).default('ff-only') }),
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
    [...(args[0] === 'stash' ? [] : ['--literal-pathspecs']), '-c', 'core.quotepath=false', ...args],
    root,
  )
  if (result.code !== 0)
    throw new Error(
      result.stderr.trim() || result.stdout.trim() || 'Git could not complete the operation.',
    )
  return result.stdout
}
export async function gitDetails(root: string) {
  const [branches, local, conflicts, remotes, tracking, counts] = await Promise.all([
    git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/', 'refs/remotes/']),
    git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']),
    git(root, ['diff', '--name-only', '--diff-filter=U', '-z']),
    git(root, ['remote']),
    runProcess('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], root),
    runProcess('git', ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], root),
  ])
  const markers = [
    ['rebase-merge', 'rebase'], ['rebase-apply', 'rebase'],
    ['MERGE_HEAD', 'merge'], ['CHERRY_PICK_HEAD', 'cherry-pick'], ['REVERT_HEAD', 'revert'],
  ] as const
  let operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null = null
  for (const [marker, name] of markers) {
    const path = (await git(root, ['rev-parse', '--git-path', marker])).trim()
    const exists = await lstat(resolve(root, path)).then(() => true, (error) => {
      if (error.code === 'ENOENT') return false
      throw error
    })
    if (exists) { operation = name; break }
  }
  const [ahead, behind] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [null, null]
  const [stashOutput, reflogOutput] = await Promise.all([
    git(root, ['stash', 'list', '--format=%H%x00%gd%x00%gs']),
    runProcess('git', ['reflog', '-50', '--format=%H%x00%gd%x00%gs'], root),
  ])
  const records = (text: string) => text.trim().split('\n').filter(Boolean).map(line => {
    const [hash, ref, subject] = line.split('\0')
    return { hash, ref, subject }
  })
  return {
    remoteBranches: (await git(root, ['for-each-ref', '--format=%(refname)', 'refs/remotes/'])).trim().split('\n').filter(Boolean),
    head: (await runProcess('git', ['rev-parse', '--verify', 'HEAD'], root)).stdout.trim(),
    stashes: records(stashOutput), reflog: records(reflogOutput.stdout),
    branches: branches.trim().split('\n').filter(Boolean),
    localBranches: local.trim().split('\n').filter(Boolean),
    remotes: remotes.trim().split('\n').filter(Boolean),
    upstream: tracking.code === 0 ? tracking.stdout.trim() : null,
    ahead, behind, operation,
    conflicts: conflicts.split('\0').filter(Boolean),
  }
}
// Limit the integrated editor to ordinary UTF-8 text. Other conflict types
// remain visible, but must be handled by an external editor/Git tool.
async function conflictSnapshot(root: string, path: string) {
  const file = await workspaceFile(root, path)
  const info = await lstat(resolve(root, path))
  if (!info.isFile() || info.nlink !== 1 || info.size > 100_000)
    throw new Error('Use an external tool for this conflict type or size.')
  const index = await git(root, ['ls-files', '--unmerged', '-z', '--', path])
  const entries = index.split('\0').filter(Boolean).map(record => {
    const tab = record.indexOf('\t')
    const [mode, hash, stage] = record.slice(0, tab).split(' ')
    if (record.slice(tab + 1) !== path || !['100644', '100755'].includes(mode))
      throw new Error('Use an external tool for non-regular file conflicts.')
    return { hash, stage }
  })
  if (!entries.length) throw new Error('This file is no longer conflicted.')
  const decode = (bytes: Buffer) => {
    const text = bytes.toString('utf8')
    if (bytes.length > 100_000 || text.includes('\0') || !Buffer.from(text).equals(bytes))
      throw new Error('The conflict editor supports UTF-8 text up to 100 KB only.')
    return text
  }
  const content = decode(await readFile(file))
  const versions: Record<string, string | null> = { '1': null, '2': null, '3': null }
  for (const entry of entries) {
    const size = Number((await git(root, ['cat-file', '-s', entry.hash])).trim())
    if (!Number.isSafeInteger(size) || size > 100_000) throw new Error('Conflict version exceeds 100 KB.')
    const text = await git(root, ['cat-file', 'blob', entry.hash])
    if (text.includes('\0') || text.includes('\ufffd')) throw new Error('Use an external tool for binary conflicts.')
    versions[entry.stage] = text
  }
  const head = await git(root, ['rev-parse', 'HEAD'])
  const snapshot = createHash('sha256').update(JSON.stringify([file, info.mode, info.ino, head, index, content])).digest('hex')
  return { file, mode: info.mode, content, versions, snapshot }
}

export async function gitAction(root: string, input: unknown) {
  const body = schema.parse(input)
  const state = await gitDetails(root)
  if (body.action === 'conflict-read' || body.action === 'conflict-save') {
    const current = await conflictSnapshot(root, body.path)
    if (body.action === 'conflict-read')
      return JSON.stringify({ content: current.content, versions: current.versions, snapshot: current.snapshot })
    if (body.content.includes('\0') || Buffer.byteLength(body.content) > 100_000)
      throw new Error('Result must be text up to 100 KB.')
    if (current.snapshot !== body.snapshot) throw new Error('The conflict changed. Reopen it before saving; your draft has not been written.')
    const temporary = `${current.file}.alfred-${randomUUID()}.tmp`
    try {
      await writeFile(temporary, body.content, { flag: 'wx', mode: current.mode & 0o777 })
      if ((await conflictSnapshot(root, body.path)).snapshot !== body.snapshot)
        throw new Error('The conflict changed before saving. Reopen it.')
      await rename(temporary, current.file)
    } finally { await rm(temporary, { force: true }) }
    return 'Resolution saved to the working file only. Review it, then mark resolved.'
  }
  if (body.action === 'compare') {
    const resolveCommit = async (ref: string) => {
      if (ref.startsWith('-')) throw new Error('Invalid reference.')
      return (await git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim()
    }
    const from = await resolveCommit(body.from)
    const to = await resolveCommit(body.to)
    return git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', from, to, '--'])
  }
  if (body.action === 'hunk') {
    if (state.conflicts.length || state.operation) throw new Error('Finish the current operation first.')
    const current = await diff(root, body.revision, body.path)
    if (current.truncated || current.stdout !== body.snapshot) throw new Error('The diff changed. Refresh before staging.')
    const text = current.stdout
    // Only ordinary text modifications: whole-file actions handle modes, renames,
    // additions, deletions and binary files without silently losing metadata.
    if (!text.startsWith('diff --git ') || /^(new file|deleted file|old mode|new mode|rename |copy |Binary files|GIT binary patch)/m.test(text))
      throw new Error('Use the whole-file action for this change.')
    const starts = [...text.matchAll(/^@@ .*@@.*$/gm)].map(match => match.index!)
    const index = Number(body.index)
    if (!Number.isSafeInteger(index) || index >= starts.length) throw new Error('Invalid hunk.')
    const selected = body.lines === undefined ? undefined : z.array(z.number().int().nonnegative()).min(1).max(10000).parse(JSON.parse(body.lines))
    const patch = selected
      ? selectedLinePatch(text, index, selected, body.revision === 'staged')
      : text.slice(0, starts[0]) + text.slice(starts[index], starts[index + 1] ?? text.length)
    const folder = await mkdtemp(join(tmpdir(), 'alfred-patch-'))
    try {
      const file = join(folder, 'change.patch')
      await writeFile(file, patch, { mode: 0o600 })
      const args = ['apply', '--cached', ...(body.revision === 'staged' && !selected ? ['--reverse'] : []), '--whitespace=nowarn']
      await git(root, [...args, '--check', file])
      return await git(root, [...args, file])
    } finally { await rm(folder, { recursive: true, force: true }) }
  }
  const advanced = ['stash-create', 'stash-apply', 'stash-pop', 'stash-drop', 'cherry-pick', 'revert', 'branch-delete', 'branch-rename']
  if (state.operation && advanced.includes(body.action))
    throw new Error('Continue or abort the current Git operation first.')
  const requireClean = async () => {
    if ((await git(root, ['status', '--porcelain', '--untracked-files=all'])).trim())
      throw new Error('Commit or stash local changes first (including untracked files).')
  }
  if (body.action === 'discard-preview' || body.action === 'discard-unstaged') {
    if (state.operation || state.conflicts.length) throw new Error('Finish the current operation first.')
    const paths = (await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', '--', ...(body.path ? [body.path] : [])])).split('\0').filter(Boolean)
    if (body.path && (paths.length !== 1 || paths[0] !== body.path))
      throw new Error('Select an exact tracked file with unstaged changes.')
    if (!paths.length) throw new Error('No tracked unstaged changes to discard.')
    const fingerprint = async () => {
      const hash = createHash('sha256')
      hash.update(await git(root, ['ls-files', '--stage', '-z']))
      for (const path of paths) {
        const file = await workspaceFile(root, path, true)
        hash.update(JSON.stringify(path))
        try {
          const info = await lstat(resolve(root, path))
          if (!info.isFile() || info.size > 20_000_000) throw new Error('Use an external tool for links, submodules or files over 20 MB.')
          hash.update(JSON.stringify([info.mode, info.size]))
          hash.update(await readFile(file))
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
          hash.update('missing')
        }
      }
      return hash.digest('hex')
    }
    const snapshot = await fingerprint()
    if (body.action === 'discard-preview') return JSON.stringify({ paths, snapshot })
    if (snapshot !== body.snapshot) throw new Error('Files or index changed. Review and confirm again.')
    // Explicit literal paths only; preserve the index, untracked and ignored files.
    await git(root, ['restore', '--worktree', '--', ...paths])
    return `Discarded unstaged changes in ${paths.length} files. Staged and untracked content retained.`
  }
  if (body.action === 'discard') {
    if (state.operation || state.conflicts.length) throw new Error('Finish the current operation first.')
    await workspaceFile(root, body.path, true)
    const tracked = (await git(root, ['ls-files', '-z', '--', body.path])).split('\0').filter(Boolean)
    if (tracked.length !== 1 || tracked[0] !== body.path) throw new Error('Select an exact tracked file. New files are never deleted by this action.')
    const current = await diff(root, 'working', body.path)
    if (current.truncated || current.stdout !== body.snapshot) throw new Error('The diff changed. Review it again before discarding.')
    // Restore from the index, never HEAD: staged work must remain intact.
    return git(root, ['restore', '--worktree', '--', body.path])
  }
  if (body.action === 'ignore-file') {
    if (state.operation || state.conflicts.length) throw new Error('Finish the current operation first.')
    await workspaceFile(root, body.path)
    const files = (await git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', body.path])).split('\0').filter(Boolean)
    if (files.length !== 1 || files[0] !== body.path || /[\r\n]/.test(body.path)) throw new Error('Select an exact untracked file.')
    const target = await workspaceFile(root, '.gitignore', true)
    let previous = ''
    let mode = 0o644
    try {
      const info = await lstat(target)
      if (!info.isFile() || info.nlink !== 1 || info.size > 100_000) throw new Error('Cannot safely edit .gitignore.')
      mode = info.mode & 0o777
      previous = await readFile(target, 'utf8')
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    // Anchored literal filename: escape wildcards, backslashes and spaces so
    // choosing one file cannot unintentionally ignore unrelated files.
    const pattern = '/' + body.path.replace(/[\\*?\[\] !#]/g, character => '\\' + character)
    const temporary = `${target}.alfred-${randomUUID()}.tmp`
    try {
      await writeFile(temporary, previous + (previous && !previous.endsWith('\n') ? '\n' : '') + pattern + '\n', { flag: 'wx', mode })
      const latest = await readFile(target, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })
      if (latest !== previous) throw new Error('.gitignore changed. Refresh before trying again.')
      await rename(temporary, target)
    } finally { await rm(temporary, { force: true }) }
    return 'Added a literal file pattern to .gitignore. Review and stage .gitignore separately.'
  }
  if (body.action === 'file-history' || body.action === 'blame') {
    await workspaceFile(root, body.path, true)
    if (body.action === 'file-history')
      return git(root, ['log', '-100', '--follow', '--format=%h %aI %an%n%s', '--', body.path])
    return git(root, ['blame', '--date=short', 'HEAD', '--', body.path])
  }
  if (['reset', 'amend', 'rebase-plan', 'rebase-apply'].includes(body.action) && ((state.operation && !(body.action === 'amend' && state.operation === 'rebase')) || state.conflicts.length))
    throw new Error('Finish the current operation and resolve conflicts first.')
  const verifyHead = async (expected: string) => {
    if ((await git(root, ['rev-parse', 'HEAD'])).trim() !== expected)
      throw new Error('HEAD changed. Refresh and review again.')
    if (!(body.action === 'amend' && state.operation === 'rebase')) await git(root, ['symbolic-ref', '--quiet', 'HEAD'])
  }
  const backup = async (head: string) => {
    const name = `alfred-recovery/${randomUUID()}`
    await git(root, ['branch', name, head])
    return name
  }
  if (body.action === 'reset' || body.action === 'amend') {
    await verifyHead(body.head)
    if (body.action === 'reset') {
      // A hard reset is deliberately restricted to a clean tree: recovery refs
      // preserve commits, not uncommitted files or untracked obstructions.
      await requireClean()
      await git(root, ['cat-file', '-e', `${body.hash}^{commit}`])
    }
    const recovery = await backup(body.head)
    await verifyHead(body.head)
    const output = body.action === 'reset'
      ? await git(root, ['reset', `--${body.mode}`, body.hash])
      : await git(root, ['-c', 'core.editor=true', 'commit', '--amend', '-m', body.message])
    return `${output}\nRecovery branch: ${recovery}`
  }
  if (body.action === 'rebase-plan' || body.action === 'rebase-apply') {
    await requireClean()
    const head = (await git(root, ['rev-parse', 'HEAD'])).trim()
    await verifyHead(body.action === 'rebase-apply' ? body.head : head)
    await git(root, ['merge-base', '--is-ancestor', body.base, head])
    const rows = (await git(root, ['rev-list', '--reverse', '--parents', `${body.base}..${head}`])).trim().split('\n').filter(Boolean)
    if (!rows.length || rows.length > 100 || rows.some(row => row.split(' ').length !== 2))
      throw new Error('Select a base preceding 1–100 linear commits. Merge commits are not supported in this editor.')
    const hashes = rows.map(row => row.split(' ')[0])
    if (body.action === 'rebase-plan') {
      const commits = await Promise.all(hashes.map(async hash => ({ hash, subject: (await git(root, ['show', '-s', '--format=%s', hash])).trim() })))
      return JSON.stringify({ head, base: body.base, commits })
    }
    const plan = z.array(z.object({ hash: objectId, action: z.enum(['pick', 'edit', 'squash', 'fixup', 'drop']) })).min(1).max(100).parse(JSON.parse(body.plan))
    if (plan.length !== hashes.length || new Set(plan.map(row => row.hash)).size !== hashes.length || plan.some(row => !hashes.includes(row.hash)))
      throw new Error('The plan must contain every original commit exactly once.')
    const first = plan.find(row => row.action !== 'drop')
    if (!first || ['squash', 'fixup'].includes(first.action)) throw new Error('The first retained commit must be pick or edit.')
    const recovery = await backup(head)
    const folder = await mkdtemp(join(tmpdir(), 'alfred-rebase-'))
    try {
      const editor = join(folder, 'editor.cjs')
      const todo = plan.map(row => `${row.action} ${row.hash}`).join('\n') + '\n'
      await writeFile(editor, `require('node:fs').writeFileSync(process.argv[2], ${JSON.stringify(todo)});`, { mode: 0o600 })
      // Git runs sequence.editor through its shell. Quote only server-owned paths;
      // user plan data lives in the file and never enters a shell command.
      const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'"
      await verifyHead(head)
      const output = await git(root, ['-c', `sequence.editor=${quote(process.execPath)} ${quote(editor)}`, '-c', 'core.editor=true', 'rebase', '-i', '--no-autostash', body.base])
      return `${output}\nRecovery branch: ${recovery}`
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nRecovery branch: ${recovery}. Inspect operation state before continuing or aborting.`)
    } finally { await rm(folder, { recursive: true, force: true }) }
  }
  if (body.action === 'track' || body.action === 'stash-branch') {
    if (state.operation || state.conflicts.length) throw new Error('Finish the current operation first.')
    await requireClean()
    if (body.name.startsWith('-')) throw new Error('Invalid branch name.')
    await git(root, ['check-ref-format', '--branch', body.name])
    if (body.action === 'track') {
      if (!state.remoteBranches.includes(body.ref)) throw new Error('Select an existing remote branch.')
      return git(root, ['switch', '--track', '-c', body.name, body.ref])
    }
    if (!state.stashes.some(stash => stash.hash === body.hash)) throw new Error('The stash changed. Refresh the list.')
    // Use the immutable stash object rather than its mutable ordinal. Retain it
    // even on success so that branch creation never silently discards recovery.
    await git(root, ['switch', '-c', body.name, `${body.hash}^1`])
    try {
      await git(root, ['stash', 'apply', '--index', body.hash])
      return 'Branch created from stash base; stash applied and retained.'
    } catch (error) {
      throw new Error(`Branch created; stash retained. Inspect changes before retrying: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (body.action === 'stash-create') {
    // Check every affected path before the repository-wide stash command.
    const files = await git(root, ['diff', 'HEAD', '--name-only', '-z'])
    const added = body.untracked === 'yes'
      ? await git(root, ['ls-files', '--others', '--exclude-standard', '-z']) : ''
    for (const path of (files + added).split('\0').filter(Boolean)) await workspaceFile(root, path, true)
    return git(root, ['stash', 'push', ...(body.untracked === 'yes' ? ['--include-untracked'] : []), '-m', body.message])
  }
  if (body.action === 'stash-show' || body.action === 'stash-apply' || body.action === 'stash-pop' || body.action === 'stash-drop') {
    const stash = state.stashes.find(entry => entry.hash === body.hash)
    if (!stash) throw new Error('The stash changed. Refresh the list.')
    if (body.action === 'stash-show')
      return git(root, ['stash', 'show', '--include-untracked', '-p', '--no-ext-diff', '--no-textconv', body.hash])
    if (body.action !== 'stash-drop') {
      await requireClean()
      // Apply by immutable object id. A conflict leaves the stash intact.
      await git(root, ['stash', 'apply', body.hash])
      if (body.action === 'stash-apply') return 'Stash applied; original stash retained.'
    }
    const current = (await gitDetails(root)).stashes.find(entry => entry.ref === stash.ref)
    if (current?.hash !== body.hash) throw new Error('Stash list changed; stash was not deleted. Refresh before any further action.')
    return git(root, ['stash', 'drop', stash.ref])
  }
  if (body.action === 'cherry-pick' || body.action === 'revert') {
    await requireClean()
    await git(root, ['cat-file', '-e', `${body.hash}^{commit}`])
    return git(root, ['-c', 'core.editor=true', body.action, '--no-edit', body.hash])
  }
  if (body.action === 'recover' || body.action === 'tag') {
    if (body.name.startsWith('-')) throw new Error('Invalid reference name.')
    await git(root, ['check-ref-format', `refs/${body.action === 'tag' ? 'tags' : 'heads'}/${body.name}`])
    await git(root, ['cat-file', '-e', `${body.hash}^{commit}`])
    return git(root, [body.action === 'tag' ? 'tag' : 'branch', body.name, body.hash])
  }
  if (body.action === 'branch-delete' || body.action === 'branch-rename') {
    if (body.branch.startsWith('-') || !state.localBranches.includes(body.branch)) throw new Error('Select an existing local branch.')
    if (body.action === 'branch-delete') return git(root, ['branch', '-d', body.branch])
    if (body.name.startsWith('-')) throw new Error('Invalid branch name.')
    await git(root, ['check-ref-format', '--branch', body.name])
    return git(root, ['branch', '-m', body.branch, body.name])
  }
  if (body.action === 'continue' || body.action === 'abort' || body.action === 'skip') {
    if (!state.operation || state.operation !== body.operation)
      throw new Error('The Git operation changed. Refresh before continuing.')
    if (body.action === 'continue' && state.conflicts.length)
      throw new Error('Resolve all conflicts before continuing.')
    return git(root, ['-c', 'core.editor=true', '-c', 'sequence.editor=true', state.operation, `--${body.action}`])
  }
  if (state.operation && ['branch', 'switch', 'publish', 'pull', 'merge', 'unstage-all', 'unstage'].includes(body.action))
    throw new Error('Continue or abort the current Git operation first.')
  if (body.action === 'switch') {
    if (body.branch.startsWith('-') || !state.localBranches.includes(body.branch))
      throw new Error('Select an existing local branch.')
    return git(root, ['switch', '--no-guess', body.branch])
  }
  if (body.action === 'publish') {
    if (body.remote.startsWith('-') || !state.remotes.includes(body.remote))
      throw new Error('Select an existing remote.')
    const branch = (await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim()
    return git(root, ['push', '--set-upstream', body.remote, `refs/heads/${branch}:refs/heads/${branch}`])
  }
  if (body.action === 'unstage') {
    await workspaceFile(root, body.path, true)
    const tracked = (await git(root, ['ls-files', '-z', '--', body.path])).split('\0').filter(Boolean)
    const head = await runProcess('git', ['rev-parse', '--verify', 'HEAD'], root)
    const previous = head.code === 0
      ? (await git(root, ['ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', body.path])).split('\0').filter(Boolean)
      : []
    if (![...tracked, ...previous].length || [...tracked, ...previous].some(path => path !== body.path))
      throw new Error('Select an exact tracked file.')
    if (state.conflicts.includes(body.path)) throw new Error('Resolve conflicts first.')
    return head.code === 0
      ? git(root, ['reset', 'HEAD', '--', body.path])
      : git(root, ['rm', '--cached', '-f', '--', body.path])
  }
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
  if (body.action === 'fetch') return git(root, ['fetch', '--all', ...(body.prune === 'yes' ? ['--prune'] : [])])
  if (body.action === 'pull') {
    await requireClean()
    if (!state.upstream) throw new Error('Configure an upstream before pulling.')
    // Explicit flags override local pull/rebase/autostash settings. Never hide
    // local changes in an implicit stash or silently choose an integration policy.
    const strategy = body.strategy === 'merge'
      ? ['--no-rebase', '--no-ff', '--no-edit']
      : body.strategy === 'rebase' ? ['--rebase'] : ['--no-rebase', '--ff-only']
    return git(root, ['-c', 'core.editor=true', 'pull', '--no-autostash', ...strategy])
  }
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
    // Linked worktrees share refs and the object database: serialize this route
    // by common Git directory rather than by checkout path.
    const common = (await git(root, ['rev-parse', '--git-common-dir'])).trim()
    const lockKey = await realpath(resolve(root, common))
    if (locks.has(lockKey))
      return reply
        .code(409)
        .send({ error: 'A Git operation is already running in this workspace.' })
    locks.add(lockKey)
    try {
      const output = await gitAction(root, request.body)
      return { output }
    } finally {
      locks.delete(lockKey)
      // A failed merge/rebase may still have changed the repository.
      service.changed()
    }
  })
}
