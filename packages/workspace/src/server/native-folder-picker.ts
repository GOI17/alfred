import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import { runProcess } from '../shared/child-process/run-process.js'

const macScript = `try
  return POSIX path of (choose folder with prompt "Select the project folder for Alfred" without multiple selections allowed)
on error number -128
  return ""
end try`
const windowsScript = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$shell = New-Object -ComObject Shell.Application
$folder = $shell.BrowseForFolder(0, 'Select the project folder for Alfred', 65)
if ($null -ne $folder) { [Console]::Write($folder.Self.Path) }
`

export async function pickNativeFolder(
  signal: AbortSignal,
  options: {
    platform?: NodeJS.Platform
    environment?: NodeJS.ProcessEnv
    run?: typeof runProcess
  } = {},
): Promise<string | null> {
  const platform = options.platform ?? process.platform
  const environment = options.environment ?? process.env
  const run = options.run ?? runProcess
  if (environment.ORCA_BACKGROUND_LAUNCH === '1')
    throw new Error(
      'The native picker cannot open in test or background mode. Start Alfred normally with pnpm dev or pnpm start.',
    )
  if (environment.SSH_CONNECTION || environment.SSH_TTY)
    throw new Error(
      'Open Alfred in a desktop session on the project computer to use the native picker.',
    )
  if (platform === 'linux' && !environment.DISPLAY && !environment.WAYLAND_DISPLAY)
    throw new Error(
      'The native picker requires a desktop session on the computer running Alfred.',
    )
  const linuxDialogs = environment.XDG_CURRENT_DESKTOP?.toLowerCase().includes('kde')
    ? ['kdialog', 'zenity']
    : ['zenity', 'kdialog']
  const commands =
    platform === 'darwin'
      ? [{ command: '/usr/bin/osascript', args: ['-e', macScript] }]
      : platform === 'win32'
        ? [
            {
              command: 'powershell.exe',
              args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-Command', windowsScript],
            },
          ]
        : platform === 'linux'
          ? linuxDialogs.map((command) => ({
              command,
              args:
                command === 'kdialog'
                  ? ['--title', 'Alfred Workspace', '--getexistingdirectory', homedir()]
                  : [
                      '--file-selection',
                      '--directory',
                      '--title=Select the project folder for Alfred',
                    ],
            }))
          : []
  if (!commands.length)
    throw new Error('The native picker is not available on this operating system.')
  for (const { command, args } of commands) {
    signal.throwIfAborted()
    try {
      const result = await run(command, args, homedir(), 32768, { signal, timeoutMs: 300_000 })
      if (platform === 'linux' && result.code === 1 && !/cannot open display/i.test(result.stderr))
        return null
      if (result.code !== 0 || result.truncated)
        throw new Error(
          'Could not open the native folder picker. Make sure Alfred is running in a desktop session.',
        )
      const path = result.stdout.replace(/\r?\n$/, '')
      if (!path) return null
      if (!(platform === 'win32' ? win32 : posix).isAbsolute(path))
        throw new Error('The picker did not return a valid system folder.')
      return path
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT' &&
        platform === 'linux'
      )
        continue
      throw error
    }
  }
  throw new Error(
    'Install Zenity or KDialog on the computer running Alfred to use the native folder picker.',
  )
}
