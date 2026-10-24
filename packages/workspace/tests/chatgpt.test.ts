import { afterEach, expect, it, vi } from 'vitest'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { readFile, rm } from 'node:fs/promises'
import { WorkspaceService } from '../src/server/service.js'
import { gitFixture } from './fixtures.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})
async function setup() {
  const files = await gitFixture()
  cleanup.push(() => rm(files.root, { recursive: true, force: true }))
  const service = await WorkspaceService.open(join(files.root, 'data'))
  cleanup.push(() => service.close())
  return { ...files, service }
}
it('uses stable host registration, loopback callbacks and fresh PKCE, and rejects invalid state', async () => {
  const { service } = await setup()
  const first = new URL((await service.chatgpt.start()).url)
  expect(first.origin).toBe('https://auth.openai.com')
  expect(first.searchParams.get('client_id')).toBe('dynamic_agent_client')
  expect(first.searchParams.get('agent_name_hint')).toBe('Alfred Workspace')
  const callback = new URL(first.searchParams.get('redirect_uri') || '')
  expect(callback.hostname).toBe('127.0.0.1')
  callback.searchParams.set('state', 'invalid')
  expect((await fetch(callback)).status).toBe(400)
  expect(service.chatgpt.state().accounts).toHaveLength(0)
  service.chatgpt.close()
  const second = new URL((await service.chatgpt.start()).url)
  expect(second.searchParams.get('ext_agent_host_id')).toBe(
    first.searchParams.get('ext_agent_host_id'),
  )
  expect(second.searchParams.get('code_challenge')).not.toBe(
    first.searchParams.get('code_challenge'),
  )
})
it.each(['valid', 'wrong-nonce', 'wrong-audience', 'expired'])(
  'verifies identity (%s), protects tokens, refreshes and signs out',
  async (scenario) => {
    const { service, root } = await setup()
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const jwk = await exportJWK(publicKey)
    const auth = new URL((await service.chatgpt.start()).url)
    const idToken = await new SignJWT({
      nonce: scenario === 'wrong-nonce' ? 'incorrect' : auth.searchParams.get('nonce'),
      email: 'person@example.invalid',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer('https://auth.openai.com')
      .setAudience(scenario === 'wrong-audience' ? 'other-app' : 'oaiapp_test')
      .setSubject('test-subject')
      .setExpirationTime(scenario === 'expired' ? Math.floor(Date.now() / 1000) - 60 : '5m')
      .sign(privateKey)
    const originalFetch = globalThis.fetch
    let refreshes = 0,
      revoked = false
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url.startsWith('http://127.0.0.1')) return originalFetch(input, init)
      if (url.endsWith('openid-configuration'))
        return Response.json({
          issuer: 'https://auth.openai.com',
          jwks_uri: 'https://auth.openai.com/test-jwks',
          revocation_endpoint: 'https://auth.openai.com/test-revoke',
        })
      if (url.endsWith('test-jwks'))
        return Response.json({ keys: [{ ...jwk, kid: 'test', alg: 'RS256', use: 'sig' }] })
      if (url.endsWith('oauth/token')) {
        const body = new URLSearchParams(
          typeof init?.body === 'string'
            ? init.body
            : init?.body instanceof URLSearchParams
              ? init.body
              : '',
        )
        expect(body.get('client_id')).toBe('oaiapp_test')
        if (body.get('grant_type') === 'refresh_token') refreshes++
        else
          expect(
            createHash('sha256')
              .update(body.get('code_verifier') || '')
              .digest('base64url'),
          ).toBe(auth.searchParams.get('code_challenge'))
        return Response.json({
          access_token: 'test-private-access',
          refresh_token: 'test-private-refresh',
          id_token: idToken,
          token_type: 'Bearer',
          expires_in: refreshes ? 3600 : 1,
          scope: 'openid chatgpt.tokens.use.direct',
        })
      }
      if (url.endsWith('/models'))
        return Response.json({
          models: [
            { slug: 'test-model', display_name: 'Test model', visibility: 'list' },
            { slug: 'hidden-model', display_name: 'Hidden', visibility: 'hide' },
          ],
        })
      if (url.endsWith('test-revoke')) {
        revoked = true
        return new Response(null, { status: 200 })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const callback = new URL(auth.searchParams.get('redirect_uri') || '')
    callback.searchParams.set('state', auth.searchParams.get('state') || '')
    callback.searchParams.set('code', 'test-code')
    callback.searchParams.set('client_id', 'oaiapp_test')
    const callbackResponse = await fetch(callback)
    if (scenario !== 'valid') {
      expect(callbackResponse.status).toBe(400)
      expect(service.chatgpt.state().accounts).toHaveLength(0)
      return
    }
    expect(callbackResponse.status).toBe(200)
    expect(service.chatgpt.state().accounts[0].email).toBe('person@example.invalid')
    const accountId = service.chatgpt.state().active
    if (!accountId) throw new Error('Missing active account')
    const [models] = await Promise.all([service.chatgpt.models(), service.chatgpt.models()])
    expect(models.map((model) => model.slug)).toEqual(['test-model'])
    expect(refreshes).toBe(1)
    await service.chatgpt.select(accountId, 'test-model')
    expect(service.state().providers).toContainEqual({ id: 'chatgpt', model: 'test-model' })
    expect(JSON.stringify(service.state())).not.toContain('test-private')
    expect(await readFile(join(root, 'data', 'workspace.json'), 'utf8')).not.toContain(
      'test-private',
    )
    expect((await service.chatgpt.disconnect(accountId)).revoked).toBe(true)
    expect(revoked).toBe(true)
    expect(service.chatgpt.state().accounts[0].connected).toBe(false)
    const reauth = new URL((await service.chatgpt.start(accountId)).url)
    expect(reauth.searchParams.get('client_id')).toBe('oaiapp_test')
    expect(reauth.searchParams.has('id_token_hint')).toBe(false)
  },
)
