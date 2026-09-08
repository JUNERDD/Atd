import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'electron.spec.ts',
  timeout: 30_000,
  workers: 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
