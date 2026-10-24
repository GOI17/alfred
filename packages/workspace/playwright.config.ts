import { defineConfig, devices } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  testIgnore: [
    'chat-lab',
    'ui-spaces',
    'notification-preferences',
    'worktree-dialog',
    'git-live',
    'device-connection',
    'harnesses',
  ].map((name) => `**/${name}.spec.ts`),
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4311',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node scripts/cli.mjs serve',
    url: 'http://127.0.0.1:4311',
    reuseExistingServer: false,
    env: {
      ORCA_BACKGROUND_LAUNCH: '1',
      ALFRED_PORT: '4311',
      ALFRED_HOST: '127.0.0.1',
      ALFRED_WORKSPACE_DATA_DIR: join(tmpdir(), `alfred-workspace-e2e-${process.pid}`),
      ALFRED_ACCESS_TOKEN: 'alfred-e2e-only',
    },
  },
})
