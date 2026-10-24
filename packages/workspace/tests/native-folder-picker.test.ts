import { expect, it, vi } from 'vitest'
import { pickNativeFolder } from '../src/server/native-folder-picker.js'
import { runProcess } from '../src/shared/child-process/run-process.js'

const result = { stdout: '', stderr: '', code: 0, truncated: false }
it('refuses desktop dialogs in background, SSH and headless sessions before starting a process', async () => {
  const run = vi.fn<typeof runProcess>()
  for (const environment of [{ ORCA_BACKGROUND_LAUNCH: '1' }, { SSH_CONNECTION: 'host' }, {}]) {
    await expect(
      pickNativeFolder(new AbortController().signal, { platform: 'linux', environment, run }),
    ).rejects.toThrow()
  }
  expect(run).not.toHaveBeenCalled()
})
it('preserves spaces and Unicode paths and treats native cancellation as no selection', async () => {
  const run = vi.fn<typeof runProcess>()
  const options = { platform: 'darwin' as const, environment: {}, run }
  run.mockResolvedValue({ ...result, stdout: '/Users/test/Proyecto José  \n' })
  expect(await pickNativeFolder(new AbortController().signal, options)).toBe(
    '/Users/test/Proyecto José  ',
  )
  run.mockResolvedValue({ ...result, stdout: '\n' })
  expect(await pickNativeFolder(new AbortController().signal, options)).toBeNull()
  run.mockResolvedValue({ ...result, stdout: 'not an absolute path\n' })
  await expect(pickNativeFolder(new AbortController().signal, options)).rejects.toThrow('valid')
  run.mockResolvedValue({ ...result, code: 1 })
  await expect(pickNativeFolder(new AbortController().signal, options)).rejects.toThrow(
    'Could not',
  )
})
it('accepts native Windows folder results and Linux cancellation', async () => {
  const run = vi
    .fn<typeof runProcess>()
    .mockResolvedValue({ ...result, stdout: 'C:\\Users\\José\\My project' })
  expect(
    await pickNativeFolder(new AbortController().signal, {
      platform: 'win32',
      environment: {},
      run,
    }),
  ).toBe('C:\\Users\\José\\My project')
  run.mockResolvedValue({ ...result, code: 1 })
  expect(
    await pickNativeFolder(new AbortController().signal, {
      platform: 'linux',
      environment: { DISPLAY: ':99' },
      run,
    }),
  ).toBeNull()
})
it('falls back to the other Linux native dialog only when the first executable is absent', async () => {
  const run = vi
    .fn<typeof runProcess>()
    .mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'ENOENT' }))
    .mockResolvedValueOnce({ ...result, stdout: '/home/test/project\n' })
  const options = { platform: 'linux' as const, environment: { DISPLAY: ':99' }, run }
  expect(await pickNativeFolder(new AbortController().signal, options)).toBe('/home/test/project')
  expect(run.mock.calls.map(([command]) => command)).toEqual(['zenity', 'kdialog'])
  run.mockReset().mockResolvedValue({ ...result, code: 2 })
  await expect(pickNativeFolder(new AbortController().signal, options)).rejects.toThrow()
  expect(run).toHaveBeenCalledTimes(1)
})
it('honors cancellation before launch and terminates a running child on abort', async () => {
  const controller = new AbortController()
  controller.abort()
  const run = vi.fn<typeof runProcess>()
  await expect(
    pickNativeFolder(controller.signal, { platform: 'darwin', environment: {}, run }),
  ).rejects.toThrow()
  expect(run).not.toHaveBeenCalled()
  const running = new AbortController()
  const child = runProcess(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    process.cwd(),
    1000,
    { signal: running.signal },
  )
  running.abort()
  await expect(child).rejects.toMatchObject({ name: 'AbortError' })
})
