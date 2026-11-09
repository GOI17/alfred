import { realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep, parse } from 'node:path'
import { listWorkspaceFiles, workspaceFile } from './workspace-files.js'
import { privatePath } from './workspace-path-policy.js'

function inside(root: string, target: string) {
  const path = relative(root, target)
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

// Owned by one application instance. Grants are never persisted or shared across conversations.
export class ExternalFiles {
  private grants = new Map<string, Set<string>>()
  private key(id: string, root: string) { return JSON.stringify([id, resolve(root)]) }
  revoke(id: string, root: string, folder: string) {
    const key = this.key(id, root)
    const grants = this.grants.get(key)
    grants?.delete(folder)
    if (!grants?.size) this.grants.delete(key)
  }
  clear(id: string) {
    for (const key of this.grants.keys()) if (JSON.parse(key)[0] === id) this.grants.delete(key)
  }
  async authorize(id: string, root: string, folder: string) {
    const target = resolve(root, folder)
    // Do not grant filesystem roots or ancestors of the workspace.
    if (target === parse(target).root || inside(target, resolve(root)) || privatePath(target))
      throw new Error('Choose a specific, non-private external folder.')
    const canonical = await realpath(target)
    if (canonical !== target || privatePath(canonical) || inside(canonical, await realpath(root)))
      throw new Error('Choose the canonical external folder, not a symbolic link.')
    if (!(await stat(canonical)).isDirectory()) throw new Error('Choose a folder.')
    const key = this.key(id, root)
    const grants = this.grants.get(key) ?? new Set<string>()
    if (grants.size >= 20 && !grants.has(canonical)) throw new Error('Revoke a folder before adding another.')
    grants.add(canonical)
    this.grants.set(key, grants)
  }
  private granted(id: string, root: string, target: string) {
    return [...(this.grants.get(this.key(id, root)) ?? [])].find(folder => inside(folder, target))
  }
  async readPath(id: string, root: string, path: string) {
    const target = resolve(root, path)
    if (inside(resolve(root), target)) return workspaceFile(root, relative(resolve(root), target))
    const folder = this.granted(id, root, target)
    if (!folder || privatePath(target)) throw new Error('External folder requires explicit read authorization.')
    if (await realpath(folder) !== folder) throw new Error('Authorized folder changed; authorize it again.')
    const file = await workspaceFile(folder, relative(folder, target))
    if (!this.granted(id, root, target)) throw new Error('External read authorization was revoked.')
    return file
  }
  async search(id: string, root: string, query: string, signal?: AbortSignal) {
    const target = resolve(root, query || '.')
    if (inside(resolve(root), target)) return listWorkspaceFiles(root, query, signal)
    if (privatePath(target)) throw new Error('Private paths cannot be referenced.')
    const folder = this.granted(id, root, target)
    if (!folder) {
      // Purely lexical: do not inspect or list any external folder before consent.
      const candidate = /[\\/]$/.test(query) ? target : dirname(target)
      return { files: [], truncated: false, authorization: {
        folder: candidate, chooseFolder: candidate === parse(candidate).root || inside(candidate, resolve(root)),
      } }
    }
    if (await realpath(folder) !== folder) throw new Error('Authorized folder changed; authorize it again.')
    const result = await listWorkspaceFiles(folder, relative(folder, target).split(sep).join('/'), signal)
    if (!this.granted(id, root, target)) throw new Error('External read authorization was revoked.')
    return { ...result, files: result.files.map(path => relative(resolve(root), resolve(folder, path)).split(sep).join('/')), authorizedFolder: folder }
  }
}
