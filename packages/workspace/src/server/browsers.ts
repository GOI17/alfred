import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import type { WebSocket } from 'ws'
import { browserInput } from '../shared/contracts.js'

type Session = {
  context: BrowserContext
  page: Page
  sockets: Set<WebSocket>
  insecure: boolean
  timer: ReturnType<typeof setInterval>
  capturing: boolean
  queue: Promise<unknown>
}
export function browserUrl(input: string) {
  const value = input.trim()
  const url = new URL(
    /^[a-z][a-z\d+.-]*:/i.test(value) && !/^localhost:\d/i.test(value)
      ? value
      : `${/^(localhost|127\.|\[::1\])/.test(value) ? 'http' : 'https'}://${value}`,
  )
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Use an HTTP or HTTPS address without credentials.')
  return url.href
}
export class Browsers {
  private browser?: Promise<Browser>
  private sessions = new Map<string, Promise<Session>>()
  private async create() {
    this.browser ??= chromium
      .launch({ headless: true, env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1' } })
      .catch((error) => {
        this.browser = undefined
        throw error
      })
    const context = await (
      await this.browser
    ).newContext({ viewport: { width: 1100, height: 760 } })
    const page = await context.newPage()
    const session: Session = {
      context,
      page,
      sockets: new Set(),
      insecure: false,
      capturing: false,
      queue: Promise.resolve(),
      timer: setInterval(() => void this.capture(session), 500),
    }
    this.watch(session, page)
    context.on('page', (popup) => {
      session.page = popup
      this.watch(session, popup)
    })
    return session
  }
  private watch(session: Session, page: Page) {
    page.on('dialog', (dialog) => void dialog.dismiss())
    page.on('crash', () =>
      this.send(session, {
        type: 'error',
        message: 'This page stopped responding. Reload the panel.',
      }),
    )
  }
  private send(session: Session, value: unknown) {
    for (const socket of session.sockets)
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(value))
  }
  private async capture(session: Session) {
    if (!session.sockets.size || session.capturing || session.page.isClosed()) return
    session.capturing = true
    try {
      const image = await session.page.screenshot({ type: 'jpeg', quality: 70, timeout: 4000 })
      this.send(session, {
        type: 'location',
        url: session.page.url(),
        title: await session.page.title(),
        insecure: session.insecure,
        ...session.page.viewportSize(),
      })
      for (const socket of session.sockets)
        if (socket.readyState === socket.OPEN && socket.bufferedAmount < 1_000_000)
          socket.send(image)
    } catch {
      /* Navigation can replace the frame while capturing. */
    } finally {
      session.capturing = false
    }
  }
  async attach(id: string, socket: WebSocket) {
    let pending = this.sessions.get(id)
    if (!pending) {
      pending = this.create()
      this.sessions.set(id, pending)
      pending.catch(() => this.sessions.delete(id))
    }
    const session = await pending
    if (socket.readyState !== socket.OPEN) return
    session.sockets.add(socket)
    socket.on('close', () => session.sockets.delete(socket))
    socket.on('message', (raw) => {
      session.queue = session.queue
        .then(async () => {
          const message = browserInput.parse(JSON.parse(raw.toString()))
          const page = session.page
          if (message.type === 'navigate') {
            const url = browserUrl(message.url)
            if (message.insecure !== session.insecure) {
              const context = await (
                await this.browser
              )?.newContext({
                ignoreHTTPSErrors: message.insecure,
                viewport: page.viewportSize() ?? undefined,
              })
              if (!context) throw new Error('Browser unavailable.')
              await session.context.close()
              session.context = context
              session.page = await context.newPage()
              session.insecure = message.insecure
              this.watch(session, session.page)
              context.on('page', (popup) => {
                session.page = popup
                this.watch(session, popup)
              })
            }
            await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
          } else if (message.type === 'click') await page.mouse.click(message.x, message.y)
          else if (message.type === 'key') await page.keyboard.press(message.key)
          else if (message.type === 'text') await page.keyboard.insertText(message.text)
          else if (message.type === 'scroll') await page.mouse.wheel(message.x, message.y)
          else if (message.type === 'resize')
            await page.setViewportSize({ width: message.width, height: message.height })
          else if (message.type === 'back') await page.goBack({ waitUntil: 'domcontentloaded' })
          else if (message.type === 'forward')
            await page.goForward({ waitUntil: 'domcontentloaded' })
          else await page.reload({ waitUntil: 'domcontentloaded' })
          void this.capture(session)
        })
        .catch(
          (error) =>
            socket.readyState === socket.OPEN &&
            socket.send(
              JSON.stringify({
                type: 'error',
                message:
                  error instanceof Error
                    ? error.message.slice(0, 600)
                    : 'Could not open the page.',
              }),
            ),
        )
    })
    void this.capture(session)
    socket.send(JSON.stringify({ type: 'ready' }))
  }
  async remove(id: string) {
    const pending = this.sessions.get(id)
    this.sessions.delete(id)
    if (!pending) return
    const session = await pending.catch(() => undefined)
    if (!session) return
    clearInterval(session.timer)
    for (const socket of session.sockets) socket.close()
    await session.context.close()
  }
  async close() {
    await Promise.all([...this.sessions.keys()].map((id) => this.remove(id)))
    await (await this.browser?.catch(() => undefined))?.close()
  }
}
