import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright'
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
  streamQueue: Promise<void>
  stream?: CDPSession
  streamPage?: Page
  closed: boolean
  location?: string
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
      streamQueue: Promise.resolve(),
      closed: false,
      // Only lightweight URL/title metadata is polled; images come from CDP.
      timer: setInterval(() => void this.location(session), 500),
    }
    this.watchContext(session, context)
    this.watch(session, page)
    return session
  }
  private watchContext(session: Session, context: BrowserContext) {
    context.on('page', (popup) => {
      session.page = popup
      this.watch(session, popup)
      void this.syncStream(session)
    })
  }
  private watch(session: Session, page: Page) {
    page.on('dialog', (dialog) => void dialog.dismiss().catch(() => undefined))
    page.on('crash', () =>
      this.send(session, {
        type: 'error',
        message: 'This page stopped responding. Reload the panel.',
      }),
    )
  }
  private send(session: Session, value: unknown) {
    const data = JSON.stringify(value)
    for (const socket of session.sockets)
      if (socket.readyState === socket.OPEN && socket.bufferedAmount < 1_000_000)
        socket.send(data)
  }
  private async location(session: Session) {
    if (!session.sockets.size || session.capturing || session.page.isClosed()) return
    session.capturing = true
    const page = session.page
    try {
      const value = {
        type: 'location',
        url: page.url(),
        title: await page.title(),
        insecure: session.insecure,
        ...page.viewportSize(),
      }
      if (page !== session.page) return
      const serialized = JSON.stringify(value)
      if (serialized !== session.location) {
        session.location = serialized
        this.send(session, value)
      }
    } catch {
      /* Navigation can replace the execution context. */
    } finally {
      session.capturing = false
    }
  }
  private syncStream(session: Session) {
    session.streamQueue = session.streamQueue.then(async () => {
      const page = session.page
      const active = !session.closed && session.sockets.size > 0 && !page.isClosed()
      if (active && session.stream && session.streamPage === page) return
      const previous = session.stream
      session.stream = undefined
      session.streamPage = undefined
      if (previous) await previous.detach().catch(() => undefined)
      if (!active) return
      const stream = await session.context.newCDPSession(page)
      session.stream = stream
      session.streamPage = page
      stream.on('Page.screencastFrame', ({ data, sessionId }) => {
        // Always acknowledge, including dropped frames: slow clients must not stall Chromium.
        void stream.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined)
        if (session.closed || session.stream !== stream || session.page !== page) return
        const image = Buffer.from(data, 'base64')
        for (const socket of session.sockets)
          if (socket.readyState === socket.OPEN && socket.bufferedAmount === 0)
            socket.send(image)
        void this.location(session)
      })
      try {
        await stream.send('Page.startScreencast', {
          format: 'jpeg', quality: 70, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1,
        })
      } catch (error) {
        session.stream = undefined
        session.streamPage = undefined
        await stream.detach().catch(() => undefined)
        throw error
      }
    }).catch((error) => {
      if (!session.closed) this.send(session, {
        type: 'error',
        message: error instanceof Error ? error.message.slice(0, 600) : 'Could not stream the page.',
      })
    })
    return session.streamQueue
  }
  async attach(id: string, socket: WebSocket) {
    let pending = this.sessions.get(id)
    if (!pending) {
      pending = this.create()
      this.sessions.set(id, pending)
      pending.catch(() => this.sessions.delete(id))
    }
    const session = await pending
    if (socket.readyState !== socket.OPEN || session.closed) return
    session.sockets.add(socket)
    session.location = undefined
    socket.on('close', () => {
      session.sockets.delete(socket)
      void this.syncStream(session)
    })
    const report = (error: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({
        type: 'error',
        message: error instanceof Error ? error.message.slice(0, 600) : 'Could not open the page.',
      }))
    }
    let scroll: { x: number; y: number } | undefined
    socket.on('message', (raw) => {
      let message: ReturnType<typeof browserInput.parse>
      try {
        message = browserInput.parse(JSON.parse(raw.toString()))
      } catch (error) {
        report(error)
        return
      }
      // Merge consecutive wheel events while the input queue is busy, preserving order.
      if (message.type === 'scroll') {
        if (scroll) {
          scroll.x += message.x
          scroll.y += message.y
          return
        }
        const delta = { x: message.x, y: message.y }
        scroll = delta
        session.queue = session.queue.then(async () => {
          if (scroll === delta) scroll = undefined
          if (!session.closed) await session.page.mouse.wheel(delta.x, delta.y)
        }).catch(report)
        return
      }
      scroll = undefined
      session.queue = session.queue
        .then(async () => {
          if (session.closed) return
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
              this.watchContext(session, context)
              await this.syncStream(session)
            }
            await session.page.goto(url, { waitUntil: 'commit', timeout: 20_000 })
          } else if (message.type === 'click') await page.mouse.click(message.x, message.y)
          else if (message.type === 'key') await page.keyboard.press(message.key)
          else if (message.type === 'text') await page.keyboard.insertText(message.text)
          else if (message.type === 'resize')
            await page.setViewportSize({ width: message.width, height: message.height })
          else if (message.type === 'back') await page.goBack({ waitUntil: 'commit', timeout: 20_000 })
          else if (message.type === 'forward')
            await page.goForward({ waitUntil: 'commit', timeout: 20_000 })
          else await page.reload({ waitUntil: 'commit', timeout: 20_000 })
          void this.location(session)
        })
        .catch(report)
    })
    void this.location(session)
    await this.syncStream(session)
    // Seed reconnects and additional viewers even if the page is currently static.
    try {
      const image = await session.page.screenshot({ type: 'jpeg', quality: 70, timeout: 4000 })
      if (socket.readyState === socket.OPEN && socket.bufferedAmount === 0) socket.send(image)
    } catch { /* Navigation may interrupt this one-time seed frame. */ }
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'ready' }))
  }
  async remove(id: string) {
    const pending = this.sessions.get(id)
    this.sessions.delete(id)
    if (!pending) return
    const session = await pending.catch(() => undefined)
    if (!session) return
    session.closed = true
    clearInterval(session.timer)
    for (const socket of session.sockets) socket.close()
    await this.syncStream(session)
    await session.context.close()
  }
  async close() {
    await Promise.all([...this.sessions.keys()].map((id) => this.remove(id)))
    await (await this.browser?.catch(() => undefined))?.close()
  }
}
