import { z } from 'zod'

export const apiProviderId = z.enum(['openai', 'anthropic', 'google', 'copilot', 'opencode'])
export type ApiProviderId = z.infer<typeof apiProviderId>
export const providerId = z.enum(['openai', 'anthropic', 'google', 'chatgpt', 'copilot', 'opencode'])
export type ProviderId = z.infer<typeof providerId>
