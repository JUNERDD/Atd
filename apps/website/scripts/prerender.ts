/**
 * Writes one prerendered page per route into `dist`, alongside the static `404.html`, sitemap,
 * RSS feeds, `robots.txt`, and `llms.txt` / `llms-full.txt`. The client build's `index.html` is the
 * template; the server bundle in `dist-ssr` renders each page's markup and head and is removed
 * afterward so it never ships with the site.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type * as ServerEntry from '../src/entry-server.tsx';
import { feedPath } from '../src/head.ts';
import { LANGS } from '../src/i18n/routes.ts';
import { fetchGitHubStars, GITHUB_STARS_FALLBACK } from '../src/lib/github-stars.ts';
import { buildLlmsFullTxt, buildLlmsTxt, buildRssFeedXml, buildSitemapXml } from './seo-outputs.ts';

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
    Array.isArray(value.routes) &&
    'posts' in value &&
    Array.isArray(value.posts)
  );
}

/**
 * The production origin for canonical, sitemap, RSS and Open Graph URLs. Vercel builds know the
 * project's production domain; `SITE_URL` overrides it, and local builds fall back to preview.
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
if (!isEntry(entry)) {
  throw new Error('dist-ssr/entry-server.js must export render, routes, and posts.');
}

const template = await readFile(new URL('index.html', dist), 'utf8');
for (const mark of [HTML_OPEN, HEAD_MARK, APP_MARK]) {
  if (!template.includes(mark)) throw new Error(`The page template lost its ${mark} marker.`);
}
const origin = siteUrl();
const preload = await fontPreload();
const initialStars =
  (await fetchGitHubStars({ token: process.env.GITHUB_TOKEN })) ?? GITHUB_STARS_FALLBACK;
console.log(`stars snapshot: ${initialStars}`);

const renderDocument = (rendered: ReturnType<Entry['render']>) =>
  template
    .replace(HTML_OPEN, `<html ${rendered.htmlAttrs}>`)
    .replace(HEAD_MARK, rendered.head + preload)
    .replace(APP_MARK, rendered.html);

for (const route of entry.routes) {
  const page = entry.render(route.lang, origin, route.page, initialStars);
  const dir = new URL(route.dir, dist);
  await mkdir(dir, { recursive: true });
  await writeFile(new URL('index.html', dir), renderDocument(page));
  console.log(`prerendered ${route.lang} → dist/${route.dir === './' ? '' : route.dir}index.html`);
}

// Static fallback served by Vercel (and Vite preview) with HTTP 404 when no route matches.
await writeFile(
  new URL('404.html', dist),
  renderDocument(entry.render('en', origin, 'not-found', initialStars)),
);
console.log('prerendered en → dist/404.html');

const indexedRoutes = entry.routes.filter((route) => route.indexable);
await writeFile(new URL('sitemap.xml', dist), buildSitemapXml(origin, indexedRoutes, entry.posts));
await writeFile(
  new URL('robots.txt', dist),
  `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`,
);
for (const lang of LANGS) {
  const target = feedPath(lang).slice(1);
  await mkdir(new URL(target.includes('/') ? `${lang}/` : './', dist), { recursive: true });
  await writeFile(new URL(target, dist), buildRssFeedXml(origin, lang, entry.posts));
}
await writeFile(new URL('llms.txt', dist), buildLlmsTxt(origin, entry.posts));
await writeFile(new URL('llms-full.txt', dist), buildLlmsFullTxt(origin, entry.posts));

// `public/cases/README.md` guides maintainers adding recordings; it is not part of the site.
await rm(new URL('cases/README.md', dist), { force: true });
await rm(serverDir, { recursive: true, force: true });
