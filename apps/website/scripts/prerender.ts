/**
 * Writes one prerendered page per language into `dist`. The client build's `index.html` is the
 * template; the server bundle in `dist-ssr` renders each page's markup and head. The server bundle is
 * removed afterwards so it never ships with the site.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type * as ServerEntry from '../src/entry-server.tsx';

type Entry = typeof ServerEntry;

const dist = new URL('../dist/', import.meta.url);
const serverDir = new URL('../dist-ssr/', import.meta.url);
const HTML_OPEN = '<html lang="en" data-theme="dark">';
const HEAD_MARK = '<!--app-head-->';
const APP_MARK = '<!--app-html-->';

function isEntry(value: unknown): value is Entry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'render' in value &&
    typeof value.render === 'function' &&
    'routes' in value &&
    Array.isArray(value.routes)
  );
}

/**
 * The production origin for canonical and Open Graph URLs. Vercel builds know the project's
 * production domain; `SITE_URL` overrides it, and local builds fall back to the preview server.
 */
function siteUrl(): string {
  const explicit = process.env.SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercel ? `https://${vercel}` : 'http://127.0.0.1:4180';
}

/** Preloads the dot-matrix display font, which the hero's first paint depends on. */
async function fontPreload(): Promise<string> {
  const assets = await readdir(new URL('assets/', dist));
  const font = assets.find((name) => /^doto-latin-wght-normal-.+\.woff2$/.test(name));
  if (!font) throw new Error('The Doto Latin font is missing from dist/assets.');
  return `\n    <link rel="preload" href="/assets/${font}" as="font" type="font/woff2" crossorigin />`;
}

const entry: unknown = await import(new URL('entry-server.js', serverDir).href);
if (!isEntry(entry)) throw new Error('dist-ssr/entry-server.js must export render and routes.');

const template = await readFile(new URL('index.html', dist), 'utf8');
for (const mark of [HTML_OPEN, HEAD_MARK, APP_MARK]) {
  if (!template.includes(mark)) throw new Error(`The page template lost its ${mark} marker.`);
}
const origin = siteUrl();
const preload = await fontPreload();

for (const route of entry.routes) {
  const page = entry.render(route.lang, origin);
  const html = template
    .replace(HTML_OPEN, `<html ${page.htmlAttrs}>`)
    .replace(HEAD_MARK, page.head + preload)
    .replace(APP_MARK, page.html);
  const dir = new URL(route.dir, dist);
  await mkdir(dir, { recursive: true });
  await writeFile(new URL('index.html', dir), html);
  console.log(`prerendered ${route.lang} → dist/${route.dir === './' ? '' : route.dir}index.html`);
}

// Crawlers get every language page, each listing the others as alternates.
const alternates = entry.routes
  .map(
    (route) =>
      `    <xhtml:link rel="alternate" hreflang="${route.hreflang}" href="${origin}${route.path}" />`,
  )
  .join('\n');
const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ...entry.routes.map(
    (route) => `  <url>\n    <loc>${origin}${route.path}</loc>\n${alternates}\n  </url>`,
  ),
  '</urlset>',
  '',
].join('\n');
await writeFile(new URL('sitemap.xml', dist), sitemap);
await writeFile(
  new URL('robots.txt', dist),
  `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`,
);

// `public/cases/README.md` guides maintainers adding recordings; it is not part of the site.
await rm(new URL('cases/README.md', dist), { force: true });
await rm(serverDir, { recursive: true, force: true });
