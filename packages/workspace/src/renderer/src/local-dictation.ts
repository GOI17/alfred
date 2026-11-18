export async function localDictation(blob: Blob, language: string, signal: AbortSignal, ready: () => void) {
  const context = new OfflineAudioContext(1, 1, 16000)
  const decoded = await context.decodeAudioData(await blob.arrayBuffer())
  signal.throwIfAborted()
  const render = new OfflineAudioContext(1, decoded.length, 16000)
  const source = render.createBufferSource()
  source.buffer = decoded
  source.connect(render.destination)
  source.start()
  const audio = (await render.startRendering()).getChannelData(0)
  signal.throwIfAborted()
  const worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
  let abort: () => void = () => {}
  try {
    return await new Promise<string>((resolve, reject) => {
      abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      worker.onerror = event => reject(new Error(`Worker: ${event.message || 'Whisper initialization failed'}`))
      worker.onmessage = ({ data }) => {
        if (data.ready) ready()
        else if (typeof data.text === 'string') resolve(data.text)
        else reject(new Error(typeof data.error === 'string' ? data.error : 'Unexpected Whisper response'))
      }
      worker.postMessage({ audio, language }, [audio.buffer])
    })
  } finally { signal.removeEventListener('abort', abort); worker.terminate() }
}
