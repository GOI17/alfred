import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  cacheDir: fileURLToPath(new URL('./.cache/vite', import.meta.url)),
  plugins: [react()],
  server: {
    fs: {
      allow: [
        fileURLToPath(new URL('.', import.meta.url)),
      ],
    },
    allowedHosts: ['alfredworkspace.alfredlabs.org'],
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/client', import.meta.url)),
    emptyOutDir: true,
  },
})
