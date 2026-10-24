import type { SessionAdapterFactory } from './session-adapter.js'
import { notificationRoutes } from './notifications.js'
import { pwaRoutes } from './pwa.js'
import { copilotRoutes } from './copilot.js'
import { revealFileRoutes } from './reveal-file.js'
import { subagentRoutes } from './subagents.js'
import { harnessRoutes } from './harness-routes.js'
import { HarnessRegistry } from './harness-runtime.js'
import type { HarnessEnvironment } from './harness-discovery.js'
import { listWorkspaceFiles } from './workspace-files.js'
import Fastify from 'fastify'
import { cloudflareRoutes, type TunnelConfig } from './cloudflare.js'
import websocket from '@fastify/websocket'
import staticFiles from '@fastify/static'
import { join } from 'node:path'
import { workspaceClientRoot, workspacePackageRoot } from './package-paths.js'
import { networkInterfaces } from 'node:os'
import { z, ZodError } from 'zod'
import {
  apiProviderId,
  layoutSchema,
  panes,
  permissionModeSchema,
  providerId,
} from '../shared/contracts.js'
import { attachmentsSchema } from '../shared/attachments.js'
import { authentication } from './auth.js'
import { WorkspaceService } from './service.js'
import { chatgptRoutes } from './chatgpt-routes.js'
import { projectSelection } from './project-selection.js'
import { configureAgentAccess } from './agent-access.js'
import * as git from './git.js'
import { gitActionRoutes } from './git-actions.js'
import type { LanguageModel } from 'ai'

