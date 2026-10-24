import { spawn } from 'node:child_process'

export function runProcess(
  command: string,
  args: string[],
  cwd: string,
  limit = 2_000_000,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
) {
  return new Promise<{ stdout: string; stderr: string; code: number; truncated: boolean }>(
    (resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        windowsHide: true,
        shell: false,
        signal: options.signal,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      })
      let stdout = '',
        stderr = '',
        truncated = false
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('The operation timed out.'))
      }, options.timeoutMs ?? 30_000)
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (data: string) => {
        truncated ||= stdout.length + data.length > limit
        stdout = (stdout + data).slice(0, limit)
      })
      child.stderr.on('data', (data: string) => {
        stderr = (stderr + data).slice(0, 8000)
      })
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('close', (code) => {
        clearTimeout(timer)
        resolve({ stdout, stderr, code: code ?? 1, truncated })
      })
    },
  )
}
