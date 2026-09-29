import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'electron.spec.ts',
  // The smoke test launches Electron (downloading its binary on a fresh runner) and then waits up
  // to 30s for the service autostart, so the whole test needs more than that single step's budget.
  timeout: 90_000,
  workers: 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
