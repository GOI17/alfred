import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const runtimeDir = dirname(require.resolve('@huggingface/transformers'))

// ONNX imports the JS glue by URL at runtime. Serve it verbatim: Vite's
// dependency optimizer can otherwise resolve its default export as a function.
function whisperRuntime(): Plugin {
  const assets = new Map([
    ['whisper-runtime/ort-wasm-simd-threaded.jsep.mjs', 'text/javascript'],
    ['whisper-runtime/ort-wasm-simd-threaded.jsep.wasm', 'application/wasm'],
  ])
  const source = (name: string) => readFileSync(join(runtimeDir, name.slice('whisper-runtime/'.length)))
  return {
    name: 'whisper-runtime-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0].slice(1) ?? ''
        const mime = assets.get(name)
        if (!mime) return next()
        res.setHeader('Content-Type', mime)
        res.end(source(name))
      })
    },
    generateBundle() {
      for (const name of assets.keys()) this.emitFile({ type: 'asset', fileName: name, source: source(name) })
    },
  }
}

export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  cacheDir: fileURLToPath(new URL('./.cache/vite', import.meta.url)),
  // The isolated npm build also installs React DOM 18 under Atlaskit.
  // Resolve every renderer import (including subpaths) to Workspace's React pair.
  resolve: { dedupe: ['react', 'react-dom'] },
  worker: { format: 'es' },
  plugins: [react(), whisperRuntime()],
  server: {
    fs: {
      allow: [
        fileURLToPath(new URL('.', import.meta.url)),
        dirname(require.resolve('@huggingface/transformers')),
      ],
    },
    allowedHosts: ['alfredworkspace.alfredlabs.org'],
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/client', import.meta.url)),
    emptyOutDir: true,
  },
})
