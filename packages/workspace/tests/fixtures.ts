import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runProcess } from '../src/shared/child-process/run-process.js'

export async function gitFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'alfred-test-')))
  const repository = join(root, 'project with spaces')
  await mkdir(repository)
  const git = async (...args: string[]) => {
    const result = await runProcess('git', args, repository)
    if (result.code) throw new Error(result.stderr)
    return result.stdout
  }
  await git('init')
  await git('symbolic-ref', 'HEAD', 'refs/heads/main')
  await git('config', 'user.name', 'Alfred Test')
  await git('config', 'user.email', 'test@example.invalid')
  await writeFile(join(repository, 'hello.txt'), 'hello\n')
  await git('add', '.')
  await git('commit', '-m', 'The first idea')
  return { root, repository, git }
}
