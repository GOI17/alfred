import { expect, test, type Page } from '@playwright/test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QRCodeSVG } from 'qrcode.react'

// These cases exercise authentication itself, unlike the other UI fixtures.
test.use({ storageState: { cookies: [], origins: [] } })

const code = 'alfred-chat-lab-only'
const link = `http://127.0.0.1:4312/#connectionCode=${code}`

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('alfred.language', 'en')
    localStorage.setItem('alfred.notifications.prompted', 'true')
    window.name = 'original-app-window'
  })
})

/** Real QR decoding from a video stream, with no physical camera or permission dialog. */
async function camera(page: Page, value?: string, delayed = false) {
  const svg = value ? renderToStaticMarkup(createElement(QRCodeSVG, { value, size: 480, marginSize: 4, xmlns: 'http://www.w3.org/2000/svg' })) : ''
  await page.addInitScript(({ svg, delayed }) => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => {
      document.documentElement.dataset.cameraRequested = 'true'
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 480
      const context = canvas.getContext('2d')!
      context.fillStyle = 'white'
      context.fillRect(0, 0, 480, 480)
      if (svg) {
        const image = new Image()
        image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`
        await image.decode()
        context.drawImage(image, 0, 0)
      }
      const stream = canvas.captureStream(5)
      // WebKit emits frames when the canvas is painted.
      const repaint = setInterval(() => context.fillRect(0, 0, 1, 1), 100)
      const track = stream.getVideoTracks()[0]
      const stop = track.stop.bind(track)
      track.stop = () => {
        clearInterval(repaint)
        stop()
        document.documentElement.dataset.cameraStopped = track.readyState
      }
      if (delayed) await new Promise<void>((resolve) => document.addEventListener('grant-test-camera', () => resolve(), { once: true }))
      return stream
    } } })
  }, { svg, delayed })
}
async function expectAuthenticated(page: Page) {
  await expect(page.locator('.workspace-header')).toBeVisible()
  expect((await page.request.get('/api/state')).ok()).toBe(true)
  expect(await page.evaluate(() => window.name)).toBe('original-app-window')
  expect(page.url()).toBe('http://127.0.0.1:4312/')
}

test('pastes a connection link and authenticates in the current app', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Connection code', { exact: true }).fill(link)
  await page.getByRole('button', { name: 'Enter my workspace' }).click()
  await expectAuthenticated(page)
})

test('scans a real QR inside the installed app and stops the camera before authentication', async ({ page }, testInfo) => {
  await camera(page, link)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Scan QR' })).toBeVisible()
  expect(await page.locator('html').getAttribute('data-camera-requested')).toBeNull()
  await page.screenshot({ path: testInfo.outputPath('pwa-login.png') })
  await page.getByRole('button', { name: 'Scan QR' }).click()
  await expect(page.getByRole('status')).toHaveText('QR ready. Tap Enter my workspace to connect.')
  await expect(page.getByLabel('Connection code', { exact: true })).toHaveValue(code)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('data-camera-stopped', 'ended')
  expect((await page.request.get('/api/state')).status()).toBe(401)
  await page.getByRole('button', { name: 'Enter my workspace' }).click()
  await expectAuthenticated(page)
})

test('stops the camera on cancel and when the app leaves the foreground', async ({ page }) => {
  await camera(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Scan QR' }).click()
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-camera-stopped', 'ended')
  await page.evaluate(() => { delete document.documentElement.dataset.cameraStopped })
  await page.getByRole('button', { name: 'Scan QR' }).click()
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('data-camera-stopped', 'ended')
})

test('stops a late camera permission result after cancellation', async ({ page }) => {
  await camera(page, undefined, true)
  await page.goto('/')
  await page.getByRole('button', { name: 'Scan QR' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-camera-requested', 'true')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.evaluate(() => document.dispatchEvent(new Event('grant-test-camera')))
  await expect(page.locator('html')).toHaveAttribute('data-camera-stopped', 'ended')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('keeps manual entry available when camera access is denied', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', { value: {
    getUserMedia: async () => { throw new DOMException('Denied', 'NotAllowedError') },
  },
  }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Scan QR' }).click()
  await expect(page.getByRole('alert')).toContainText('Could not use the camera.')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByLabel('Connection code', { exact: true }).fill(code)
  await expect(page.getByRole('button', { name: 'Enter my workspace' })).toBeEnabled()
})

test('rejects QR and pasted links for another server without navigating or submitting credentials', async ({ page }) => {
  await camera(page, 'https://other.example/#connectionCode=secret')
  let authentications = 0
  page.on('request', (request) => { if (request.url().endsWith('/api/auth')) authentications++ })
  await page.goto('/')
  await page.getByRole('button', { name: 'Scan QR' }).click()
  await expect(page.getByRole('alert')).toContainText('This link belongs to another server.')
  await expect(page.locator('html')).toHaveAttribute('data-camera-stopped', 'ended')
  await expect(page.getByLabel('Connection code', { exact: true })).toHaveValue('')
  await page.getByLabel('Connection code', { exact: true }).fill('https://other.example/#connectionCode=secret')
  await page.getByRole('button', { name: 'Enter my workspace' }).click()
  await expect(page.getByRole('alert')).toContainText('This link belongs to another server.')
  expect(authentications).toBe(0)
  expect(page.url()).toBe('http://127.0.0.1:4312/')
})

test('offers a browser-to-PWA code handoff without consuming the code and removes it from the address', async ({ page }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: {
    writeText: async (text: string) => { document.documentElement.dataset.copiedCode = text },
  } }))
  let authentications = 0
  page.on('request', (request) => { if (request.url().endsWith('/api/auth')) authentications++ })
  await page.goto(link)
  await expect(page.getByLabel('Connection code', { exact: true })).toHaveValue(code)
  await expect(page).toHaveURL('/')
  await page.getByRole('button', { name: 'Copy connection code', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-copied-code', code)
  await expect(page.getByRole('button', { name: 'Code copied', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('browser-handoff.png') })
  expect(authentications).toBe(0)
})
