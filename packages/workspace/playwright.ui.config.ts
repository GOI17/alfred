import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: ['ui-primitives.spec.ts', 'chat-controls.spec.ts', 'chat-runtime.spec.ts'],
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4315', headless: true, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 320, height: 720 } } },
  ],
  webServer: {
    command: 'pnpm exec vite . --config vite.config.ts --configLoader runner --host 127.0.0.1 --port 4315 --strictPort',
    url: 'http://127.0.0.1:4315/tests/ui-primitives.html',
    reuseExistingServer: false,
  },
})
