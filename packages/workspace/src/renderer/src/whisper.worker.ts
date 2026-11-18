import { env, pipeline } from '@huggingface/transformers'

env.allowLocalModels = false
const runtime = env.backends.onnx.wasm!
runtime.numThreads = 1
const runtimeDir = new URL('/whisper-runtime/', self.location.href)
runtime.wasmPaths = {
  wasm: new URL('ort-wasm-simd-threaded.jsep.wasm', runtimeDir).href,
  mjs: new URL('ort-wasm-simd-threaded.jsep.mjs', runtimeDir).href,
}

self.onmessage = async ({ data }: MessageEvent<{ audio: Float32Array; language: string }>) => {
  let stage = 'model/runtime'
  try {
    const recognize = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base', { device: 'wasm', dtype: 'q8' })
    stage = 'transcription'
    self.postMessage({ ready: true })
    const result = await recognize(data.audio, { language: data.language, task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 })
    self.postMessage({ text: (Array.isArray(result) ? result[0] : result).text })
  } catch (error) {
    self.postMessage({ error: `${stage}: ${error instanceof Error ? error.message : String(error)}` })
  }
}
