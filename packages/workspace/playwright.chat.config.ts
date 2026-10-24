import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  globalSetup: './tests/chat-setup.ts',
  testDir: './tests',
  testMatch: [
    'chat-lab.spec.ts',
    'ui-spaces.spec.ts',
    'notification-preferences.spec.ts',
    'worktree-dialog.spec.ts',
    'git-live.spec.ts',
    'device-connection.spec.ts',
    'harnesses.spec.ts',
  ],
  workers: 1,
  timeout: 30_000,
  outputDir: 'test-results/chat-lab',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/chat-lab', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4312',
    storageState: fileURLToPath(new URL('./.cache/chat-auth.json', import.meta.url)),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'iphone', testMatch: 'device-connection.spec.ts', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'node --import tsx tests/chat-lab-server.ts',
    url: 'http://127.0.0.1:4312',
    reuseExistingServer: false,
    env: { ORCA_BACKGROUND_LAUNCH: '1' },
  },
})
