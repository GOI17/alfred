/** Refresh visible views without overlapping requests or keeping hidden tabs busy. */
export function liveRefresh(
  load: (signal: AbortSignal) => Promise<void>,
  onError: (error: unknown) => void,
  interval: number | null = 3000,
) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false, pending = false
  async function refresh() {
    clearTimeout(timer)
    if (controller.signal.aborted || document.hidden) return
    if (running) { pending = true; return }
    running = true
    try { await load(controller.signal) }
    catch (error) { if (!controller.signal.aborted) onError(error) }
    finally {
      running = false
      if (!controller.signal.aborted && !document.hidden && (pending || interval !== null))
        timer = setTimeout(refresh, pending ? 0 : interval!)
      pending = false
    }
  }
  const resume = () => { void refresh() }
  window.addEventListener('focus', resume)
  document.addEventListener('visibilitychange', resume)
  void refresh()
  return () => {
    controller.abort()
    clearTimeout(timer)
    window.removeEventListener('focus', resume)
    document.removeEventListener('visibilitychange', resume)
  }
}
