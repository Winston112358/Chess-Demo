import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/assets',
  outputDir: './test-results/assets/artifacts',
  workers: 1,
  timeout: 180000,
  use: {
    channel: 'msedge',
    trace: 'retain-on-failure',
  },
});