export async function createApp(options: {
  directory: string
  token: string
  tunnel?: TunnelConfig
  dev?: boolean
  tls?: { key: Buffer; cert: Buffer }
  model?: LanguageModel
  serve?: boolean
  pickFolder?: (signal: AbortSignal) => Promise<string | null>
  sessionAdapter?: SessionAdapterFactory
  harnessEnvironment?: HarnessEnvironment
}) {
  const service = await WorkspaceService.open(options.directory, options.model, options.sessionAdapter)
  const harnesses = new HarnessRegistry(options.harnessEnvironment)
  if (service.adapter.legacyBindings) service.adapter.legacyBindings.harnesses = harnesses
  const app = Fastify({
    logger: false,
    bodyLimit: 250_000,
    forceCloseConnections: true,
    ...(options.tls ? { https: options.tls } : {}),
  })
  await app.register(websocket, { options: { maxPayload: 250_000 } })
  await authentication(app, options.token, options.tunnel?.origin)
  subagentRoutes(app, service)
  if (service.adapter.legacyBindings) harnessRoutes(app, service, harnesses)
  app.get('/api/runtime', async () => service.adapter.describe())
  await notificationRoutes(app, service)
  pwaRoutes(app)
  cloudflareRoutes(app, options.tunnel)
  chatgptRoutes(app, service)
  copilotRoutes(app, service)
  gitActionRoutes(app, service)
  revealFileRoutes(app, service)
  projectSelection(app, service, options.pickFolder)
  await configureAgentAccess(app, service, options.directory, harnesses)
  app.setErrorHandler((error, _request, reply) => {
    const message =
      error instanceof ZodError
        ? 'Check the input: some fields are incomplete or invalid.'
        : error instanceof Error
          ? error.message
          : 'Could not complete the operation.'
    reply
      .code(
        error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
          ? error.statusCode
          : 400,
      )
      .send({ error: message })
  })
  const id = (params: unknown) => z.object({ id: z.string().uuid() }).parse(params).id
  app.get('/api/conversations/:id/files', async (request) => {
    const { query } = z.object({ query: z.string().max(300).default('') }).parse(request.query)
    const root = await service.workspace(service.conversation(id(request.params)))
    return listWorkspaceFiles(root, query)
  })
  app.get('/api/state', async () => service.state())
  app.get('/api/connection', async (request) => {
    const address = app.server.address()
    const shared =
      address !== null && typeof address !== 'string' && ['0.0.0.0', '::'].includes(address.address)
    const urls =
      shared && typeof address !== 'string' && address
        ? Object.values(networkInterfaces()).flatMap((items) =>
            (items || [])
              .filter((item) => item.family === 'IPv4' && !item.internal)
              .map((item) => `${request.protocol}://${item.address}:${address.port}`),
          )
        : []
    return { shared, urls }
  })
  app.get('/api/events', (request, reply) => {
    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    // Coalesce updates for slow clients instead of dropping their connection.
    let blocked = false
    let pending = false
    const send = () => {
      if (reply.raw.destroyed) return
      if (blocked) { pending = true; return }
      pending = false
      blocked = !reply.raw.write(`event: state\ndata: ${JSON.stringify(service.state())}\n\n`)
    }
    const drained = () => {
      blocked = false
      if (pending) send()
    }
    reply.raw.on('drain', drained)
    service.events.on('change', send)
    const heartbeat = setInterval(() => {
      if (!blocked && !reply.raw.destroyed)
        blocked = !reply.raw.write(': heartbeat\n\n')
    }, 20_000)
    send()
    reply.raw.on('close', () => {
      clearInterval(heartbeat)
      service.events.off('change', send)
      reply.raw.off('drain', drained)
    })
  })
  app.post('/api/projects', async (request) => {
    const body = z.object({ path: z.string().min(1).max(4000) }).parse(request.body)
    return service.addProject(body.path)
  })
  app.delete('/api/projects/:id', async (request) => {
    await service.removeProject(id(request.params))
    return { ok: true }
  })
  app.get('/api/projects/:id/worktrees', async (request) =>
    git.listWorktrees(service.project(id(request.params))),
  )
  app.get('/api/projects/:id/worktrees/location', async (request) => ({
    path: git.defaultWorktreePath(service.project(id(request.params)), service.worktreeDirectory()),
  }))
  app.post('/api/projects/:id/worktrees', async (request) => {
    const { branch, path } = z.object({
      branch: z.string().min(1).max(150),
      path: z.string().min(1).max(4000).optional(),
    }).parse(request.body)
    return service.createTree(id(request.params), branch, path)
  })
  app.delete('/api/projects/:id/worktrees', async (request) => {
    const { path } = z.object({ path: z.string().min(1).max(4000) }).parse(request.body)
    await service.removeTree(id(request.params), path)
    return { ok: true }
  })
  app.post('/api/conversations', async (request) => {
    const body = z
      .object({ projectId: z.string().uuid(), workspacePath: z.string().max(4000) })
      .parse(request.body)
    return service.addConversation(body.projectId, body.workspacePath)
  })
  app.delete('/api/conversations/:id', async (request) => {
    await service.removeConversation(id(request.params))
    return { ok: true }
  })
  app.patch('/api/conversations/:id', async (request) => {
    const body = z.object({ title: z.string().trim().min(1).max(100) }).parse(request.body)
    await service.store.update((db) => {
      const current = db.conversations.find((item) => item.id === id(request.params))
      if (!current) throw new Error('Conversation not found.')
      current.title = body.title
    })
    service.changed()
    return { ok: true }
  })
  app.put('/api/conversations/:id/permissions', async (request) => {
    const { mode, confirmed } = z
      .object({ mode: permissionModeSchema, confirmed: z.boolean().default(false) })
      .parse(request.body)
    if (mode === 'full-access' && !confirmed)
      throw new Error(
        'Confirm the risk of automatic writes before enabling Full access / YOLO.',
      )
    await service.chat.setPermission(id(request.params), mode)
    return { ok: true }
  })
  app.put('/api/conversations/:id/layout', async (request) => {
    await service.setLayout(id(request.params), layoutSchema.parse(request.body))
    return { ok: true }
  })
  app.post('/api/conversations/:id/messages', { bodyLimit: 6_000_000 }, async (request) => {
    const body = z
      .object({
        text: z.string().trim().max(32000),
        provider: providerId,
        attachments: attachmentsSchema.default([]),
        mode: z.enum(['queue', 'interrupt']).default('queue'),
      })
      .refine((body) => body.text.length > 0 || body.attachments.length > 0)
      .parse(request.body)
    const conversation = service.conversation(id(request.params))
    await service.workspace(conversation)
    await service.chat.start(conversation.id, body.text, body.provider, body.attachments, body.mode)
    return { ok: true }
  })
  app.post('/api/conversations/:id/queue/remove', async (request) => {
    const { messageId } = z.object({ messageId: z.string().uuid() }).parse(request.body)
    await service.chat.removeQueued(id(request.params), messageId)
    return { ok: true }
  })
  app.post('/api/conversations/:id/queue/resume', async (request) => {
    const conversation = service.conversation(id(request.params))
    await service.workspace(conversation)
    await service.chat.resume(conversation.id)
    return { ok: true }
  })
  app.post('/api/conversations/:id/compact', async (request) => {
    const body = z.object({ provider: providerId, reduction: z.union([z.literal(30), z.literal(50), z.literal(70)]) }).parse(request.body)
    await service.chat.compact(id(request.params), body.provider, body.reduction)
    return { ok: true }
  })
  app.post('/api/conversations/:id/stop', async (request) => {
    await service.chat.stop(id(request.params))
    return { ok: true }
  })
  app.post('/api/conversations/:id/approval', async (request) => {
    const body = z
      .object({ approvalId: z.string().uuid(), accepted: z.boolean() })
      .parse(request.body)
    service.chat.decide(id(request.params), body.approvalId, body.accepted)
    return { ok: true }
  })
  app.put('/api/providers/:provider', async (request) => {
    const { provider } = z.object({ provider: apiProviderId }).parse(request.params)
    if (provider === 'copilot') throw new Error('Use GitHub authorization to connect Copilot.')
    const body = z
      .object({
        apiKey: z.string().trim().min(1).max(1000),
        model: z.string().trim().min(1).max(150),
      })
      .parse(request.body)
    await service.store.update((db) => {
      db.providers = [
        ...db.providers.filter((item) => item.id !== provider),
        { id: provider, model: body.model, encryptedKey: service.vault.encrypt(body.apiKey) },
      ]
    })
    service.changed()
    return { ok: true }
  })
  app.delete('/api/providers/:provider', async (request) => {
    const { provider } = z.object({ provider: apiProviderId }).parse(request.params)
    await service.chat.stopProvider(provider)
    await service.store.update((db) => {
      db.providers = db.providers.filter((item) => item.id !== provider)
    })
    service.changed()
    return { ok: true }
  })
  app.get('/api/conversations/:id/git', async (request) => {
    const { skip } = z
      .object({ skip: z.coerce.number().int().min(0).max(100000).default(0) })
      .parse(request.query)
    return git.history(await service.workspace(service.conversation(id(request.params))), skip)
  })
  app.get('/api/conversations/:id/diff', async (request) => {
    const { revision } = z.object({ revision: z.string().max(64) }).parse(request.query)
    const result = await git.diff(
      await service.workspace(service.conversation(id(request.params))),
      revision,
    )
    return { text: result.stdout, truncated: result.truncated }
  })
  for (const kind of ['terminal', 'browser'] as const) {
    app.get(`/api/conversations/:id/${kind}/:paneId`, { websocket: true }, (socket, request) => {
      socket.on('error', () => {})
      void (async () => {
        const { id: conversationId, paneId } = z
          .object({ id: z.string().uuid(), paneId: z.string().uuid() })
          .parse(request.params)
        const conversation = service.conversation(conversationId)
        if (!panes(conversation.layout).some((pane) => pane.id === paneId && pane.kind === kind))
          throw new Error('Panel not found.')
        const cwd = await service.workspace(conversation)
        if (socket.readyState !== socket.OPEN) return
        if (kind === 'terminal') service.terminals.attach(paneId, cwd, socket)
        else await service.browsers.attach(paneId, socket)
      })().catch((error) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(
            JSON.stringify({
              type: 'error',
              message: error instanceof Error ? error.message : 'Could not open the panel.',
            }),
          )
          socket.close(1011)
        }
      })
    })
  }
  app.addHook('onClose', async () => service.close())
  if (options.serve !== false) {
    if (options.dev) {
      const { createServer } = await import('vite')
      const vite = await createServer({
        configFile: join(workspacePackageRoot, 'vite.config.ts'),
        configLoader: 'runner',
        root: join(workspacePackageRoot, 'src', 'renderer'),
        server: { middlewareMode: true, hmr: false },
        appType: 'spa',
      })
      app.setNotFoundHandler((request, reply) => {
        if (request.url.startsWith('/api/'))
          return reply.code(404).send({ error: 'Ruta no encontrada.' })
        reply.hijack()
        vite.middlewares(request.raw, reply.raw, () => {
          reply.raw.statusCode = 404
          reply.raw.end()
        })
      })
      app.addHook('onClose', () => vite.close())
    } else {
      await app.register(staticFiles, { root: workspaceClientRoot })
      app.setNotFoundHandler((request, reply) =>
        request.url.startsWith('/api/')
          ? reply.code(404).send({ error: 'Ruta no encontrada.' })
          : reply.sendFile('index.html'),
      )
    }
  }
  return { app, service }
}
