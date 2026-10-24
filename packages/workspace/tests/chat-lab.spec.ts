import { test, expect, type Page } from '@playwright/test'

async function state(page: Page) {
  const response = await page.request.get('/api/state')
  expect(response.ok()).toBe(true)
  return response.json()
}
async function send(page: Page, id: string, text: string) {
  const response = await page.request.post(`/api/conversations/${id}/messages`, {
    data: { text, provider: 'openai' },
  })
  expect(response.ok()).toBe(true)
}
async function completed(page: Page, id: string, count: number) {
  await expect.poll(async () => {
    const current = await state(page)
    const conversation = current.conversations.find((item: { id: string }) => item.id === id)
    return { status: current.agents[id]?.status,
      replies: conversation.messages.filter((item: { role: string }) => item.role === 'assistant').length,
      queued: conversation.queue?.length ?? 0 }
  }, { timeout: 15_000 }).toEqual({ status: 'idle', replies: count, queued: 0 })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('alfred.notifications.prompted', 'true'))
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Enter my workspace' })).toHaveCount(0)
  const initial = await state(page)
  await page.addInitScript(({ project, conversation }) => {
    localStorage.setItem('alfred.project', project)
    localStorage.setItem('alfred.conversation', conversation)
  }, { project: initial.projects[0].id, conversation: initial.conversations[0].id })
  await page.reload()
  await expect(page.getByLabel('Message for Alfred')).toBeVisible()
})

test('real composer streams, queues FIFO and restores UI after reload', async ({ page }) => {
  const initial = await state(page)
  const id = initial.conversations[0].id
  const before = initial.conversations[0].messages.filter((m: { role: string }) => m.role === 'assistant').length
  await page.getByLabel('Message for Alfred').fill('[slow] First lab turn')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await send(page, id, 'Second lab turn')
  await completed(page, id, before + 2)
  await expect(page.getByText('Second lab turn', { exact: true }).first()).toBeVisible()
  await page.reload()
  await expect(page.getByText('Second lab turn', { exact: true }).first()).toBeVisible()
  const current = (await state(page)).conversations.find((c: { id: string }) => c.id === id)
  expect(current.messages.filter((m: { role: string }) => m.role === 'user').slice(-2).map((m: { text: string }) => m.text))
    .toEqual(['[slow] First lab turn', 'Second lab turn'])
})

test('stop then new idle message resumes without manual queue intervention', async ({ page }) => {
  const initial = await state(page)
  const project = initial.projects[0]
  const response = await page.request.post('/api/conversations', {
    data: { projectId: project.id, workspacePath: project.path },
  })
  expect(response.ok()).toBe(true)
  const { id } = await response.json()
  await send(page, id, '[slow] Stop this turn')
  expect((await page.request.post(`/api/conversations/${id}/stop`)).ok()).toBe(true)
  const after = (await state(page)).conversations.find((c: { id: string }) => c.id === id)
  const before = after.messages.filter((m: { role: string }) => m.role === 'assistant').length
  await send(page, id, 'Resume without another button')
  await completed(page, id, before + 1)
})

 test('reconnects after browser network loss and receives the completed turn', async ({ page, context }) => {
  const initial = await state(page)
  const id = initial.conversations[0].id
  const before = initial.conversations[0].messages.filter((m: { role: string }) => m.role === 'assistant').length
  await send(page, id, '[slow] Reconnect lab turn')
  await context.setOffline(true)
  try {
    // APIRequestContext is independent of browser offline emulation.
    await completed(page, id, before + 1)
  } finally {
    await context.setOffline(false)
  }
  await expect(page.getByText('[slow] Reconnect lab turn', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, { timeout: 15_000 })
})


test('reload during an active turn preserves one response and enables another submission', async ({ page }, testInfo) => {
  const initial = await state(page)
  const id = initial.conversations[0].id
  const before = initial.conversations[0].messages.filter((m: { role: string }) => m.role === 'assistant').length
  const prompt = `[slow] Reload while active (${testInfo.project.name})`
  await page.getByLabel('Message for Alfred').fill(prompt)
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect.poll(async () => (await state(page)).agents[id]?.status).not.toBe('idle')
  await page.reload()
  await expect(page.getByLabel('Message for Alfred')).toBeVisible()
  await completed(page, id, before + 1)
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  const current = (await state(page)).conversations.find((c: { id: string }) => c.id === id)
  expect(current.messages.filter((m: { role: string; text: string }) => m.role === 'user' && m.text === prompt)).toHaveLength(1)
  await page.getByLabel('Message for Alfred').fill('New prompt after reload')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await completed(page, id, before + 2)
})
