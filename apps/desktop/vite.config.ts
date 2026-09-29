import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { reactCompiler } from './plugins/react-compiler.js';
import {
  componentInspector,
  componentInspectorBabelPlugin,
} from './plugins/component-inspector.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * These packages export `dist` at runtime and `src` for types. The renderer bundles their
 * TypeScript source, so a new export needs no separate package build first.
 */
const workspaceSource = {
  '@ai/agent-client': path.join(repoRoot, 'packages/agent-client/src/index.ts'),
  '@ai/agent-contracts': path.join(repoRoot, 'packages/agent-contracts/src/index.ts'),
  // Contracts use only the data model; the model entry keeps format parsers (and their Node
  // dependencies) out of the renderer. Listed before the package root so it wins.
  '@ai/plugin-kit/model': path.join(repoRoot, 'packages/plugin-kit/src/model.ts'),
  '@ai/plugin-kit': path.join(repoRoot, 'packages/plugin-kit/src/index.ts'),
};

/**
 * The dev server port. `AI_RENDERER_PORT` moves it for an isolated run beside another dev server;
 * a Debug macOS shell then takes the same origin from `AI_RENDERER_DEV_ORIGIN`.
 */
const devPort = Number(process.env.AI_RENDERER_PORT ?? 5173);
if (!Number.isInteger(devPort) || devPort < 1 || devPort > 65535)
  throw new Error(`AI_RENDERER_PORT must be a TCP port, not ${process.env.AI_RENDERER_PORT}.`);

/**
 * The renderer the macOS shell hosts. Release builds embed `dist-native`; the Debug app loads the
 * dev server through its scheme handler, which also sends the page's CSP header for both.
 */
export default defineConfig(({ command }) => ({
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
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      ...workspaceSource,
    },
  },
  server: {
    host: '127.0.0.1',
    port: devPort,
    strictPort: true,
    // The macOS shell's page is `ai-app://renderer`, which names no port, so the Vite client must
    // be told where its HMR socket is; the page opens it directly (spike S4).
    hmr: { protocol: 'ws', host: '127.0.0.1', clientPort: devPort },
    watch: { ignored: ['**/.artifacts/**'] },
  },
  build: {
    // WKWebView still needs prefixes such as `-webkit-user-select`.
    target: 'safari26',
    outDir: 'dist-native',
  },
}));
