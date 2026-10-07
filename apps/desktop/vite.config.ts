import { defineConfig } from 'vite';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import {
  componentInspector,
  componentInspectorBabelPlugin,
} from './plugins/component-inspector.js';
import { reactPlugin, workspaceResolve } from './vite.shared.js';

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
    ...(command === 'serve'
      ? [
          // Tags JSX with source locations for the component inspector. Babel runs before the
          // React plugin because the compiler transform rewrites JSX away.
          babel({ plugins: [componentInspectorBabelPlugin], include: /\.(tsx|jsx)$/ }),
          componentInspector(),
        ]
      : []),
    reactPlugin(),
    tailwindcss(),
  ],
  resolve: workspaceResolve,
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
  // `CodeHighlightPool` starts its worker as an ES module (`{ type: 'module' }`), so the worker is
  // bundled as one too; that also keeps Shiki's WASM engine, which the pool never uses, in a lazy
  // chunk instead of inlined into the worker as the default IIFE format does.
  worker: { format: 'es' },
}));
