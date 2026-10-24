import { constants } from 'node:fs'
import { access, lstat, open, readdir, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { parse as parseJson, type ParseError } from 'jsonc-parser'
import { parseDocument } from 'yaml'
import { privatePath } from './workspace-path-policy.js'

export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
export const string = (value: unknown) => typeof value === 'string' ? value : ''
export const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
export function inside(root: string, path: string) {
  const part = relative(root, path)
  return part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}
export async function exists(path: string) {
  try { await access(path); return true } catch { return false }
}
export async function executable(name: string, path: string, platform = process.platform) {
  for (const directory of path.split(platform === 'win32' ? ';' : ':').filter(isAbsolute)) {
    for (const suffix of platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']) {
      const file = resolve(directory, name + suffix)
      try { await access(file, constants.X_OK); if ((await lstat(await realpath(file))).isFile()) return file } catch { /* Not installed here. */ }
    }
  }
}

/** Only known resource roots are readable. Workspace symlinks cannot escape their checkout. */
export class HarnessFiles {
  issues: { source: string; message: string }[] = []
  private bytes = 0
  private visited = 0
  constructor(private allowed: string[]) {}
  issue(source: string, message: string) {
    if (this.issues.length < 100 && !this.issues.some((item) => item.source === source && item.message === message)) this.issues.push({ source, message })
  }
  async canonical(path: string, boundary: string) {
    const target = await realpath(path)
    const canonicalBoundary = await realpath(boundary)
    if (!inside(canonicalBoundary, target) || privatePath(relative(canonicalBoundary, target))) throw new Error('Resource link leaves its allowed folder.')
    if (!this.allowed.some((root) => inside(root, target))) throw new Error('Resource outside the configured roots.')
    return target
  }
  async read(path: string, boundary: string, max = 200_000): Promise<string | undefined> {
    let file
    try {
      const canonical = await this.canonical(path, boundary)
      if (basename(canonical) !== basename(path)) throw new Error('Resource file links must preserve the file name.')
      file = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW)
      const info = await file.stat()
      if (!info.isFile() || info.nlink > 1 || info.size > max) throw new Error('Resource must be a text file within the size limit, without hard links.')
      if (this.bytes + info.size > 4_000_000) throw new Error('Resource scan reached its 4 MB limit.')
      this.bytes += info.size
      const buffer = Buffer.alloc(max + 1)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      if (bytesRead > max) throw new Error('Resource exceeds the size limit.')
      const text = buffer.subarray(0, bytesRead).toString('utf8')
      if (text.includes('\0')) throw new Error('Resource is not text.')
      return text
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) this.issue(path, error instanceof Error && !('code' in error) ? error.message : 'Resource cannot be read.')
    } finally { await file?.close() }
  }
  async config(path: string, boundary: string) {
    const text = await this.read(path, boundary, 1_000_000)
    if (text === undefined) return
    try {
      if (path.endsWith('.toml')) return record(parseToml(text))
      const errors: ParseError[] = []
      const value: unknown = parseJson(text, errors, { allowTrailingComma: true })
      if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
      return record(value)
    } catch { this.issue(path, 'Invalid configuration syntax. Correct the file and refresh.'); return }
  }
  async walk(root: string, boundary: string, match: (name: string) => boolean): Promise<string[]> {
    const found: string[] = [], pending = [{ path: root, depth: 0 }], seen = new Set<string>()
    while (pending.length) {
      const next = pending.shift()!
      if (++this.visited > 3000 || found.length >= 500) { this.issue(root, 'Resource scan limit reached; some resources were omitted.'); break }
      try {
        const path = await this.canonical(next.path, boundary)
        if (seen.has(path)) continue
        seen.add(path)
        const info = await lstat(path)
        if (info.isFile()) { if (match(basename(next.path))) found.push(next.path); continue }
        if (!info.isDirectory()) continue
        for (const item of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
          if (privatePath(item.name) || ['dist', '.cache', 'sessions', 'history'].includes(item.name)) continue
          if (next.depth < 8) pending.push({ path: resolve(next.path, item.name), depth: next.depth + 1 })
          else this.issue(root, 'Resource scan depth limit reached.')
        }
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) this.issue(next.path, 'Resource folder is unreadable or links outside its allowed scope.')
      }
    }
    return found
  }
}
export function markdown(text: string): { metadata: Record<string, unknown>; body: string } {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!match) return { metadata: {}, body: text.trim() }
  const document = parseDocument(match[1], { uniqueKeys: true })
  if (document.errors.length) throw new Error('Invalid YAML frontmatter.')
  return { metadata: record(document.toJS({ maxAliasCount: 20 })), body: text.slice(match[0].length).trim() }
}
