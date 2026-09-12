import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import electron from 'vite-plugin-electron/simple';
import type { ElectronOptions } from 'vite-plugin-electron';

const dependencies = Object.keys(
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).dependencies,
);

const startElectron: NonNullable<ElectronOptions['onstart']> = async ({ startup }) => {
  // Explicit arguments retain Chromium's sandbox in development as well as production.
  await startup(['.']);
};

export default defineConfig(({ mode, command }) => ({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'local-development-csp',
      transformIndexHtml(html) {
        // React Fast Refresh injects a preamble only in the local development server.
        return command === 'serve'
          ? html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
          : html;
      },
    },
    ...(mode === 'web'
      ? []
      : [
          electron({
            main: {
              entry: ['electron/main.ts', 'electron/agent/worker.ts'],
              onstart: startElectron,
              vite: {
                build: {
                  rolldownOptions: {
                    external: (id) =>
                      dependencies.some((name) => id === name || id.startsWith(`${name}/`)),
                  },
                },
              },
            },
            preload: {
              input: 'electron/preload.ts',
              onstart: startElectron,
              vite: {
                build: {
                  rolldownOptions: { output: { format: 'cjs', entryFileNames: 'preload.cjs' } },
                },
              },
            },
          }),
        ]),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/release/**', '**/test-results/**', '**/.artifacts/**'] },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { target: 'chrome152' },
}));
