import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { normalizeAssetBase, websiteMediaAssets } from './media-assets.ts';
import { pageFromPath } from './src/i18n/routes.ts';
import { renderHead } from './src/head.ts';

/**
 * The dev server serves the template unrendered, so the URL determines its localized head;
 * production pages get theirs from the prerender step.
 */
function devHead(): Plugin {
  return {
    name: 'atd-dev-head',
    apply: 'serve',
    transformIndexHtml: (html, context) =>
      html.replace(
        '<!--app-head-->',
        renderHead(
          context.path.startsWith('/zh') ? 'zh' : 'en',
          'http://127.0.0.1:5180',
          pageFromPath(context.path),
        ),
      ),
  };
}

/** Serves download manifests from the page's origin locally, as the `vercel.json` rewrite does live. */
const downloadManifests = {
  '/downloads/debug.json': {
    target: 'https://downloads.atd.best',
    changeOrigin: true,
    rewrite: () => '/debug/manifest.json',
  },
  '/downloads/rc.json': {
    target: 'https://downloads.atd.best',
    changeOrigin: true,
    rewrite: () => '/rc.json',
  },
};

/**
 * A static site: `vite build` makes the client bundle and the template, the SSR build and
 * `scripts/prerender.ts` then write one prerendered page per language into `dist`.
 */
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    devHead(),
    websiteMediaAssets(normalizeAssetBase(loadEnv(mode, process.cwd()).VITE_ASSET_BASE_URL)),
  ],
  server: { host: '127.0.0.1', port: 5180, strictPort: true, proxy: downloadManifests },
  preview: { host: '127.0.0.1', port: 4180, strictPort: true, proxy: downloadManifests },
}));
