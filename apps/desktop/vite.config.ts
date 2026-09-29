import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import electron from 'vite-plugin-electron/simple';
import type { ElectronOptions } from 'vite-plugin-electron';
import { reactCompiler } from './plugins/react-compiler.js';
import {
  componentInspector,
  componentInspectorBabelPlugin,
} from './plugins/component-inspector.js';

/**
 * `dependencies` lists only the packages Electron main loads at runtime, because electron-builder
 * ships exactly those in the app. Everything Vite bundles (the renderer's packages and the
 * source-aliased workspace packages below) is a devDependency.
 */
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
  // Contracts use only the data model; the model entry keeps format parsers (and their Node
  // dependencies) out of the sandboxed preload bundle. Listed before the package root so it wins.
  '@ai/plugin-kit/model': path.join(repoRoot, 'packages/plugin-kit/src/model.ts'),
  '@ai/plugin-kit': path.join(repoRoot, 'packages/plugin-kit/src/index.ts'),
};

function externalizeDependency(id: string): boolean {
  if (id in workspaceSource) return false;
  return dependencies.some((name) => id === name || id.startsWith(`${name}/`));
}

/**
 * The dev server port. `AI_RENDERER_PORT` moves it for an isolated run beside another dev server;
 * a Debug macOS shell then takes the same origin from `AI_RENDERER_DEV_ORIGIN`.
 */
const devPort = Number(process.env.AI_RENDERER_PORT ?? 5173);
if (!Number.isInteger(devPort) || devPort < 1 || devPort > 65535)
  throw new Error(`AI_RENDERER_PORT must be a TCP port, not ${process.env.AI_RENDERER_PORT}.`);

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
          // Tags JSX with source locations for the component inspector.
          babel({ plugins: [componentInspectorBabelPlugin], include: /\.(tsx|jsx)$/ }),
          componentInspector(),
        ]
      : []),
    // The compiler's Babel pass is synchronous and made a cold dev start ~2 s slower, so the dev
    // server serves uncompiled components; builds and tests (vitest.config.ts) run compiled code.
    ...(command === 'build' ? [reactCompiler()] : []),
    tailwindcss(),
    {
      name: 'local-development-csp',
      transformIndexHtml(html) {
        // React Fast Refresh injects a preamble only in the local development server, whose HMR
        // socket follows the port.
        return command === 'serve'
          ? html
              .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
              .replace('ws://127.0.0.1:5173', `ws://127.0.0.1:${devPort}`)
          : html;
      },
    },
    // The native renderer build (`build:native`) and its dev server (`dev:renderer`) run without
    // Electron; the same build is the renderer Electron loads from the file path.
    ...(mode === 'native'
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
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Renderer code imports the workspace packages from source as well.
      ...workspaceSource,
    },
  },
  server: {
    host: '127.0.0.1',
    port: devPort,
    strictPort: true,
    // The macOS shell's page is `ai-app://renderer`, which names no port, so the Vite client must
    // be told where its HMR socket is; the page opens it directly (spike S4).
    ...(mode === 'native'
      ? { hmr: { protocol: 'ws', host: '127.0.0.1', clientPort: devPort } }
      : {}),
    watch: { ignored: ['**/release/**', '**/test-results/**', '**/.artifacts/**'] },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: {
    // The native build runs in the macOS shell's WKWebView and in packaged Electron, so it targets
    // both engines (WebKit still needs prefixes such as `-webkit-user-select`).
    target: mode === 'native' ? ['chrome152', 'safari26'] : 'chrome152',
    outDir: mode === 'native' ? 'dist-native' : 'dist',
  },
}));
