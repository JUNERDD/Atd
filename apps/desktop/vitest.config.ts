import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { reactCompiler } from './plugins/react-compiler.js';

export default defineConfig({
  // Tests run the same compiled components the app ships.
  plugins: [react(), reactCompiler()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    clearMocks: true,
  },
});
