import { test, expect, type Page } from '@playwright/test'
import type { PublicState } from '../src/shared/contracts'

// Isolated UI fixtures over the chat lab. No project folders or provider calls
// are created by these tests; folder selection is intercepted explicitly.
async function sidebar(page: Page) {
  const opener = page.getByRole('button', { name: /^(Open spaces|Abrir espacios)$/ })
  if (await opener.isVisible() && !(await page.locator('.sidebar').getAttribute('data-open') === 'true')) await opener.click()
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('alfred.notifications.prompted', 'true')
    localStorage.setItem('alfred.language', 'en')
    localStorage.setItem('alfred.theme', 'light')
    localStorage.setItem('alfred.project', 'ui-project-0')
    localStorage.setItem('alfred.conversation', 'ui-chat-0')
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Enter my workspace' })).toHaveCount(0)
  const response = await page.request.get('/api/state')
  expect(response.ok()).toBe(true)
  const base: PublicState = await response.json()
  const names = ['Alfred UI', 'Acme UI', 'Mobile UI']
  const projects = names.map((name, index) => ({ ...base.projects[0], id: `ui-project-${index}`, name }))
  const conversations = projects.map((project, index) => ({
    ...base.conversations[0], id: `ui-chat-${index}`, projectId: project.id,
    workspacePath: project.path, title: `${project.name} conversation`, lastProvider: 'openai' as const,
    messages: Array.from({ length: 24 }, (_, position) => ({
      id: `ui-${index}-${position}`, role: position % 2 ? 'assistant' as const : 'user' as const,
      text: `${project.name} message ${position + 1}. ${'Reading position fixture. '.repeat(30)}`,
      createdAt: '2026-01-01T12:00:00.000Z', notes: [],
      ...(position === 23 && index === 0 ? { contextUsage: { provider: 'openai' as const, model: 'lab-model', inputTokens: 3800, limit: 10000, measuredAt: '2026-01-01T12:00:01.000Z' } } : {}),
    })),
    queue: [], queuePaused: false, compaction: undefined,
  }))
  conversations.push({ ...conversations[0], id: 'ui-chat-extra', title: 'Second workspace chat' })
  const fixture = { ...base, projects, conversations, agents: {} }
  await page.route('**/api/state', (route) => route.fulfill({ json: fixture }))
  await page.route('**/api/events', (route) => route.fulfill({ contentType: 'text/event-stream', body: `event: state\ndata: ${JSON.stringify(fixture)}\n\n` }))
  await page.route('**/api/projects/*/worktrees', (route) => route.fulfill({ json: [{ path: projects[0].path, branch: 'main', main: true }] }))
  await page.reload()
  await expect(page.getByLabel('Message for Alfred')).toBeVisible()
})

test('three spaces preserve drafts and reading; + invokes folder selection', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByLabel('Message for Alfred').fill('Draft for Alfred')
  const rail = page.locator('.message-navigation')
  if (testInfo.project.name === 'phone') {
    await expect(rail).toBeHidden()
    await page.locator('.messages').evaluate(node => node.scrollTo(0, node.scrollHeight / 3))
  } else await rail.getByRole('button').nth(4).click()
  const before = await page.locator('.messages').evaluate((node) => node.scrollTop)
  await sidebar(page)
  await expect(page.locator('.space-switcher button')).toHaveCount(3)
  await page.getByRole('button', { name: 'Acme UI', exact: true }).click()
  await expect(page.getByLabel('Message for Alfred')).toHaveValue('')
  await page.getByLabel('Message for Alfred').fill('Draft for Acme')
  await sidebar(page)
  await page.getByRole('button', { name: 'Alfred UI', exact: true }).click()
  await expect(page.getByLabel('Message for Alfred')).toHaveValue('Draft for Alfred')
  await expect.poll(async () => Math.abs(await page.locator('.messages').evaluate((node) => node.scrollTop) - before)).toBeLessThan(12)
  let selections = 0
  await page.route('**/api/projects/pick', async (route) => { selections++; await route.fulfill({ json: { project: null } }) })
  await sidebar(page)
  await page.getByRole('button', { name: 'Add space', exact: true }).click()
  await expect.poll(() => selections).toBe(1)
  await expect(page.locator('.space-switcher button')).toHaveCount(3)
  expect(errors).toEqual([])
})

