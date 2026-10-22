import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  timeout: 30_000,
  expect: { timeout: 5_000, toHaveScreenshot: { maxDiffPixels: 15 } },
  use: {
    baseURL: 'http://127.0.0.1:5173', browserName: 'chromium', channel: 'chrome',
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce',
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:5173/',
    reuseExistingServer: !process.env.CI, timeout: 30_000,
  },
});
