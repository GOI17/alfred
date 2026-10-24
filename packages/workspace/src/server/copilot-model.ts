import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import { z } from 'zod'
import { CopilotError, copilotHeaders, copilotSession, type CopilotSession } from './copilot.js'

const remoteModel = z.object({
  id: z.string().min(1), name: z.string().optional(), display_name: z.string().optional(),
  supported_endpoints: z.array(z.string()).optional(),
  model_picker_enabled: z.boolean().optional(),
  policy: z.object({ state: z.string().optional() }).optional(),
  capabilities: z.object({
    type: z.string().optional(),
    supports: z.object({ tool_calls: z.boolean().optional(), streaming: z.boolean().optional() }).optional(),
  }).optional(),
})
type RemoteModel = z.infer<typeof remoteModel>
type Endpoint = '/v1/messages' | '/responses' | '/chat/completions'
type CopilotModel = { id: string; name: string; endpoint: Endpoint }

function modelEndpoint(model: RemoteModel): Endpoint | undefined {
  // The account's live routing metadata wins over model-name conventions.
  if (model.supported_endpoints !== undefined)
    return (['/v1/messages', '/responses', '/chat/completions'] as const).find((endpoint) => model.supported_endpoints!.includes(endpoint))
  if (model.id.startsWith('claude-')) return '/v1/messages'
  const gpt = /^gpt-(\d+)/.exec(model.id)
  if ((gpt && Number(gpt[1]) >= 5 && !model.id.startsWith('gpt-5-mini')) || /^(grok-|mai-code-)/.test(model.id)) return '/responses'
  return '/chat/completions'
}

export async function copilotModels(session: CopilotSession): Promise<CopilotModel[]> {
  const response = await fetch(`${session.baseURL}/models`, {
    headers: { ...copilotHeaders, Authorization: `Bearer ${session.token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000), redirect: 'error',
  })
  if (!response.ok) throw new CopilotError('Could not load your Copilot models. Reconnect GitHub Copilot in Settings.')
  const { data } = z.object({ data: z.array(z.unknown()) }).parse(await response.json())
  const candidates = data.flatMap((item) => {
    const parsed = remoteModel.safeParse(item)
    if (!parsed.success) return []
    const model = parsed.data
    if ((model.capabilities?.type && model.capabilities.type !== 'chat') ||
      model.capabilities?.supports?.tool_calls === false || model.capabilities?.supports?.streaming === false ||
      model.policy?.state === 'disabled' || model.policy?.state === 'unconfigured') return []
    const endpoint = modelEndpoint(model)
    return endpoint ? [{ ...model, endpoint }] : []
  })
  let available = candidates.filter((model) => model.model_picker_enabled !== false)
  // Some Individual accounts advertise no picker entries but do report enabled policies.
  if (!available.length && new URL(session.baseURL).hostname === 'api.individual.githubcopilot.com')
    available = candidates.filter((model) => model.policy?.state === 'enabled')
  const models = available.map((model) => ({ id: model.id, name: model.display_name || model.name || model.id, endpoint: model.endpoint }))
  return [...new Map(models.map((model) => [model.id, model])).values()].sort((a, b) => a.name.localeCompare(b.name))
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function hasImages(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasImages)
  if (!record(value)) return false
  return ['image', 'image_url', 'input_image'].includes(String(value.type)) || hasImages(value.content)
}

// All three SDKs must use the same Copilot identity as model discovery.
const copilotFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers)
  let body: unknown
  if (typeof init?.body === 'string') body = JSON.parse(init.body)
  if (record(body)) {
    const messages = Array.isArray(body.input) ? body.input : Array.isArray(body.messages) ? body.messages : []
    const last: unknown = messages.at(-1)
    const toolResult = record(last) && Array.isArray(last.content) && last.content.length > 0 &&
      last.content.every((part: unknown) => record(part) && part.type === 'tool_result')
    headers.set('X-Initiator', record(last) && last.role === 'user' && !toolResult ? 'user' : 'agent')
    if (hasImages(messages)) headers.set('Copilot-Vision-Request', 'true')
    // Copilot Responses is stateless, including when used for context compaction.
    if (Array.isArray(body.input)) body.store = false
  }
  headers.set('Openai-Intent', 'conversation-edits')
  const response = await fetch(input, { ...init, headers, ...(record(body) ? { body: JSON.stringify(body) } : {}), redirect: 'error' })
  if (response.status === 400 || response.status === 403 || response.status === 404) {
    const error: unknown = await response.clone().json().catch(() => undefined)
    const code = record(error) && record(error.error) ? error.error.code : undefined
    if (code === 'model_not_supported')
      throw new CopilotError('Copilot rejected this model for the connected account. Refresh the model list or reconnect GitHub Copilot.')
    if (code === 'unsupported_api_for_model')
      throw new CopilotError('Copilot rejected the API advertised for this model. Refresh the model list and try again.')
  }
  return response
}

export async function copilotModel(githubToken: string, modelId: string): Promise<LanguageModel> {
  const session = await copilotSession(githubToken)
  const model = (await copilotModels(session)).find((item) => item.id === modelId)
  if (!model) throw new CopilotError('This model is not enabled in your Copilot catalog. Refresh the model list or check model access in GitHub Copilot settings.')
  if (model.endpoint === '/v1/messages') return createAnthropic({
    authToken: session.token, baseURL: `${session.baseURL}/v1`,
    headers: copilotHeaders, fetch: copilotFetch,
  })(model.id)
  const provider = createOpenAI({ apiKey: session.token, baseURL: session.baseURL, headers: copilotHeaders, fetch: copilotFetch })
  return model.endpoint === '/responses' ? provider.responses(model.id) : provider.chat(model.id)
}
