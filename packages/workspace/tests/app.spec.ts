import { test, expect, type Page } from '@playwright/test'
import { mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { gitFixture } from './fixtures.js'

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => { localStorage.setItem('alfred.notifications.prompted', 'true'); localStorage.setItem('alfred.language', 'en') })
})

test('native selection cancellation keeps projects unchanged and remote errors stay visible', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  await page.getByLabel('Connection code').fill('alfred-e2e-only')
  await page.getByRole('button', { name: 'Enter my workspace' }).click()
  const before = await (await page.request.get('/api/state')).json()
  let selections = 0
  await page.route('**/api/projects/pick', async (route) => {
    selections++
    await route.fulfill(
      selections === 1
        ? { json: { project: null } }
        : {
            status: 403,
            json: {
              error: 'Add projects from localhost on the computer running Alfred.',
            },
          },
    )
  })
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (testInfo.project.name === 'phone')
      await page.getByRole('button', { name: 'Open spaces' }).click()
    await page.locator('.sidebar').getByRole('button', { name: 'Add space', exact: true }).click()
    await expect.poll(() => selections).toBe(attempt)
    await expect(page.getByRole('status')).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  await expect(page.getByRole('alert')).toContainText('Add projects from localhost')
  expect((await (await page.request.get('/api/state')).json()).projects).toEqual(before.projects)
})

async function selectFolder(page: Page, path: string) {
  await page.route('**/api/projects/pick', async (route) => {
    const response = await page.request.post('/api/projects', { data: { path } })
    expect(response.ok()).toBe(true)
    await route.fulfill({ json: { project: await response.json() } })
  })
  const response = page.waitForResponse('**/api/projects/pick')
  await page.locator('.sidebar').getByRole('button', { name: 'Add space', exact: true }).click()
  await response
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('project, native chat, panels, worktrees and mobile navigation', async ({
  page,
}, testInfo) => {
  const files = await gitFixture()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let projectId = ''
  let observer: Page | undefined
  try {
    if (testInfo.project.name === 'phone')
      await page.addInitScript(() =>
        Object.defineProperty(crypto, 'randomUUID', { value: undefined }),
      )
    await page.goto('/')
    await page.getByLabel('Connection code').fill('alfred-e2e-only')
    await page.getByRole('button', { name: 'Enter my workspace' }).click()
    const mobile = testInfo.project.name === 'phone'
    async function sidebar() {
      if (mobile) await page.getByRole('button', { name: 'Open spaces' }).click()
    }
    await sidebar()
    await selectFolder(page, files.repository)
    const state = await (await page.request.get('/api/state')).json()
    projectId = state.projects.find((item: { path: string }) => item.path === files.repository).id
    expect(state.projects.find((item: { id: string }) => item.id === projectId).name).toBe(
      'project with spaces',
    )
    await page.getByRole('button', { name: 'New conversation', exact: true }).first().click()
    await expect(page.getByRole('heading', { name: 'What shall we build today?' })).toBeVisible()
    await page.getByRole('button', { name: 'Explore this project' }).click()
    await expect(page.getByLabel('Message for Alfred')).toHaveValue('Explore this project')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue with ChatGPT' })).toBeVisible()
    await page.getByRole('button', { name: 'Back to workspace', exact: true }).click()
    if (!mobile) {
      await page.getByRole('button', { name: 'Terminal', exact: true }).click()
      await expect(page.getByText('Shared session')).toBeVisible()
    }
    await page.getByRole('button', { name: 'Git', exact: true }).click()
    await page.getByRole('button', { name: 'History', exact: true }).click()
    await expect(page.getByRole('button', { name: /The first idea/ })).toBeVisible()
    await page.getByRole('button', { name: /The first idea/ }).click()
    await expect(page.getByText('+hello', { exact: true })).toBeVisible()
    if (mobile) await page.getByRole('button', { name: 'Hide Git', exact: true }).click()
    await expect(page.getByLabel('Message for Alfred')).toHaveValue('Explore this project')
    if (mobile) await page.getByRole('button', { name: 'Git', exact: true }).click()
    await page.screenshot({ path: testInfo.outputPath('workspace.png') })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    observer = await page.context().newPage()
    await observer.goto('/')
    if (mobile) await observer.getByRole('button', { name: 'Open spaces' }).click()
    await observer.locator('.workspace-picker > summary').click()
    await expect(
      observer.getByRole('button', { name: 'New worktree', exact: true }),
    ).toBeVisible()
    await sidebar()
    await page.locator('.workspace-picker > summary').click()
    await page.getByRole('button', { name: 'New worktree', exact: true }).click()
    await page.getByLabel('New branch name').fill('feature/phone')
    await page.getByRole('button', { name: 'Create worktree', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'What shall we build today?' })).toBeVisible()
    await expect(observer.getByRole('button', { name: 'feature/phone', exact: true })).toBeVisible()
    await sidebar()
    await page.locator('.workspace-picker > summary').click()
    await page.getByRole('button', { name: 'Delete worktree feature/phone', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm deletion' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Delete worktree feature/phone', exact: true }),
    ).toHaveCount(0)
    await expect(observer.getByRole('button', { name: 'feature/phone', exact: true })).toHaveCount(
      0,
    )
    expect(errors).toEqual([])
  } finally {
    await observer?.close()
    if (projectId) await page.request.delete(`/api/projects/${projectId}`)
    await rm(files.root, { recursive: true, force: true })
  }
})

test('adds and removes an ordinary folder without deleting its files', async ({
  page,
}, testInfo) => {
  const files = await gitFixture()
  const folder = join(files.root, 'plain folder')
  await mkdir(folder)
  let id = ''
  try {
    await page.goto('/')
    await page.getByLabel('Connection code').fill('alfred-e2e-only')
    await page.getByRole('button', { name: 'Enter my workspace' }).click()
    if (testInfo.project.name === 'phone')
      await page.getByRole('button', { name: 'Open spaces' }).click()
    await selectFolder(page, folder)
    const state = await (await page.request.get('/api/state')).json()
    id = state.projects.find((item: { path: string }) => item.path === folder).id
    if (testInfo.project.name === 'phone')
      await page.getByRole('button', { name: 'Open spaces' }).click()
    await expect(page.getByRole('button', { name: 'plain folder', exact: true })).toBeVisible()
    await page.locator('.workspace-picker > summary').click()
    await expect(page.getByRole('button', { name: 'New worktree' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Project actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Remove project', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm deletion' }).click()
    await expect(page.getByRole('button', { name: 'plain folder', exact: true })).toHaveCount(0)
    expect((await stat(folder)).isDirectory()).toBe(true)
  } finally {
    if (id) await page.request.delete(`/api/projects/${id}`)
    await rm(files.root, { recursive: true, force: true })
  }
})
