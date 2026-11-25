import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';
import { devPlugins } from './dev-plugins.ts';
import { flavorFromMode } from './flavors.ts';
import { manifestFor } from './manifest.config.ts';

const CONTENT_SCRIPT = 'src/content/index.ts';

/**
 * One source, two flavors: `vite build --mode release` writes `dist/release`, `--mode dev` writes
 * `dist/dev` (`flavors.ts`), and a dev build lets the extension reload itself after a rebuild
 * (`dev-plugins.ts`). The content script is a standalone IIFE (no loader, nothing web
 * accessible), so the background can also inject the same file into tabs that were open before
 * the extension loaded. Workspace packages resolve their TypeScript `source` like the renderer.
 */
export default defineConfig(({ mode }) => {
  const flavor = flavorFromMode(mode);
  return {
    plugins: [
      react(),
      crx({
        manifest: manifestFor(flavor),
        contentScripts: { standaloneFiles: [CONTENT_SCRIPT] },
      }),
      flavor === 'dev' ? devPlugins(CONTENT_SCRIPT) : [],
    ],
    resolve: { conditions: [...defaultClientConditions, 'source'] },
    build: { outDir: `dist/${flavor}`, emptyOutDir: true, target: 'chrome125' },
  };
});
