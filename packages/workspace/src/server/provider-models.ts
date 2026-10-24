import { copilotSession } from './copilot.js'
import { copilotModels } from './copilot-model.js'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { apiProviderId, providerId } from '../shared/contracts.js'
import type { WorkspaceService } from './service.js'

type Model = { id: string; name: string }
export function providerModels(app: FastifyInstance, service: WorkspaceService) {
  async function catalog(provider: z.infer<typeof providerId>): Promise<Model[]> {
    if (provider === 'chatgpt') return (await service.chatgpt.models()).map((model) => ({ id: model.slug, name: model.display_name }))
    const settings = service.store.get().providers.find((item) => item.id === provider)
    if (!settings) throw new Error('Connect this provider in Settings.')
    const storedKey = service.vault.decrypt(settings.encryptedKey)
    if (provider === 'copilot') return (await copilotModels(await copilotSession(storedKey))).map(({ id, name }) => ({ id, name }))
    const key = storedKey
    const headers: Record<string, string> = provider === 'anthropic'
      ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
      : provider === 'google' ? { 'x-goog-api-key': key } : { Authorization: `Bearer ${key}` }
    const endpoint = provider === 'opencode' ? 'https://opencode.ai/zen/v1/models' : provider === 'openai' ? 'https://api.openai.com/v1/models'
      : provider === 'anthropic' ? 'https://api.anthropic.com/v1/models' : 'https://generativelanguage.googleapis.com/v1beta/models'
    const models: Model[] = []
    let next = ''
    for (let page = 0; page < 20; page++) {
      const url = new URL(endpoint)
      if (next) url.searchParams.set(provider === 'google' ? 'pageToken' : 'after_id', next)
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error('Could not load the provider catalog. Check the connection and its permissions.')
      const data: unknown = await response.json()
      if (provider === 'google') {
        const result = z.object({ models: z.array(z.object({ name: z.string(), displayName: z.string().optional(), supportedGenerationMethods: z.array(z.string()).optional() })), nextPageToken: z.string().optional() }).parse(data)
        models.push(...result.models.filter((item) => item.supportedGenerationMethods?.includes('generateContent')).map((item) => ({ id: item.name.replace(/^models\//, ''), name: item.displayName || item.name })))
        next = result.nextPageToken || ''
      } else {
        const result = z.object({ data: z.array(z.object({ id: z.string(), display_name: z.string().optional(), name: z.string().optional(), capabilities: z.object({ type: z.string().optional() }).optional() })), has_more: z.boolean().optional(), last_id: z.string().optional() }).parse(data)
        models.push(...result.data.filter((item) => provider !== 'openai' || /^(gpt-|chatgpt-|o[134](?:-|$))/.test(item.id) && !/(audio|realtime|transcribe|tts|image)/.test(item.id)).map((item) => ({ id: item.id, name: item.display_name || item.name || item.id })))
        next = result.has_more ? result.last_id || '' : ''
      }
      if (!next) break
    }
    return [...new Map(models.map((model) => [model.id, model])).values()].sort((a, b) => a.name.localeCompare(b.name))
  }
  app.get('/api/providers/:provider/models', async (request) => {
    const { provider } = z.object({ provider: providerId }).parse(request.params)
    return catalog(provider)
  })
  app.put('/api/providers/:provider/model', async (request) => {
    const { provider } = z.object({ provider: providerId }).parse(request.params)
    const { model } = z.object({ model: z.string().trim().min(1).max(150) }).parse(request.body)
    if (provider === 'chatgpt') {
      const accountId = service.store.get().activeChatgptAccount
      if (!accountId) throw new Error('Connect a ChatGPT account.')
      await service.chatgpt.select(accountId, model)
    } else {
      const id = apiProviderId.parse(provider)
      if (!(await catalog(id)).some((item) => item.id === model)) throw new Error('The model is not available for this provider.')
      await service.store.update((db) => {
        const settings = db.providers.find((item) => item.id === id)
        if (!settings) throw new Error('The provider has disconnected.')
        settings.model = model
      })
      service.changed()
    }
    return { ok: true }
  })
}
