import { expect, test, type BrowserContext, type Page } from '@playwright/test'

let sessionCookies: Awaited<ReturnType<BrowserContext['cookies']>> = []
test.beforeAll(async ({ request }) => {
  // Reuse authentication so these UI cases do not hit the login rate limit.
  const response = await request.get('/api/state')
  expect(response.ok()).toBe(true)
  sessionCookies = (await request.storageState()).cookies
})

// Exercise the real UI and persistence without asking the OS for permission or
// creating a real push subscription.
async function notifications(page: Page, options: { active?: boolean; denied?: boolean; unavailable?: boolean } = {}) {
  await page.addInitScript((options) => {
    localStorage.setItem('alfred.language', 'en')
    const activeKey = 'test.push.active', permissionKey = 'test.push.permission'
    if (options.active && localStorage.getItem(activeKey) === null) {
      localStorage.setItem(activeKey, 'true')
      localStorage.setItem(permissionKey, 'granted')
    }
    Object.defineProperty(window, 'Notification', { configurable: true, value: {
      get permission() { return localStorage.getItem(permissionKey) || 'default' },
      async requestPermission() {
        localStorage.setItem('test.push.requests', String(Number(localStorage.getItem('test.push.requests')) + 1))
        const permission = options.denied ? 'denied' : 'granted'
        localStorage.setItem(permissionKey, permission)
        return permission
      },
    } })
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/ui-test',
      toJSON() { return { endpoint: this.endpoint, keys: { auth: 'test-auth', p256dh: 'test-key' } } },
      async unsubscribe() { localStorage.setItem(activeKey, 'false'); return true },
    }
    const worker = { pushManager: {
      async getSubscription() { return localStorage.getItem(activeKey) === 'true' ? subscription : null },
      async subscribe() { localStorage.setItem(activeKey, 'true'); return subscription },
    } }
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register: async () => worker, ready: Promise.resolve(worker) } })
    if (options.unavailable) Reflect.deleteProperty(window, 'PushManager')
    else Object.defineProperty(window, 'PushManager', { configurable: true, value: class {} })
  }, options)
  const requests: string[] = []
  await page.route('**/api/notifications', async (route) => {
    requests.push(route.request().method())
    await route.fulfill({ json: route.request().method() === 'GET' ? { publicKey: 'dGVzdA' } : { ok: true } })
  })
  return requests
}
async function login(page: Page) {
  await page.context().clearCookies()
  await page.goto('/')
  await expect(page.getByRole('dialog', { name: 'Enable notifications?' })).toHaveCount(0)
  await expect(page.getByLabel('Connection code')).toBeVisible()
  await page.context().addCookies(sessionCookies)
  await page.reload()
  await expect(page.locator('.app-shell')).toBeVisible()
}
async function settings(page: Page) {
  // Reload can finish before /api/state restores the navigation controls.
  await expect(page.locator('.app-shell')).toBeVisible()
  const opener = page.getByRole('button', { name: 'Open spaces', exact: true })
  if (await opener.isVisible()) await opener.click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Interface', exact: true }).click()
}

for (const dismissal of ['Not now', 'Close', 'Escape']) {
  test(`notification invitation stays dismissed after ${dismissal} and reload`, async ({ page }) => {
    const requests = await notifications(page)
    await login(page)
    const invitation = page.getByRole('dialog', { name: 'Enable notifications?' })
    await expect(invitation).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('test.push.requests'))).toBeNull()
    if (dismissal === 'Escape') await page.keyboard.press('Escape')
    else await invitation.getByRole('button', { name: dismissal, exact: true }).click()
    await expect(invitation).toHaveCount(0)
    await page.reload()
    await settings(page)
    await expect(page.getByRole('button', { name: 'Enable notifications', exact: true })).toBeEnabled()
    await expect(invitation).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('alfred.notifications.prompted'))).toBe('true')
    expect(requests).toEqual([])
  })
}

test('accepts once, resyncs on reload, and enables or disables in Settings only', async ({ page }) => {
  const requests = await notifications(page)
  await login(page)
  await page.getByRole('button', { name: 'Enable notifications', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(requests).toEqual(['GET', 'POST'])
  await page.reload()
  await expect.poll(() => requests.filter((method) => method === 'POST').length).toBe(2)
  await page.locator('.panel-tools').getByRole('button', { name: 'Activity', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: /notifications/i })).toHaveCount(0)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await settings(page)
  await page.getByRole('button', { name: 'Disable notifications', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Enable notifications', exact: true })).toBeEnabled()
  expect(requests.at(-1)).toBe('DELETE')
  await page.reload()
  await settings(page)
  await expect(page.getByRole('dialog', { name: 'Enable notifications?' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Enable notifications', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Disable notifications', exact: true })).toBeEnabled()
  expect(requests.slice(-2)).toEqual(['GET', 'POST'])
})

test('browser denial is remembered and can be revisited in Settings', async ({ page }) => {
  const requests = await notifications(page, { denied: true })
  await login(page)
  await page.getByRole('button', { name: 'Enable notifications', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Allow notifications in your browser settings.')
  await page.getByRole('button', { name: 'Not now', exact: true }).click()
  await page.reload()
  await settings(page)
  await expect(page.getByRole('button', { name: 'Enable notifications', exact: true })).toBeEnabled()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('test.push.requests'))).toBe('1')
  expect(requests).toEqual([])
})

test('an existing subscription skips the invitation and restores delivery', async ({ page }) => {
  const requests = await notifications(page, { active: true })
  await login(page)
  await settings(page)
  await expect(page.getByRole('button', { name: 'Disable notifications', exact: true })).toBeEnabled()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(requests).toEqual(['POST'])
  expect(await page.evaluate(() => localStorage.getItem('test.push.requests'))).toBeNull()
})

test('unsupported browsers show availability in Settings without an invitation', async ({ page }) => {
  await notifications(page, { unavailable: true })
  await login(page)
  await settings(page)
  await expect(page.getByRole('button', { name: 'Enable notifications', exact: true })).toBeDisabled()
  await expect(page.getByText(/Requires HTTPS and a browser with Web Push/)).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('opens Interface settings after a delayed workspace restore', async ({ page }) => {
  const requests = await notifications(page)
  await login(page)
  await page.getByRole('dialog', { name: 'Enable notifications?' }).getByRole('button', { name: 'Not now', exact: true }).click()
  let restore!: () => void
  let restoring!: () => void
  const held = new Promise<void>((resolve) => { restore = resolve })
  const intercepted = new Promise<void>((resolve) => { restoring = resolve })
  await page.route('**/api/state', async (route) => {
    restoring()
    await held
    await route.continue()
  })
  try {
    await page.reload()
    await intercepted
    await expect(page.locator('.loading-screen')).toBeVisible()
    const opening = settings(page)
    // Complete a browser round trip while state is held: the helper has begun
    // before the navigation controls exist, as on a slower CI runner.
    expect(await page.evaluate(() => !!document.querySelector('.loading-screen'))).toBe(true)
    restore()
    await opening
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Enable notifications', exact: true })).toBeEnabled()
    expect(requests).toEqual([])
  } finally { restore() }
})
