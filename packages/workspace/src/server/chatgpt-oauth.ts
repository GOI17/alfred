import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { z } from 'zod'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import type { Store } from './store.js'
import type { Vault } from './vault.js'

const issuer = 'https://auth.openai.com'
const resource = 'https://api.openai.com/v1'
const tokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
  token_type: z.string(),
})
const savedTokens = tokenSchema.extend({ expiresAt: z.number() })
const discoverySchema = z.object({
  issuer: z.literal(issuer),
  jwks_uri: z.url(),
  revocation_endpoint: z.url(),
})
type Account = ReturnType<Store['get']>['chatgptAccounts'][number]
export class ChatgptOAuth {
  private listener?: Server
  private timer?: ReturnType<typeof setTimeout>
  private error?: string
  private refreshes = new Map<string, Promise<z.infer<typeof savedTokens>>>()
  constructor(
    private store: Store,
    private vault: Vault,
    private changed: () => void,
  ) {}
  state() {
    const data = this.store.get()
    return {
      accounts: data.chatgptAccounts.map((account) => ({
        id: account.id,
        email: account.email,
        label: `${account.email} · ${account.clientId.slice(-8)}`,
        connected: Boolean(account.encryptedTokens),
        model: account.model,
        welcomed: account.welcomed,
      })),
      active: data.activeChatgptAccount,
      error: this.error,
    }
  }
  private account(id?: string) {
    const data = this.store.get()
    const account = data.chatgptAccounts.find(
      (item) => item.id === (id || data.activeChatgptAccount),
    )
    if (!account) throw new Error('Connect a ChatGPT account.')
    return account
  }
  private async postTokens(body: Record<string, string>) {
    const response = await fetch(`${issuer}/api/accounts/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok)
      throw new Error('ChatGPT could not authorize the session. Reconnect your account.')
    const tokens = tokenSchema.parse(await response.json())
    if (tokens.token_type.toLowerCase() !== 'bearer')
      throw new Error('Tipo de credencial no compatible.')
    return { ...tokens, expiresAt: Date.now() + tokens.expires_in * 1000 }
  }
  async start(accountId?: string) {
    if (this.listener)
      throw new Error(
        'Authorization is already in progress. Complete it or wait for it to expire before starting another.',
      )
    this.error = undefined
    const account = accountId ? this.account(accountId) : undefined
    const existing = account?.encryptedTokens
      ? savedTokens.parse(JSON.parse(this.vault.decrypt(account.encryptedTokens)))
      : undefined
    let hostId = this.store.get().hostId
    if (!hostId) {
      hostId = `urn:uuid:${randomUUID()}`
      await this.store.update((db) => {
        db.hostId ??= hostId
      })
      hostId = this.store.get().hostId
    }
    if (!hostId) throw new Error('Could not prepare the server.')
    const state = randomBytes(32).toString('base64url'),
      nonce = randomBytes(32).toString('base64url'),
      verifier = randomBytes(32).toString('base64url')
    let callback = '',
      consumed = false
    const listener = createServer((request, reply) => {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      reply.setHeader('Referrer-Policy', 'no-referrer')
      reply.setHeader('Cache-Control', 'no-store')
      reply.setHeader('Content-Type', 'text/plain; charset=utf-8')
      if (
        url.pathname !== '/auth/callback' ||
        url.searchParams.get('state') !== state ||
        consumed
      ) {
        reply.writeHead(400)
        reply.end('Invalid authorization request.')
        return
      }
      consumed = true
      void (async () => {
        if (url.searchParams.has('error'))
          throw new Error('Authorization canceled. You can continue using an API key.')
        const code = url.searchParams.get('code'),
          clientId = url.searchParams.get('client_id') || account?.clientId
        if (
          !code ||
          !clientId ||
          clientId === 'dynamic_agent_client' ||
          (account && clientId !== account.clientId)
        )
          throw new Error('Registro incompleto o cuenta no coincidente.')
        const tokens = await this.postTokens({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          code_verifier: verifier,
          redirect_uri: callback,
          resource,
        })
        if (!tokens.id_token || !tokens.scope?.split(' ').includes('chatgpt.tokens.use.direct'))
          throw new Error('Permission to use the ChatGPT plan was not granted.')
        const discovery = discoverySchema.parse(
          await (
            await fetch(`${issuer}/.well-known/openid-configuration`, {
              signal: AbortSignal.timeout(15_000),
            })
          ).json(),
        )
        const { payload } = await jwtVerify(
          tokens.id_token,
          createRemoteJWKSet(new URL(discovery.jwks_uri)),
          { issuer, audience: clientId, requiredClaims: ['exp', 'sub', 'nonce'] },
        )
        if (payload.nonce !== nonce || !payload.sub || (account && payload.sub !== account.subject))
          throw new Error('The ChatGPT identity does not match the authorization.')
        const email = typeof payload.email === 'string' ? payload.email : 'Cuenta ChatGPT'
        await this.store.update((db) => {
          const found = db.chatgptAccounts.find(
            (item) => item.clientId === clientId && item.subject === payload.sub,
          )
          const next = {
            id: found?.id || randomUUID(),
            clientId,
            subject: payload.sub || '',
            email,
            encryptedTokens: this.vault.encrypt(JSON.stringify(tokens)),
            model: found?.model || '',
            welcomed: found?.welcomed || false,
          }
          db.chatgptAccounts = [...db.chatgptAccounts.filter((item) => item.id !== next.id), next]
          db.activeChatgptAccount = next.id
        })
        reply.end('ChatGPT connected to Alfred. You can close this tab and return to your workspace.')
        this.changed()
      })()
        .catch((error) => {
          this.error = error instanceof Error ? error.message : 'Could not connect ChatGPT.'
          reply.writeHead(400)
          reply.end(this.error)
          this.changed()
        })
        .finally(() => this.close())
    })
    this.listener = listener
    await new Promise<void>((resolve, reject) => {
      listener.once('error', reject)
      listener.listen(0, '127.0.0.1', resolve)
    })
    const address = listener.address()
    if (!address || typeof address === 'string')
      throw new Error('Could not open the authorization callback.')
    callback = `http://127.0.0.1:${address.port}/auth/callback`
    this.timer = setTimeout(() => {
      this.close()
      this.error = 'Authorization expired. Try again.'
      this.changed()
    }, 10 * 60_000)
    const url = new URL(`${issuer}/api/accounts/authorize`)
    const parameters: Record<string, string> = {
      client_id: account?.clientId || 'dynamic_agent_client',
      ext_agent_host_id: hostId,
      response_type: 'code',
      redirect_uri: callback,
      scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
      resource,
      state,
      nonce,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    }
    if (!account) parameters.agent_name_hint = 'Alfred Workspace'
    if (existing?.id_token) parameters.id_token_hint = existing.id_token
    if (account?.email) parameters.login_hint = account.email
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value)
    return { url: url.href }
  }
  private async tokens(account: Account) {
    if (!account.encryptedTokens) throw new Error('Reconnect your ChatGPT account.')
    const current = savedTokens.parse(JSON.parse(this.vault.decrypt(account.encryptedTokens)))
    if (current.expiresAt > Date.now() + 60_000) return current
    const pending = this.refreshes.get(account.id)
    if (pending) return pending
    const refresh = (async () => {
      if (!current.refresh_token)
        throw new Error('The ChatGPT session expired. Reconnect your account.')
      const updated = await this.postTokens({
        grant_type: 'refresh_token',
        client_id: account.clientId,
        refresh_token: current.refresh_token,
        resource,
      })
      const next = {
        ...current,
        ...updated,
        refresh_token: updated.refresh_token || current.refresh_token,
        id_token: updated.id_token || current.id_token,
        scope: updated.scope || current.scope,
      }
      if (!next.scope?.split(' ').includes('chatgpt.tokens.use.direct'))
        throw new Error('ChatGPT plan permission is no longer active.')
      await this.store.update((db) => {
        const target = db.chatgptAccounts.find((item) => item.id === account.id)
        if (target?.encryptedTokens)
          target.encryptedTokens = this.vault.encrypt(JSON.stringify(next))
      })
      return next
    })().finally(() => this.refreshes.delete(account.id))
    this.refreshes.set(account.id, refresh)
    return refresh
  }
  async models() {
    const tokens = await this.tokens(this.account())
    const response = await fetch(`${resource}/models`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok)
      throw new Error(
        'Could not load your account models. Check your connection or authorize ChatGPT again.',
      )
    const catalog = z
      .object({
        models: z.array(
          z.object({ slug: z.string(), display_name: z.string(), visibility: z.string() }),
        ),
      })
      .parse(await response.json())
    return catalog.models.filter((model) => model.visibility === 'list')
  }
  async select(id: string, model?: string) {
    const account = this.account(id)
    if (!account.encryptedTokens) throw new Error('Esta cuenta necesita volver a conectarse.')
    await this.store.update((db) => {
      db.activeChatgptAccount = id
    })
    if (model) {
      if (!(await this.models()).some((item) => item.slug === model))
        throw new Error('The model is not available for this account.')
      await this.store.update((db) => {
        const target = db.chatgptAccounts.find((item) => item.id === id)
        if (target) target.model = model
      })
    }
    this.changed()
  }
  async welcome(id: string) {
    await this.store.update((db) => {
      const account = db.chatgptAccounts.find((item) => item.id === id)
      if (account) account.welcomed = true
    })
    this.changed()
  }
  async model(): Promise<LanguageModel> {
    const account = this.account()
    if (!account.model) throw new Error('Select a ChatGPT model in Settings.')
    return createOpenAI({ apiKey: (await this.tokens(account)).access_token })(account.model)
  }
  async disconnect(id: string) {
    const account = this.account(id)
    await this.refreshes.get(id)?.catch(() => {})
    let revoked = true
    const current = this.account(id)
    if (current.encryptedTokens) {
      const tokens = savedTokens.parse(JSON.parse(this.vault.decrypt(current.encryptedTokens)))
      try {
        const discovery = discoverySchema.parse(
          await (
            await fetch(`${issuer}/.well-known/openid-configuration`, {
              signal: AbortSignal.timeout(10_000),
            })
          ).json(),
        )
        if (tokens.refresh_token) {
          const response = await fetch(discovery.revocation_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              token: tokens.refresh_token,
              token_type_hint: 'refresh_token',
              client_id: account.clientId,
            }),
            signal: AbortSignal.timeout(10_000),
          })
          revoked = response.ok
        }
      } catch {
        revoked = false
      }
    }
    await this.store.update((db) => {
      const target = db.chatgptAccounts.find((item) => item.id === id)
      if (target) delete target.encryptedTokens
      if (db.activeChatgptAccount === id) delete db.activeChatgptAccount
    })
    this.changed()
    return { revoked }
  }
  close() {
    clearTimeout(this.timer)
    this.listener?.close()
    this.listener = undefined
  }
}
