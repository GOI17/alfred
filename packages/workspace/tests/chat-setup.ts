import { request, type FullConfig } from '@playwright/test'
import { mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

// UI cases share one real session. Login/QR cases explicitly start without it,
// so the production authentication limiter remains active and meaningful.
export default async function setup(config: FullConfig) {
  const { baseURL, storageState } = config.projects[0].use
  if (typeof storageState !== 'string') throw new Error('Chat UI session fixture path is required.')
  await mkdir(dirname(storageState), { recursive: true })
  const context = await request.newContext({ baseURL })
  try {
    const response = await context.post('/api/auth', { data: { code: 'alfred-chat-lab-only' } })
    if (!response.ok()) throw new Error(`Chat fixture login failed: ${response.status()}`)
    await context.storageState({ path: storageState })
  } finally {
    await context.dispose()
  }
  return () => rm(storageState, { force: true })
}
