import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { PublicState, Worktree } from '../src/shared/contracts'

let sessionCookies: Awaited<ReturnType<BrowserContext['cookies']>> = []
test.beforeAll(async ({ request }) => {
  const response = await request.get('/api/state')
  expect(response.ok()).toBe(true)
  sessionCookies = (await request.storageState()).cookies
})
test.beforeEach(async ({ page }) => {
  await page.context().addCookies(sessionCookies)
  const state: PublicState = await (await page.request.get('/api/state')).json()
  await page.addInitScript(({ project, conversation }) => {
    localStorage.setItem('alfred.language', 'en')
    localStorage.setItem('alfred.notifications.prompted', 'true')
    localStorage.setItem('alfred.project', project)
    localStorage.setItem('alfred.conversation', conversation)
  }, { project: state.projects[0].id, conversation: state.conversations[0].id })
  await page.goto('/')
})
async function openDialog(page: Page) {
  const opener = page.getByRole('button', { name: 'Open spaces', exact: true })
  if (await opener.isVisible()) await opener.click()
  await page.locator('.workspace-picker > summary').click()
  await page.getByRole('button', { name: 'New worktree', exact: true }).click()
  return page.getByRole('dialog', { name: 'New worktree', exact: true })
}
async function expectCreated(page: Page, branch: string, path: string) {
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const state: PublicState = await (await page.request.get('/api/state')).json()
  const worktrees: Worktree[] = await (await page.request.get(`/api/projects/${state.projects[0].id}/worktrees`)).json()
  expect(worktrees).toContainEqual({ path, branch, main: false, locked: false })
  await expect.poll(async () => {
    const current: PublicState = await (await page.request.get('/api/state')).json()
    return current.conversations.some((conversation) => conversation.workspacePath === path)
  }).toBe(true)
  await expect(page.locator('.workspace-picker > summary')).toContainText(branch)
}

test('shows the exact default path, restores it after editing, and creates there', async ({ page }, testInfo) => {
  const dialog = await openDialog(page)
  await expect(dialog.locator('.worktree-location-path')).toBeVisible()
  const path = await dialog.locator('.worktree-location-path').innerText()
  expect(path).toContain('/data/worktrees/')
  await expect(dialog.getByText(/By default, Alfred creates a unique folder/)).toBeVisible()
  const branch = `test/default-${randomUUID()}`
  await dialog.getByLabel('New branch name').fill(branch)
  await dialog.screenshot({ path: testInfo.outputPath('worktree-default.png') })
  await dialog.getByRole('button', { name: 'Change path', exact: true }).click()
  await dialog.getByLabel('Worktree path').fill('/temporary-choice')
  await dialog.getByRole('button', { name: 'Use default', exact: true }).click()
  await expect(dialog.locator('.worktree-location-path')).toHaveText(path)
  await dialog.getByRole('button', { name: 'Create worktree', exact: true }).click()
  await expectCreated(page, branch, path)
})

test('retains the form after an occupied-path error and creates at the corrected custom path', async ({ page }, testInfo) => {
  const state: PublicState = await (await page.request.get('/api/state')).json()
  const project = state.projects[0]
  const dialog = await openDialog(page)
  const branch = `test/custom-${randomUUID()}`
  await dialog.getByLabel('New branch name').fill(branch)
  await dialog.getByRole('button', { name: 'Change path', exact: true }).click()
  await dialog.getByLabel('Worktree path').fill(project.path)
  await dialog.getByRole('button', { name: 'Create worktree', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('The destination already exists.')
  await expect(dialog.getByLabel('New branch name')).toHaveValue(branch)
  const path = join(dirname(project.path), 'my worktrees', randomUUID())
  await dialog.getByLabel('Worktree path').fill(path)
  await dialog.screenshot({ path: testInfo.outputPath('worktree-custom.png') })
  await dialog.getByRole('button', { name: 'Create worktree', exact: true }).click()
  await expectCreated(page, branch, path)
})

test('allows retrying a failed location preview and cancelling without creating a worktree', async ({ page }) => {
  let previews = 0, creates = 0
  await page.route('**/api/projects/*/worktrees/location', async (route) => {
    if (++previews === 1) await route.fulfill({ status: 503, json: { error: 'Location temporarily unavailable.' } })
    else await route.continue()
  })
  page.on('request', (request) => { if (request.method() === 'POST' && request.url().endsWith('/worktrees')) creates++ })
  const dialog = await openDialog(page)
  await expect(dialog.getByRole('alert')).toHaveText('Location temporarily unavailable.')
  await expect(dialog.getByRole('button', { name: 'Create worktree', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Retry loading location', exact: true }).click()
  await expect(dialog.locator('.worktree-location-path')).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(creates).toBe(0)
})
