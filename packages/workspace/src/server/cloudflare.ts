import { spawn, type ChildProcess } from 'node:child_process'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

export interface TunnelConfig { origin: string; name: string; configPath: string }
export function tunnelConfig(env: NodeJS.ProcessEnv): TunnelConfig | undefined {
  const origin = env.ALFRED_PUBLIC_ORIGIN
  const name = env.ALFRED_CLOUDFLARE_TUNNEL
  const configPath = env.ALFRED_CLOUDFLARE_CONFIG
  if (!origin && !name && !configPath) return undefined
  if (!origin || !name || !configPath) throw new Error('Configure ALFRED_PUBLIC_ORIGIN, ALFRED_CLOUDFLARE_TUNNEL, and ALFRED_CLOUDFLARE_CONFIG.')
  const url = new URL(origin)
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password)
    throw new Error('ALFRED_PUBLIC_ORIGIN must be an HTTPS origin without a path or credentials.')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(name)) throw new Error('Invalid tunnel name.')
  return { origin, name, configPath }
}

export class CloudflareTunnel {
  private child?: ChildProcess
  private stopping?: Promise<void>
  private state: 'disabled' | 'stopped' | 'connecting' | 'connected' | 'stopping' | 'error'
  private error?: string
  constructor(private config?: TunnelConfig, private launch: typeof spawn = spawn) {
    this.state = config ? 'stopped' : 'disabled'
  }
  status() { return { state: this.state, url: this.config?.origin, error: this.error } }
  start() {
    if (!this.config) throw new Error('Configure the Cloudflare tunnel on the server before connecting it.')
    if (this.stopping) throw new Error('Wait for disconnection to finish.')
    if (this.child) return this.status()
    this.error = undefined
    this.state = 'connecting'
    const child = this.launch('cloudflared', ['tunnel', '--config', this.config.configPath, '--no-autoupdate', 'run', this.config.name], { stdio: ['ignore', 'ignore', 'pipe'], shell: false })
    this.child = child
    let tail = ''
    const timer = setTimeout(() => {
      if (this.child !== child || this.state !== 'connecting') return
      this.error = 'The tunnel did not confirm connection within 30 seconds. Disconnect and check its local configuration.'
      this.state = 'error'
    }, 30_000)
    timer.unref()
    child.stderr?.on('data', (chunk: Buffer) => {
      // Never publish cloudflared logs: they may contain sensitive configuration.
      tail = (tail + chunk.toString()).slice(-8192)
      if (this.child === child && this.state !== 'stopping' && /Registered tunnel connection/.test(tail)) {
        clearTimeout(timer)
        this.state = 'connected'
        this.error = undefined
        tail = ''
      }
    })
    child.once('error', () => {
      clearTimeout(timer)
      if (this.child !== child) return
      this.state = 'error'
      this.error = 'Could not run cloudflared. Check its installation and local configuration.'
    })
    child.once('close', () => {
      clearTimeout(timer)
      if (this.child !== child) return
      this.child = undefined
      if (this.state === 'stopping') this.state = 'stopped'
      else {
        this.state = 'error'
        this.error ||= 'The tunnel process ended. Check the local configuration before reconnecting.'
      }
    })
    return this.status()
  }
  async stop() {
    if (this.stopping) return this.stopping
    const child = this.child
    if (!child) { this.state = this.config ? 'stopped' : 'disabled'; this.error = undefined; return }
    this.state = 'stopping'
    this.stopping = new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
      timer.unref()
      child.once('close', () => { clearTimeout(timer); this.error = undefined; resolve() })
      child.kill('SIGTERM')
    })
    try { await this.stopping } finally { this.stopping = undefined }
  }
}

export function cloudflareRoutes(app: FastifyInstance, config?: TunnelConfig) {
  const tunnel = new CloudflareTunnel(config)
  app.get('/api/connection/tunnel', async () => tunnel.status())
  app.post('/api/connection/tunnel', async (request) => {
    z.object({ confirmed: z.literal(true) }).parse(request.body)
    return tunnel.start()
  })
  app.delete('/api/connection/tunnel', async () => { await tunnel.stop(); return tunnel.status() })
  app.addHook('onClose', async () => tunnel.stop())
}
