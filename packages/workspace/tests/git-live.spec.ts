import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { Conversation, PublicState } from '../src/shared/contracts'
import { runProcess } from '../src/shared/child-process/run-process'

let cookies: Awaited<ReturnType<BrowserContext['cookies']>> = []
test.beforeAll(async ({ request }) => {
  expect((await request.get('/api/state')).ok()).toBe(true)
  cookies = (await request.storageState()).cookies
})
async function state(page: Page): Promise<PublicState> { return (await page.request.get('/api/state')).json() }
async function git(root: string, ...args: string[]) {
  const result = await runProcess('git', args, root)
  expect(result.code, result.stderr).toBe(0)
  return result.stdout.trim()
}
async function sidebar(page: Page) {
  const opener = page.getByRole('button', { name: 'Open spaces', exact: true })
  if (await opener.isVisible() && await page.locator('.sidebar').getAttribute('data-open') !== 'true') await opener.click()
}
test.beforeEach(async ({ page }) => {
  await page.context().addCookies(cookies)
  const initial = await state(page)
  const project = initial.projects[0]
  await page.addInitScript(({ projectId, conversationId }) => {
    localStorage.setItem('alfred.notifications.prompted', 'true')
    localStorage.setItem('alfred.language', 'en')
    localStorage.setItem('alfred.project', projectId)
    localStorage.setItem('alfred.conversation', conversationId)
  }, { projectId: project.id, conversationId: initial.conversations.find((item) => item.workspacePath === project.path)!.id })
  await page.goto('/')
  await expect(page.getByLabel('Message for Alfred')).toBeVisible()
})

test('external edits, diffs, commits and branch switches update without reloading or losing drafts', async ({ page }) => {
  const root = (await state(page)).projects[0].path
  const original = await git(root, 'branch', '--show-current')
  const branch = `test/live-${randomUUID()}`, subject = `External commit ${randomUUID()}`
  await page.locator('.panel-tools').getByRole('button', { name: 'Git', exact: true }).click()
  const panel = page.locator('.git-workbench')
  await panel.getByLabel('Commit message').fill('Keep this draft')
  await writeFile(join(root, 'hello.txt'), `first edit ${subject}\n`)
  await expect(panel.getByRole('button', { name: 'Stage: hello.txt', exact: true })).toBeVisible({ timeout: 8000 })
  await panel.getByRole('button', { name: 'Review diff', exact: true }).last().click()
  await expect(panel.locator('.diff-view')).toContainText(`first edit ${subject}`)
  await writeFile(join(root, 'hello.txt'), `second edit ${subject}\n`)
  await expect(panel.locator('.diff-view')).toContainText(`second edit ${subject}`, { timeout: 8000 })
  await git(root, 'add', 'hello.txt')
  await git(root, 'commit', '-m', subject)
  await expect(panel.locator('.diff-view')).toContainText('No diff available.', { timeout: 8000 })
  await panel.getByRole('button', { name: 'Back to list', exact: true }).click()
  await expect(panel.getByLabel('Commit message')).toHaveValue('Keep this draft')
  await expect(panel.getByText('Working tree clean', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'History', exact: true }).click()
  await expect(panel.locator('.commit-list')).toContainText(subject)
  try {
    await git(root, 'switch', '-c', branch)
    await expect(panel.locator('.git-repository-header')).toContainText(branch, { timeout: 8000 })
    await sidebar(page)
    await expect(page.locator('.workspace-picker > summary')).toContainText(branch, { timeout: 8000 })
  } finally { await git(root, 'switch', original) }
})

test('external worktree creation and deletion update the picker and recover the active conversation', async ({ page }) => {
  const initial = await state(page), project = initial.projects[0]
  const branch = `test/tree-${randomUUID()}`, path = join(dirname(project.path), randomUUID())
  await page.getByLabel('Message for Alfred').fill('Main chat draft')
  await sidebar(page)
  await page.locator('.workspace-picker > summary').click()
  await git(project.path, 'worktree', 'add', '-b', branch, path)
  await expect(page.locator('.workspace-row button').filter({ hasText: branch }).first()).toBeVisible({ timeout: 8000 })
  const response = await page.request.post('/api/conversations', { data: { projectId: project.id, workspacePath: path } })
  expect(response.ok()).toBe(true)
  const conversation: Conversation = await response.json()
  await expect.poll(async () => (await state(page)).conversations.some((item) => item.id === conversation.id)).toBe(true)
  await page.locator('.workspace-row button').filter({ hasText: branch }).first().click()
  await expect(page.locator('.workspace-picker > summary')).toContainText(branch)
  await git(project.path, 'worktree', 'remove', path)
  await expect(page.locator('.workspace-picker > summary')).not.toContainText(branch, { timeout: 8000 })
  const close = page.locator('.sidebar').getByRole('button', { name: 'Close sidebar', exact: true })
  if (await close.isVisible()) await close.click()
  await expect(page.getByLabel('Message for Alfred')).toHaveValue('Main chat draft')
  await sidebar(page)
  await page.locator('.workspace-picker > summary').click()
  await expect(page.locator('.workspace-row button').filter({ hasText: branch })).toHaveCount(0)
})

test('worktree deletion from another client updates the current selection immediately', async ({ page }) => {
  const initial = await state(page), project = initial.projects[0]
  const branch = `test/remote-${randomUUID()}`
  const created = await page.request.post(`/api/projects/${project.id}/worktrees`, { data: { branch } })
  expect(created.ok()).toBe(true)
  const { path } = await created.json()
  expect((await page.request.post('/api/conversations', { data: { projectId: project.id, workspacePath: path } })).ok()).toBe(true)
  await sidebar(page)
  await page.locator('.workspace-picker > summary').click()
  await page.locator('.workspace-row button').filter({ hasText: branch }).first().click()
  await expect(page.locator('.workspace-picker > summary')).toContainText(branch)
  expect((await page.request.delete(`/api/projects/${project.id}/worktrees`, { data: { path } })).ok()).toBe(true)
  await expect(page.locator('.workspace-picker > summary')).not.toContainText(branch)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('alfred.conversation'))).toBe(initial.conversations.find((item) => item.workspacePath === project.path)!.id)
})
