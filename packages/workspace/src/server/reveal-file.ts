import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { WorkspaceService } from './service.js'

const run = promisify(execFile)

export async function revealTarget(root: string, path: string) {
  const base = await realpath(root)
  const target = await realpath(resolve(base, path))
  const within = relative(base, target)
  if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within))
    throw new Error('The file must be inside this conversation’s workspace.')
  return { path: target, directory: (await stat(target)).isDirectory() }
}

export function revealFileRoutes(app: FastifyInstance, service: WorkspaceService) {
  app.post('/api/conversations/:id/files/reveal', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { path } = z.object({ path: z.string().min(1).max(4000).refine((value) => !/[\x00-\x1f]/.test(value)) }).parse(request.body)
    const root = await service.workspace(service.conversation(id))
    const target = await revealTarget(root, path)
    const options = { timeout: 10_000, maxBuffer: 64_000, windowsHide: true }
    // Fixed executables and argument arrays: paths are never interpreted by a shell.
    try {
      if (process.platform === 'darwin') {
        await run('/usr/bin/open', target.directory ? [target.path] : ['-R', target.path], options)
      } else if (process.platform === 'win32') {
        await run('explorer.exe', target.directory ? [target.path] : [`/select,${target.path}`], options)
      } else {
        await run('xdg-open', [pathToFileURL(target.directory ? target.path : dirname(target.path)).href], options)
      }
    } catch {
      throw new Error('Could not open the file explorer on the server. A desktop session is required.')
    }
    return { ok: true }
  })
}
