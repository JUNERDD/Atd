import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';
import { devPlugins } from './dev-plugins.ts';
import { flavorFromMode } from './flavors.ts';
import { manifestFor } from './manifest.config.ts';

const CONTENT_SCRIPT = 'src/content/index.ts';

/**
 * The shared contracts, whose modules only declare values (TypeBox schemas, constants, pure
 * functions). Their package exports one barrel and declares no `sideEffects`, so importing
 * `resolveLanguage` or `PermissionAnswerSchema` from it would otherwise bundle every schema of the
 * app into the service worker and build them all at each of its starts.
 */
const DECLARATION_ONLY = /[\\/]packages[\\/](agent-contracts|plugin-kit)[\\/]src[\\/]/;

/**
 * One source, two flavors: `vite build --mode release` writes `dist/release`, `--mode dev` writes
 * `dist/dev` (`flavors.ts`), and a dev build lets the extension reload itself after a rebuild
 * (`dev-plugins.ts`). The content script is a standalone IIFE (no loader, nothing web
 * accessible), so the background can also inject the same file into tabs that were open before
 * the extension loaded. Workspace packages resolve their TypeScript `source` like the renderer.
 *
 * Tree-shaking drops the contracts' unused modules, and the unused schemas of the ones kept:
 * TypeBox's `Type.*` builders only construct schema objects, so a schema nothing reads goes.
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
    build: {
      outDir: `dist/${flavor}`,
      emptyOutDir: true,
      target: 'chrome125',
      // Lightning CSS 1.33 (Vite's default CSS minifier) folds `animation-timeline` into the
      // `animation` shorthand for Chrome targets; Chrome accepts a timeline there only as a reset,
      // so it drops the whole declaration and the scroll-driven animation (the panel kit's scroll
      // edges) stops. esbuild keeps the longhand. CRXJS builds the content script on its own and
      // does not pass this on, so `scroll-area.css` avoids the shorthand instead. Back to the
      // default once Vite's lightningcss includes parcel-bundler/lightningcss#1306.
      cssMinify: 'esbuild',
      rolldownOptions: {
        treeshake: {
          moduleSideEffects: [{ test: DECLARATION_ONLY, sideEffects: false }],
          manualPureFunctions: ['Type'],
        },
      },
    },
  };
});
