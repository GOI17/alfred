import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { PublicState } from '../src/shared/contracts'

let cookies: Awaited<ReturnType<BrowserContext['cookies']>> = []
test.beforeAll(async ({ request }) => {
  expect((await request.get('/api/state')).ok()).toBe(true)
  cookies = (await request.storageState()).cookies
})
test.beforeEach(async ({ page }) => {
  await page.context().addCookies(cookies)
  const state: PublicState = await (await page.request.get('/api/state')).json()
  const conversation = await (await page.request.post('/api/conversations', { data: { projectId: state.projects[0].id, workspacePath: state.projects[0].path } })).json()
  await page.addInitScript(({ id, project }) => {
    localStorage.setItem('alfred.language', 'en')
    localStorage.setItem('alfred.notifications.prompted', 'true')
    localStorage.setItem('alfred.conversation', id)
    localStorage.setItem('alfred.project', project)
  }, { id: conversation.id, project: state.projects[0].id })
  await page.goto('/')
})
async function settings(page: Page) {
  const opener = page.getByRole('button', { name: 'Open spaces', exact: true })
  if (await opener.isVisible()) await opener.click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Agent harnesses', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Use these resources', exact: true })).toBeEnabled()
  await page.getByRole('combobox', { name: 'Harness', exact: true }).selectOption('opencode')
  return page.locator('.harness-settings')
}
test('shows origins and previews, enables resources and exposes commands in the actual composer', async ({ page }, testInfo) => {
  const panel = await settings(page)
  await expect(panel.getByText('lab-skill', { exact: true })).toBeVisible()
  await expect(panel.locator('.harness-source').first()).toContainText('.opencode/skills/lab-skill/SKILL.md')
  await panel.getByRole('button', { name: 'View source', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Use focused lab checks.')
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await panel.getByRole('button', { name: 'Use these resources', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Enabled for this conversation', exact: true })).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath('harness-catalog.png') })
  await page.getByRole('button', { name: 'Back to workspace', exact: true }).click()
  const input = page.getByRole('textbox', { name: 'Message for Alfred', exact: true })
  await input.fill('/opencode:lab')
  await page.getByRole('listbox', { name: 'Commands' }).getByRole('option', { name: /\/opencode:lab-review/ }).click()
  await expect(input).toHaveValue('/opencode:lab-review ')
  await input.fill('/opencode:lab-review API')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.locator('.message[data-role="assistant"]').last()).toContainText('Streaming completed.')
  const id = await page.evaluate(() => localStorage.getItem('alfred.conversation'))
  const state: PublicState = await (await page.request.get('/api/state')).json()
  expect(state.conversations.find((item) => item.id === id)?.harness?.id).toBe('opencode')
  await page.reload()
  await input.fill('/skill:opencode:lab')
  await expect(page.getByRole('listbox', { name: 'Commands' }).getByRole('option', { name: /\/skill:opencode:lab-skill/ })).toBeVisible()
})

test('selects an agent definition, persists it, and keeps runtime subagents separate', async ({ page }) => {
  const panel = await settings(page)
  await panel.getByRole('button', { name: /Agent definitions/ }).click()
  await expect(panel.getByText('lab-reviewer', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Use agent prompt', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Selected agent prompt', exact: true })).toBeVisible()
  const id = await page.evaluate(() => localStorage.getItem('alfred.conversation'))
  const state: PublicState = await (await page.request.get('/api/state')).json()
  expect(state.conversations.find((item) => item.id === id)?.harness?.agent).toBeTruthy()
  expect(state.conversations.find((item) => item.id === id)?.subagents).toBeUndefined()
  await panel.getByRole('button', { name: 'Clear agent prompt', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Use agent prompt', exact: true })).toBeVisible()
})

test('imports a secret-free MCP reference and exposes it in the existing access settings', async ({ page }, testInfo) => {
  const panel = await settings(page)
  await panel.getByRole('button', { name: /^MCP/ }).click()
  await expect(panel.getByText('lab-mcp', { exact: true })).toBeVisible()
  await expect(panel).not.toContainText('lab-private-header')
  await panel.getByRole('button', { name: 'Import MCP', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('MCP reference saved.')
  await page.getByRole('button', { name: 'Terminal and MCP', exact: true }).click()
  const json = page.getByLabel('MCP servers (JSON)', { exact: true })
  await expect(json).toHaveValue(/"type": "harness"/)
  await expect(json).toHaveValue(/"permission": "ask"/)
  expect(await json.inputValue()).not.toContain('lab-private-header')
  await page.screenshot({ path: testInfo.outputPath('harness-mcp-reference.png') })
})

test('refreshes newly created and deleted commands without reloading the app', async ({ page }) => {
  const panel = await settings(page)
  await panel.getByRole('button', { name: /^Commands/ }).click()
  const state: PublicState = await (await page.request.get('/api/state')).json()
  const path = join(state.projects[0].path, '.opencode/commands/live-added.md')
  try {
    await writeFile(path, '---\ndescription: Added after opening settings\n---\nDo the new task.')
    await panel.getByRole('button', { name: 'Refresh resources', exact: true }).click()
    await expect(panel.getByText('live-added', { exact: true })).toBeVisible()
    await rm(path)
    await panel.getByRole('button', { name: 'Refresh resources', exact: true }).click()
    await expect(panel.getByText('live-added', { exact: true })).toHaveCount(0)
  } finally { await rm(path, { force: true }) }
})
