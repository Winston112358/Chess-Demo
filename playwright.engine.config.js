import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/engine-browser',
  outputDir: './test-results/engine',
  workers: 1,
  timeout: 90_000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    channel: 'msedge',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
  },
});
