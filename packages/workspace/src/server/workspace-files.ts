import { lstat, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { tool, type Tool } from 'ai'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { privatePath } from './workspace-path-policy.js'

function inside(root: string, target: string) {
  const path = relative(root, target)
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}
export async function workspaceFile(root: string, path: string, creating = false) {
  if (isAbsolute(path) || privatePath(path)) throw new Error('Private path or outside the workspace.')
  const canonicalRoot = await realpath(root)
  const target = resolve(canonicalRoot, path)
  if (!inside(canonicalRoot, target)) throw new Error('The path is outside the workspace.')
  try {
    const canonical = await realpath(target)
    if (!inside(canonicalRoot, canonical)) throw new Error('The link points outside the workspace.')
    if (privatePath(relative(canonicalRoot, canonical))) throw new Error('Private path.')
    // A hard link can alias a private file or a file outside the workspace.
    const info = await lstat(canonical)
    if (info.isFile() && info.nlink > 1) throw new Error('Hard-linked files are not allowed.')
    return canonical
  } catch (error) {
    if (!(creating && error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    const parent = await realpath(dirname(target))
    if (!inside(canonicalRoot, parent) || privatePath(relative(canonicalRoot, parent)))
      throw new Error('The folder is private or outside the workspace.', { cause: error })
    return target
  }
}
type BatchWriteResult = {
  saved: string[]; rejected?: boolean; failed?: string; notWritten?: string[]; error?: string
}
type WorkspaceTools = {
  list_directory: Tool<{ path: string }, { name: string; directory: boolean }[]>
  read_file: Tool<{ path: string }, string>
  write_file: Tool<{ path: string; content: string }, string>
  write_files: Tool<{ files: { path: string; content: string }[] }, BatchWriteResult>
}
export function workspaceTools(root: string, approve: (path: string, content: string) => Promise<boolean>, options: { automatic?: boolean; signal?: AbortSignal } = {}): WorkspaceTools {
  const checkStopped = () => { if (options.signal?.aborted) throw new Error('Write canceled: agent stopped.') }
  return {
    list_directory: tool({
      description: 'List a workspace folder. Paths are relative; excludes secrets and dependencies.',
      inputSchema: z.object({ path: z.string().default('.') }),
      execute: async ({ path }) => {
        const entries = await readdir(await workspaceFile(root, path), { withFileTypes: true })
        return entries.filter((entry) => !privatePath(entry.name))
          .slice(0, 300).map((entry) => ({ name: entry.name, directory: entry.isDirectory() }))
      },
    }),
    read_file: tool({
      description: 'Read a workspace text file (maximum 100 KB).',
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const file = await workspaceFile(root, path)
        const info = await lstat(file)
        if (!info.isFile() || info.nlink > 1 || info.size > 100_000) throw new Error('The file is not a small text file; choose another file.')
        const content = await readFile(file, 'utf8')
        if (content.includes('\0')) throw new Error('Binary file.')
        return content
      },
    }),
    write_file: tool({
      description: options.automatic
        ? 'Automatically create or replace a workspace text file (YOLO mode). Read the file first. The folder must exist. Path and secret restrictions still apply.'
        : 'Propose creating or replacing a text file; explicit user approval is required. The folder must exist. Use write_files for a single review of related changes across files.',
      inputSchema: z.object({ path: z.string(), content: z.string().max(100_000) }),
      execute: async ({ path, content }) => {
        checkStopped()
        if (content.includes('\0') || Buffer.byteLength(content, 'utf8') > 100_000)
          throw new Error('Each file must be text up to 100 KB.')
        const original = await workspaceFile(root, path, true)
        const before = await fingerprint(original)
        if (!(await approve(path, content))) return 'The user rejected the write. The file was not modified.'
        const target = await workspaceFile(root, path, true)
        if (target !== original || before !== (await fingerprint(target)))
          throw new Error('The file changed during the operation. Read it again and propose the change.')
        checkStopped()
        await writeFile(target, content, { encoding: 'utf8', flag: before === undefined ? 'wx' : 'w' })
        await invalidateWorkspaceFiles(root)
        return `File saved: ${path}`
      },
    }),
    write_files: tool({
      description: options.automatic
        ? 'Automatically save a batch of workspace files (YOLO mode). Read the files first and present their full contents. Folders must exist. Path and secret restrictions still apply. Saving is not atomic: report any partial result.'
        : 'Propose a batch of related changes for approval and saving in a single review. Read the necessary files first. Present the full contents of each file. Approval covers only this batch, never future changes. Folders must exist. Saving is not atomic: report any partial result.',
      inputSchema: z.object({ files: z.array(z.object({ path: z.string().min(1), content: z.string().max(100_000) })).min(1).max(20) }),
      execute: async ({ files }): Promise<BatchWriteResult> => {
        checkStopped()
        if (files.reduce((size, file) => size + Buffer.byteLength(file.content, 'utf8'), 0) > 500_000)
          throw new Error('The batch cannot exceed 500 KB.')
        const prepared: { path: string; content: string; target: string; before: string | undefined }[] = []
        const targets = new Set<string>()
        for (const file of files) {
          if (file.content.includes('\0') || Buffer.byteLength(file.content, 'utf8') > 100_000)
            throw new Error('Each file must be text up to 100 KB.')
          const target = await workspaceFile(root, file.path, true)
          if (targets.has(target)) throw new Error('The batch contains duplicate paths.')
          targets.add(target)
          prepared.push({ ...file, target, before: await fingerprint(target) })
        }
        // JSON preserves exact boundaries even if a file contains approval-like text.
        const preview = JSON.stringify({ files: files.map(({ path, content }) => ({ path, content })) }, null, 2)
        if (!(await approve(`Batch of ${files.length} file(s)`, preview)))
          return { saved: [], rejected: true }
        const verify = async (file: typeof prepared[number]) => {
          if (await workspaceFile(root, file.path, true) !== file.target || await fingerprint(file.target) !== file.before)
            throw new Error(`The file ${file.path} changed during the operation. Read it again and propose the batch.`)
        }
        // Validate the whole batch before the first write, then each file again.
        for (const file of prepared) await verify(file)
        const saved: string[] = []
        for (const file of prepared) {
          try {
            await verify(file)
            checkStopped()
            await writeFile(file.target, file.content, { encoding: 'utf8', flag: file.before === undefined ? 'wx' : 'w' })
            saved.push(file.path)
            await invalidateWorkspaceFiles(root)
          } catch {
            return { saved, failed: file.path, notWritten: prepared.slice(saved.length).map((item) => item.path), error: 'The batch was not completed. Files listed in saved were saved; review pending files before retrying.' }
          }
        }
        return { saved }
      },
    }),
  }
}
async function fingerprint(path: string) {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.nlink > 1 || info.size > 100_000) throw new Error('Changes can only be proposed for text files up to 100 KB without hard links.')
    return createHash('sha256').update(await readFile(path)).digest('hex')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

// Short-lived, bounded filename index. Never cache file contents or bypass
// workspaceFile when opening a result. Expiration handles external git/editors.
type FileIndex = { files: { path: string; search: string }[]; truncated: boolean; expires: number }
const fileIndexes = new Map<string, FileIndex>()
type IndexBuild = { controller: AbortController; promise: Promise<FileIndex>; readers: number }
const indexBuilds = new Map<string, IndexBuild>()
export async function invalidateWorkspaceFiles(root: string) {
  const canonical = await realpath(root)
  fileIndexes.delete(canonical)
  // Existing readers may finish, but their obsolete build cannot refill the cache.
  indexBuilds.delete(canonical)
}
async function buildIndex(canonical: string, signal: AbortSignal): Promise<FileIndex> {
    const files: FileIndex['files'] = []
    const pending = ['.']
    let cursor = 0
    let truncated = false
    while (cursor < pending.length && cursor < 500 && files.length < 20_000) {
      signal?.throwIfAborted()
      const path = pending[cursor++]
      let entries
      try {
        entries = await readdir(await workspaceFile(canonical, path), { withFileTypes: true })
      } catch (error) {
        // Directories may disappear during checkout. Never cache an unsafe path.
        if (path === '.') throw error
        continue
      }
      signal?.throwIfAborted()
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const name = path === '.' ? entry.name : `${path}/${entry.name}`
        if (privatePath(name) || entry.isSymbolicLink()) continue
        if (entry.isDirectory() && !['dist', 'build', 'coverage', '.next'].includes(entry.name)) {
          if (pending.length < 1500 && name.split('/').length < 20) pending.push(name)
          else truncated = true
        }
        if (entry.isFile()) files.push({ path: name, search: name.toLowerCase() })
        if (files.length >= 20_000) { truncated = true; break }
      }
    }
    signal?.throwIfAborted()
    return { files, truncated: truncated || cursor < pending.length, expires: Date.now() + 10_000 }
}
async function sharedIndex(canonical: string, signal?: AbortSignal): Promise<FileIndex> {
  signal?.throwIfAborted()
  let build = indexBuilds.get(canonical)
  if (!build) {
    const controller = new AbortController()
    const created: IndexBuild = { controller, readers: 0, promise: undefined! }
    created.promise = buildIndex(canonical, controller.signal).then(index => {
      if (indexBuilds.get(canonical) === created && !controller.signal.aborted) {
        fileIndexes.delete(canonical)
        while (fileIndexes.size >= 8) fileIndexes.delete(fileIndexes.keys().next().value!)
        fileIndexes.set(canonical, index)
      }
      return index
    }).finally(() => {
      if (indexBuilds.get(canonical) === created) indexBuilds.delete(canonical)
    })
    indexBuilds.set(canonical, created)
    build = created
  }
  const current = build
  current.readers++
  try {
    return await new Promise<FileIndex>((resolve, reject) => {
      const aborted = () => reject(signal?.reason ?? new Error('Search canceled'))
      signal?.addEventListener('abort', aborted, { once: true })
      current.promise.then(resolve, reject).finally(() => signal?.removeEventListener('abort', aborted))
    })
  } finally {
    if (--current.readers === 0) {
      if (indexBuilds.get(canonical) === current) indexBuilds.delete(canonical)
      current.controller.abort()
    }
  }
}
export async function listWorkspaceFiles(root: string, query = '', signal?: AbortSignal) {
  signal?.throwIfAborted()
  const canonical = await realpath(root)
  signal?.throwIfAborted()
  const cached = fileIndexes.get(canonical)
  const index = cached && cached.expires > Date.now() ? cached : await sharedIndex(canonical, signal)
  signal?.throwIfAborted()
  const needle = query.toLowerCase()
  const matches: string[] = []
  for (const file of index.files) {
    if (file.search.includes(needle)) matches.push(file.path)
    if (matches.length > 100) break
  }
  return { files: matches.slice(0, 100), truncated: index.truncated || matches.length > 100 }
}
