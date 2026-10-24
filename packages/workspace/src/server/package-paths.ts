import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Source and compiled modules have different depths; locate only this package's
// manifest instead of using the caller's working directory or a peer package.
function findPackageRoot() {
  let directory = dirname(fileURLToPath(import.meta.url))
  while (true) {
    try {
      const manifest: unknown = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
      if (
        manifest &&
        typeof manifest === 'object' &&
        'name' in manifest &&
        manifest.name === '@alfred-labs/workspace'
      )
        return directory
    } catch {
      /* Continue through the package's own parent directories. */
    }
    const parent = dirname(directory)
    if (parent === directory) throw new Error('Cannot locate the Workspace package manifest.')
    directory = parent
  }
}

export const workspacePackageRoot = findPackageRoot()
export const workspaceClientRoot = join(workspacePackageRoot, 'dist', 'client')