test('message index has all messages, focus previews and a measured context ring', async ({ page }, testInfo) => {
  const rail = page.locator('.message-navigation')
  await expect(rail.getByRole('button', { includeHidden: true })).toHaveCount(24)
  if (testInfo.project.name === 'phone') {
    // The original mobile layout hides the desktop index, retaining all messages.
    await expect(rail).toBeHidden()
    await expect(page.locator('.messages article')).toHaveCount(24)
  } else {
    await rail.getByRole('button').nth(2).focus()
    await expect(page.getByRole('tooltip')).toContainText('3 / 24 · You: Alfred UI message 3.')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await rail.getByRole('button').nth(2).click()
    await expect(rail.getByRole('button').nth(2)).toHaveAttribute('aria-current', 'location')
  }
  await expect(page.getByRole('button', { name: 'Context: 38%', exact: true })).toBeVisible()
  await expect(page.locator('.context-ring-value')).toHaveAttribute('stroke-dasharray', '38 100')
  await sidebar(page)
  await page.getByRole('button', { name: 'Mobile UI', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Context: —', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('theme and language live in settings, persist and follow system appearance', async ({ page }) => {
  await sidebar(page)
  await expect(page.locator('.sidebar select')).toHaveCount(0)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Interface', exact: true }).click()
  await page.getByLabel('Appearance', { exact: true }).selectOption('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByLabel('Language', { exact: true }).selectOption('es')
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await page.getByLabel('Apariencia', { exact: true }).selectOption('system')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect.poll(() => page.evaluate(() => [localStorage.getItem('alfred.theme'), localStorage.getItem('alfred.language')])).toEqual(['system', 'es'])
  await page.getByRole('button', { name: 'Volver al espacio', exact: true }).click()
  await expect(page.getByLabel('Mensaje para Alfred')).toBeVisible()
  await sidebar(page)
  await expect(page.getByRole('button', { name: 'Agregar espacio', exact: true })).toBeVisible()
})

test('composer controls share geometry in both themes and narrow panes', async ({ page }, testInfo) => {
  const expectedSize = testInfo.project.name === 'phone' ? 44 : 36
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.documentElement.dataset.theme = value, theme)
    const controls = page.locator('.composer-footer .context-control, .composer-footer .model-picker-trigger, .composer-footer .queue-send-actions > button')
    const heights = await controls.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))
    expect(heights.length).toBeGreaterThanOrEqual(6)
    for (const height of heights) expect(height).toBe(expectedSize)
    const overflow = await page.locator('.composer').evaluate((node) => node.scrollWidth > node.clientWidth)
    expect(overflow).toBe(false)
    await expect(page.getByRole('button', { name: 'Attach files', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible()
  }
  if (testInfo.project.name === 'desktop') {
    await page.locator('.chat-panel').evaluate((node) => { node.style.flex = '0 0 380px'; node.style.width = '380px' })
    expect(await page.locator('.composer').evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(false)
  }
})

test('chat utilities stay in a compact heading instead of a vertical action column', async ({ page }, testInfo) => {
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.documentElement.dataset.theme = value, theme)
    const action = page.getByRole('button', { name: 'Open in separate window', exact: true, includeHidden: true })
    if (testInfo.project.name === 'phone') {
      await expect(action).toBeHidden()
      await expect(page.locator('.chat-column-heading .chat-column-title')).toBeVisible()
    } else {
      await expect(action).toBeVisible()
      await expect(page.locator('.chat-column-heading').getByRole('button', { name: 'Open in separate window', exact: true })).toHaveCount(1)
      const bounds = await action.boundingBox()
      expect(bounds!.height).toBeLessThanOrEqual(44)
      expect(bounds!.width).toBeLessThanOrEqual(44)
    }
    await expect(page.getByRole('button', { name: 'Previous chat', exact: true })).toHaveCount(0)
    const layout = await page.locator('.studio-chat').evaluate((node) => {
      const panel = node.querySelector('.chat-panel')!.getBoundingClientRect()
      const parent = node.getBoundingClientRect()
      return { offset: panel.left - parent.left, width: panel.width / parent.width }
    })
    expect(Math.abs(layout.offset)).toBeLessThan(2)
    expect(layout.width).toBeGreaterThan(.98)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

 test('floating mode hides workspace chrome and adds sidebar chats without duplicates', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'Floating controls are desktop-only')
  await page.getByRole('button', { name: 'Float chat', exact: true }).click()
  await expect(page.locator('.chat-deck-toolbar')).toHaveCount(0)
  await expect(page.locator('.conversation-title')).toHaveCount(0)
  await page.locator('.sidebar').getByTitle('Second workspace chat', { exact: true }).click()
  await expect(page.locator('[data-floating="true"]')).toHaveCount(2)
  await page.locator('.sidebar').getByTitle('Second workspace chat', { exact: true }).click()
  await expect(page.locator('[data-floating="true"]')).toHaveCount(2)
  await page.locator('[data-chat-column="ui-chat-extra"]').getByRole('button', { name: 'Dock chat', exact: true }).click()
  await expect(page.locator('[data-floating="true"]')).toHaveCount(1)
  // The existing canvas shows only floating chats until the last one docks.
  await expect(page.locator('[data-chat-column="ui-chat-extra"]')).toHaveAttribute('data-floating', 'false')
  await expect(page.locator('[data-chat-column="ui-chat-extra"]')).toBeHidden()
  await page.locator('[data-chat-column="ui-chat-0"]').getByRole('button', { name: 'Dock chat', exact: true }).click()
  await expect(page.locator('.chat-deck-toolbar')).toBeVisible()
  await expect(page.locator('[data-chat-column="ui-chat-extra"]')).toBeVisible()
  await expect(page.locator('[data-chat-column="ui-chat-0"]')).toBeVisible()
  await expect(page.locator('.conversation-title')).toBeVisible()
})
