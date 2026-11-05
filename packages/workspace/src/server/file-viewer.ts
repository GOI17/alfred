import { open, opendir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { workspaceFile } from './workspace-files.js'
import { privatePath } from './workspace-path-policy.js'
export async function viewerDirectory(root: string, path: string) {
  const entries: { name: string; directory: boolean }[] = []
  let truncated = false
  for await (const entry of await opendir(await workspaceFile(root, path))) {
    if (privatePath(`${path}/${entry.name}`) || entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) continue
    if (entries.length === 500) { truncated = true; break }
    entries.push({ name: entry.name, directory: entry.isDirectory() })
  }
  entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
  return { entries, truncated }
}
export async function viewerFile(root: string, path: string) {
  const file = await open(await workspaceFile(root, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.nlink > 1) throw new Error('Only regular text files are supported.')
    const limit = 1_000_000
    if (info.size > limit) throw new Error('File exceeds the 1 MB viewer limit.')
    const buffer = Buffer.alloc(limit + 1)
    let size = 0
    while (size <= limit) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, size)
      if (!bytesRead) break
      size += bytesRead
    }
    if (size > limit) throw new Error('File exceeds the 1 MB viewer limit.')
    const bytes = buffer.subarray(0, size)
    if (bytes.includes(0)) throw new Error('Binary files cannot be previewed.')
    try { return { content: new TextDecoder('utf-8', { fatal: true }).decode(bytes) } }
    catch { throw new Error('Only UTF-8 text files can be previewed.') }
  } finally { await file.close() }
}
