import { createRequire } from 'node:module'
import process from 'node:process'
import { chmod, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

if (process.platform !== 'win32') {
  const require = createRequire(import.meta.url)
  const root = dirname(require.resolve('node-pty/package.json'))
  for (const path of [
    join(root, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
    join(root, 'build', 'Release', 'spawn-helper'),
  ]) {
    try {
      const info = await stat(path)
      // node-pty 1.1 ships a helper without its executable bit on some platforms.
      if (!(info.mode & 0o100)) await chmod(path, info.mode | 0o111)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
  }
}
