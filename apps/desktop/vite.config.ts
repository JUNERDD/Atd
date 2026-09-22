import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import electron from 'vite-plugin-electron/simple';
import type { ElectronOptions } from 'vite-plugin-electron';
import {
  componentInspector,
  componentInspectorBabelPlugin,
} from './plugins/component-inspector.js';

const dependencies = Object.keys(
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).dependencies,
);
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * These packages export `dist` at runtime and `src` for types. Electron main
 * used to load `dist` as an external, so a new export crashed startup until
 * that package was compiled again. Main bundles the TypeScript source instead.
 */
const workspaceSource = {
  '@ai/agent-client': path.join(repoRoot, 'packages/agent-client/src/index.ts'),
  '@ai/agent-contracts': path.join(repoRoot, 'packages/agent-contracts/src/index.ts'),
};

function externalizeDependency(id: string): boolean {
  if (id in workspaceSource) return false;
  return dependencies.some((name) => id === name || id.startsWith(`${name}/`));
}

const startElectron: NonNullable<ElectronOptions['onstart']> = async ({ startup }) => {
  // Explicit arguments retain Chromium's sandbox in development as well as production.
  await startup(['.']);
};

export default defineConfig(({ mode, command }) => ({
  base: './',
  plugins: [
    react(),
    ...(command === 'serve'
      ? [
          babel({ plugins: [componentInspectorBabelPlugin], include: /\.(tsx|jsx)$/ }),
          componentInspector(),
        ]
      : []),
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
              // T6 pure client: no worker entry. Agent execution lives in
              // @ai/agent-service; T7 owns service bundling (see packaging notes).
              entry: ['electron/main.ts'],
              onstart: startElectron,
              vite: {
                resolve: { alias: workspaceSource },
                build: {
                  rolldownOptions: {
                    external: externalizeDependency,
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
