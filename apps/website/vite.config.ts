import { existsSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { blogContent } from './blog-content.ts';
import { normalizeAssetBase, websiteMediaAssets } from './media-assets.ts';
import { pageFromPath } from './src/i18n/routes.ts';
import { renderHead } from './src/head.ts';

/**
 * The dev server serves the template unrendered, so the URL determines its localized head;
 * production pages get theirs from the prerender step. The SPA fallback transforms
 * `/index.html` for every route, so the requested URL (`originalUrl`) decides, not the file's.
 */
function devHead(): Plugin {
  return {
    name: 'atd-dev-head',
    apply: 'serve',
    transformIndexHtml: (html, context) => {
      const path = new URL(context.originalUrl ?? context.path, 'http://127.0.0.1').pathname;
      return html.replace(
        '<!--app-head-->',
        renderHead(
          path.startsWith('/zh') ? 'zh' : 'en',
          'http://127.0.0.1:5180',
          pageFromPath(path),
        ),
      );
    },
  };
}

/**
 * Serves each prerendered page at its clean URL (`/blog/atd-0-10-6` → `blog/atd-0-10-6/index.html`),
 * as `cleanUrls` does on Vercel; Vite's preview would otherwise answer with the home page's HTML.
 */
function previewCleanUrls(): Plugin {
  return {
    name: 'atd-preview-clean-urls',
    configurePreviewServer(server) {
      const outDir = resolve(server.config.root, server.config.build.outDir);
      server.middlewares.use((request, _response, next) => {
        const [path = '/', query = ''] = (request.url ?? '/').split('?');
        const page = join(outDir, path, 'index.html');
        if (path !== '/' && !extname(path) && page.startsWith(outDir + sep) && existsSync(page))
          request.url = `${path.replace(/\/$/, '')}/index.html${query ? `?${query}` : ''}`;
        next();
      });
    },
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
    blogContent(),
    previewCleanUrls(),
  ],
  server: { host: '127.0.0.1', port: 5180, strictPort: true, proxy: downloadManifests },
  preview: { host: '127.0.0.1', port: 4180, strictPort: true, proxy: downloadManifests },
}));
