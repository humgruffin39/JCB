import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: false,
  workers: 4,
  retries: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm --filter @jcb/web build && pnpm --filter @jcb/web preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
  projects: [
    {
      name: 'mobile-ios-360',
      use: { ...devices['iPhone 13 Mini'], viewport: { width: 360, height: 640 } },
    },
    {
      name: 'mobile-android-360',
      use: {
        ...devices['Pixel 5'],
        browserName: 'chromium',
        viewport: { width: 360, height: 640 },
      },
    },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
});
