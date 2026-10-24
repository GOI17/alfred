import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn, type ChildProcess } from 'node:child_process'
import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { authentication } from '../src/server/auth.js'
import { CloudflareTunnel, cloudflareRoutes, tunnelConfig } from '../src/server/cloudflare.js'

const config = { origin: 'https://alfredworkspace.alfredlabs.org', name: 'alfred-workspace', configPath: '/local/config.yml' }
describe('Cloudflare connection', () => {
  it('requires complete explicit configuration and HTTPS', () => {
    expect(tunnelConfig({})).toBeUndefined()
    expect(() => tunnelConfig({ ALFRED_PUBLIC_ORIGIN: config.origin })).toThrow()
    expect(() => tunnelConfig({ ALFRED_PUBLIC_ORIGIN: 'http://example.com', ALFRED_CLOUDFLARE_TUNNEL: config.name, ALFRED_CLOUDFLARE_CONFIG: config.configPath })).toThrow()
    expect(() => new CloudflareTunnel().start()).toThrow()
  })
  it('launches only once, observes readiness and terminates explicitly', async () => {
    const child = Object.assign(new EventEmitter(), { stderr: new PassThrough(), kill: vi.fn(() => { queueMicrotask(() => child.emit('close', 0)); return true }) })
    const launch = vi.fn(() => child as unknown as ChildProcess)
    const tunnel = new CloudflareTunnel(config, launch as unknown as typeof spawn)
    expect(tunnel.status().state).toBe('stopped')
    expect(launch).not.toHaveBeenCalled()
    expect(tunnel.start().state).toBe('connecting')
    tunnel.start()
    expect(launch).toHaveBeenCalledTimes(1)
    child.stderr.write('Registered tunnel connection')
    expect(tunnel.status().state).toBe('connected')
    await tunnel.stop()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(tunnel.status().state).toBe('stopped')
  })
  it('protects routes and accepts only the configured public origin with secure cookies', async () => {
    const app = Fastify()
    await authentication(app, 'test-code', config.origin)
    cloudflareRoutes(app)
    try {
      expect((await app.inject({ url: '/api/connection/tunnel' })).statusCode).toBe(401)
      const login = await app.inject({ method: 'POST', url: '/api/auth', headers: { host: 'alfredworkspace.alfredlabs.org', origin: config.origin }, payload: { code: 'test-code' } })
      expect(login.statusCode).toBe(200)
      expect(login.headers['set-cookie']).toContain('Secure')
      const cookie = String(login.headers['set-cookie']).split(';')[0]
      const headers = { host: 'alfredworkspace.alfredlabs.org', origin: config.origin, cookie }
      expect((await app.inject({ url: '/api/connection/tunnel', headers })).json().state).toBe('disabled')
      expect((await app.inject({ url: '/api/connection/tunnel', headers: { ...headers, origin: 'https://attacker.example' } })).statusCode).toBe(403)
      expect((await app.inject({ method: 'POST', url: '/api/connection/tunnel', headers, payload: { confirmed: false } })).statusCode).not.toBe(200)
    } finally { await app.close() }
  })
})
