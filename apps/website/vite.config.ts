import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';
import { blogContent } from './blog-content.ts';
import { normalizeAssetBase, websiteMediaAssets } from './media-assets.ts';
import { renderHead } from './src/head.ts';
import { pageFromPath } from './src/i18n/routes.ts';
import { handleGitHubStarsRequest } from './src/lib/github-stars.ts';

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
 * Serves each prerendered page at its clean URL (`/blog/atd-0-10-6` → `blog/atd-0-10-6/index.html`)
 * and responds with the built `404.html` on unmatched paths, mirroring Vercel's static behavior.
 */
function previewCleanUrls(): Plugin {
  return {
    name: 'atd-preview-clean-urls',
    configurePreviewServer(server) {
      const outDir = resolve(server.config.root, server.config.build.outDir);
      server.middlewares.use((request, response, next) => {
        const [path = '/', query = ''] = (request.url ?? '/').split('?');
        if (path.startsWith('/api/') || path.startsWith('/downloads/')) {
          next();
          return;
        }
        const page = join(outDir, path, 'index.html');
        if (path !== '/' && !extname(path) && page.startsWith(outDir + sep) && existsSync(page)) {
          request.url = `${path.replace(/\/$/, '')}/index.html${query ? `?${query}` : ''}`;
          next();
          return;
        }
        const directFile = join(outDir, path.replace(/^\/+/, ''));
        const isExistingAsset =
          path === '/' || (directFile.startsWith(outDir + sep) && existsSync(directFile));
        if (!isExistingAsset && !extname(path)) {
          const notFound = join(outDir, '404.html');
          if (existsSync(notFound)) {
            response.statusCode = 404;
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.end(readFileSync(notFound, 'utf8'));
            return;
          }
        }
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

function mountGitHubStarsRoute(middlewares: Connect.Server) {
  middlewares.use('/api/github', (request: IncomingMessage, response: ServerResponse, next) => {
    const pathname = request.url?.split('?')[0] ?? '/';
    if (pathname !== '/' && pathname !== '') {
      next();
      return;
    }
    const controller = new AbortController();
    response.once('close', () => controller.abort());
    const webRequest = new Request(`http://127.0.0.1/api/github${request.url ?? ''}`, {
      method: request.method ?? 'GET',
      signal: controller.signal,
    });
    void handleGitHubStarsRequest(webRequest, process.env.GITHUB_TOKEN)
      .then(async (webResponse) => {
        response.statusCode = webResponse.status;
        webResponse.headers.forEach((value, key) => response.setHeader(key, value));
        response.end(request.method === 'HEAD' ? undefined : await webResponse.text());
      })
      .catch(next);
  });
}

/**
 * Mirrors Vercel's `/api/github` serverless function on the Vite dev and preview servers so local
 * verification runs the exact same cached handler and response shape.
 */
function githubStarsEndpoint(): Plugin {
  return {
    name: 'atd-github-stars-endpoint',
    configureServer(server) {
      mountGitHubStarsRoute(server.middlewares);
    },
    configurePreviewServer(server) {
      mountGitHubStarsRoute(server.middlewares);
    },
  };
}

/**
 * A static site: `vite build` makes the client bundle and the template, the SSR build and
 * `scripts/prerender.ts` then write one prerendered page per language into `dist`.
 */
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    devHead(),
    githubStarsEndpoint(),
    websiteMediaAssets(normalizeAssetBase(loadEnv(mode, process.cwd()).VITE_ASSET_BASE_URL)),
    blogContent(),
    previewCleanUrls(),
  ],
  server: { host: '127.0.0.1', port: 5180, strictPort: true, proxy: downloadManifests },
  preview: { host: '127.0.0.1', port: 4180, strictPort: true, proxy: downloadManifests },
}));
