import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { liveRefresh } from '../src/renderer/src/live-refresh'

const documentEvents = Object.assign(new EventTarget(), { hidden: false })
const windowEvents = new EventTarget()
let stop: (() => void) | undefined
beforeEach(() => {
  vi.useFakeTimers()
  documentEvents.hidden = false
  vi.stubGlobal('document', documentEvents)
  vi.stubGlobal('window', windowEvents)
})
afterEach(() => { stop?.(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('pauses in hidden tabs and refreshes when visible or focused again', async () => {
  const load = vi.fn(async () => {})
  stop = liveRefresh(load, vi.fn())
  await vi.advanceTimersByTimeAsync(3000)
  expect(load).toHaveBeenCalledTimes(2)
  documentEvents.hidden = true
  documentEvents.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(30000)
  expect(load).toHaveBeenCalledTimes(2)
  documentEvents.hidden = false
  documentEvents.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(0)
  expect(load).toHaveBeenCalledTimes(3)
  windowEvents.dispatchEvent(new Event('focus'))
  expect(load).toHaveBeenCalledTimes(4)
})

it('coalesces focus events during a slow request and cancels on cleanup', async () => {
  let finish = () => {}
  const load = vi.fn((_signal: AbortSignal) => new Promise<void>((resolve) => { finish = resolve }))
  const error = vi.fn()
  stop = liveRefresh(load, error)
  windowEvents.dispatchEvent(new Event('focus'))
  windowEvents.dispatchEvent(new Event('focus'))
  await vi.advanceTimersByTimeAsync(10000)
  expect(load).toHaveBeenCalledTimes(1)
  finish()
  await vi.advanceTimersByTimeAsync(0)
  expect(load).toHaveBeenCalledTimes(2)
  const signal = load.mock.calls[1][0]
  stop()
  expect(signal.aborted).toBe(true)
  finish()
  windowEvents.dispatchEvent(new Event('focus'))
  await vi.advanceTimersByTimeAsync(10000)
  expect(load).toHaveBeenCalledTimes(2)
  expect(error).not.toHaveBeenCalled()
})

it('keeps refreshing after a transient failure', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  const error = vi.fn()
  stop = liveRefresh(load, error)
  await vi.advanceTimersByTimeAsync(3000)
  expect(error).toHaveBeenCalledOnce()
  expect(load).toHaveBeenCalledTimes(2)
})
