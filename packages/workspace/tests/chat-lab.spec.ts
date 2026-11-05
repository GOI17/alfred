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

test('virtualized history mounts a bounded set and reveals navigation targets', async ({ page, isMobile }) => {
  const initial = await state(page)
  initial.conversations[0].messages = Array.from({ length: 500 }, (_, index) => ({
    id: `synthetic-${index}`, role: index % 2 ? 'assistant' : 'user',
    text: `Virtual history entry ${index}\n\n` + 'Synthetic content. '.repeat(80),
    createdAt: new Date().toISOString(), notes: [],
  }))
  await page.route('**/api/state', route => route.fulfill({ json: initial }))
  await page.route('**/api/events?*', route => route.fulfill({ contentType: 'text/event-stream', body: `id: 1\nevent: state\ndata: ${JSON.stringify(initial)}\n\n` }))
  await page.reload()
  await expect(page.locator('.message-slot')).toHaveCount(500)
  await expect(page.locator('.message-slot').last().locator('article')).toBeVisible()
  await expect.poll(() => page.locator('.message-slot article').count()).toBeLessThan(40)
  if (isMobile) {
    // Phone intentionally hides the desktop navigation rail.
    await page.locator('.message-history > .messages').evaluate(element => { element.scrollTop = 0 })
  } else {
    await page.locator('.message-navigation button').first().click()
  }
  await expect(page.locator('.message-slot').first().locator('article')).toBeVisible()
  await expect.poll(() => page.locator('.message-slot article').count()).toBeLessThan(40)
  await page.reload()
  await expect(page.locator('.message-slot').first().locator('article')).toBeVisible()
})

test('command palette focuses search and executes registered panel commands', async ({ page }) => {
  await page.keyboard.press('Control+Shift+P')
  const input = page.getByRole('combobox', { name: 'Search commands' })
  await expect(input).toBeFocused()
  await input.fill('View: Files')
  await page.keyboard.press('Enter')
  await expect(input).toHaveCount(0)
  await expect(page.locator('.file-viewer')).toBeVisible()
})


test('file suggestions keep keyboard selection visible without moving focus', async ({ page }) => {
  const files = Array.from({ length: 40 }, (_, index) => `src/file-${index}.ts`)
  await page.route('**/api/conversations/*/files?*', route => route.fulfill({ json: { files, truncated: false } }))
  const input = page.getByLabel('Message for Alfred')
  await input.fill('@')
  const list = page.getByRole('listbox', { name: 'Project files' })
  await expect(list.getByRole('option')).toHaveCount(40)
  async function visibleSelection(index: number) {
    const option = list.getByRole('option').nth(index)
    await expect(option).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => option.evaluate(element => {
      const popup = element.parentElement!.parentElement!
      const bounds = popup.getBoundingClientRect()
      const item = element.getBoundingClientRect()
      const top = bounds.top + popup.clientTop
      return item.top >= top - 1 && item.bottom <= top + popup.clientHeight + 1
    })).toBe(true)
    await expect(input).toBeFocused()
  }
  await visibleSelection(0)
  await input.press('ArrowUp')
  await visibleSelection(39)
  await input.press('ArrowDown')
  await visibleSelection(0)
  for (let index = 1; index <= 15; index++) await input.press('ArrowDown')
  await visibleSelection(15)
  for (let index = 14; index >= 2; index--) await input.press('ArrowUp')
  await visibleSelection(2)
  await input.press('Enter')
  await expect(input).toHaveValue('@"src/file-2.ts" ')
  await expect(list).toHaveCount(0)
})
