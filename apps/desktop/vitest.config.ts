import { defineConfig } from 'vitest/config';
import { reactPlugin, workspaceResolve } from './vite.shared.js';

export default defineConfig({
  // Tests run the same compiled components and resolve workspace packages like the app.
  plugins: [reactPlugin()],
  resolve: workspaceResolve,
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // DOM interactions share the runner with service tests and production builds.
    maxWorkers: 2,
    testTimeout: 15_000,
    restoreMocks: true,
    clearMocks: true,
  },
});
