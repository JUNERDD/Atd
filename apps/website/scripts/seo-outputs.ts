/**
 * The crawler-facing files written beside the pages: `sitemap.xml`, the RSS feeds, and
 * `robots.txt`. The plain-text references for language models are in `llms-outputs.ts`.
 */
import type { BlogPost } from '../src/content/blog-schema.ts';
import { faq } from '../src/content/faq/index.ts';
import { featurePage } from '../src/content/features/index.ts';
import { feedPath } from '../src/head.ts';
import {
  featureSlugOf,
  htmlLang,
  pagePath,
  postSlugOf,
  type Lang,
  type Page,
} from '../src/i18n/routes.ts';
import { blogCopy } from '../src/pages/blog/copy.ts';
import { featuresHubUpdated } from '../src/seo/feature-structured-data.ts';

export interface IndexedRoute {
  lang: Lang;
  page: Page;
  path: string;
  hreflang: string;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function toRfc2822(date: string): string {
  return new Date(`${date}T00:00:00Z`).toUTCString();
}

/**
 * When a page last changed in substance: a post on its publishing day, a capability page, the hub
 * and the FAQ when their content was last edited, and every other page with the newest release.
 */
function lastmodOf(page: Page, posts: readonly BlogPost[], latestDate: string): string {
  const postSlug = postSlugOf(page);
  if (postSlug !== null) return posts.find((post) => post.slug === postSlug)?.date ?? latestDate;
  const featureSlug = featureSlugOf(page);
  if (featureSlug !== null) {
    const feature = featurePage(featureSlug);
    if (!feature) throw new Error(`The sitemap lists ${page}, which has no capability page.`);
    return feature.updated;
  }
  if (page === 'features') return featuresHubUpdated();
  if (page === 'faq') return faq.updated;
  return latestDate;
}

/**
 * The absolute URLs of the images a post shows in one language, highlights first, then the
 * figures of its improvements, fixes and other notes, each once.
 */
function postImageUrls(origin: string, post: BlogPost, lang: Lang): string[] {
  const copy = post.copy[lang];
  const notes = [...copy.improvements, ...copy.fixes, ...copy.other];
  const sources = [
    ...copy.highlights.map((highlight) => highlight.image.src),
    ...notes.flatMap((note) => (note.figure ? [note.figure.image.src] : [])),
  ];
  return [...new Set(sources)].map((src) => `${origin}${src}`);
}

/**
 * Generates `sitemap.xml` with symmetric `hreflang` alternates (`en`, `zh-CN`, `x-default`), a
 * `<lastmod>` per page, and image sitemap entries for each post's images under that language's
 * post URL.
 */
export function buildSitemapXml(
  origin: string,
  indexedRoutes: readonly IndexedRoute[],
  posts: readonly BlogPost[],
): string {
  const latestDate = posts[0]?.date ?? new Date().toISOString().slice(0, 10);

  const alternatesOf = (page: Page) => {
    const versions = indexedRoutes.filter((route) => route.page === page);
    const fallback = versions.find((route) => route.lang === 'en');
    if (!fallback)
      throw new Error(`The English ${page} page, the x-default alternate, is missing.`);
    return [...versions.map((route) => [route.hreflang, route.path]), ['x-default', fallback.path]]
      .map(
        ([hreflang, path]) =>
          `    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${escapeXml(`${origin}${path}`)}" />`,
      )
      .join('\n');
  };

  const imagesOf = (route: IndexedRoute) => {
    const slug = postSlugOf(route.page);
    const post = slug === null ? undefined : posts.find((candidate) => candidate.slug === slug);
    if (!post) return [];
    return postImageUrls(origin, post, route.lang).map((url) =>
      [
        '    <image:image>',
        `      <image:loc>${escapeXml(url)}</image:loc>`,
        '    </image:image>',
      ].join('\n'),
    );
  };

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    ...indexedRoutes.map((route) =>
      [
        '  <url>',
        `    <loc>${escapeXml(`${origin}${route.path}`)}</loc>`,
        `    <lastmod>${lastmodOf(route.page, posts, latestDate)}</lastmod>`,
        alternatesOf(route.page),
        ...imagesOf(route),
        '  </url>',
      ].join('\n'),
    ),
    '</urlset>',
    '',
  ].join('\n');
}

/**
 * Generates `robots.txt`: every page may be crawled except the same-origin API and the download
 * manifest proxies, which serve data rather than pages.
 */
export function buildRobotsTxt(origin: string): string {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /downloads/',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}

/**
 * Generates an RSS 2.0 feed for one language's release blog (`/feed.xml` or `/zh/feed.xml`).
 */
export function buildRssFeedXml(origin: string, lang: Lang, posts: readonly BlogPost[]): string {
  const blogUrl = `${origin}${pagePath(lang, 'blog')}`;
  const selfUrl = `${origin}${feedPath(lang)}`;
  const latestDate = posts[0]?.date ?? new Date().toISOString().slice(0, 10);
  const items = posts
    .map((post) => {
      const copy = post.copy[lang];
      const url = `${origin}${pagePath(lang, `blog/${post.slug}`)}`;
      const highlights = copy.highlights.map((highlight) => highlight.title).join(' · ');
      const description = highlights ? `${copy.summary}\n\n${highlights}` : copy.summary;
      return [
        '    <item>',
        `      <title>${escapeXml(`${copy.title} — Atd ${post.version}`)}</title>`,
        `      <link>${escapeXml(url)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
        `      <pubDate>${toRfc2822(post.date)}</pubDate>`,
        `      <description>${escapeXml(description)}</description>`,
        '    </item>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(blogCopy[lang].rssTitle)}</title>`,
    `    <link>${escapeXml(blogUrl)}</link>`,
    `    <description>${escapeXml(blogCopy[lang].headDescription)}</description>`,
    `    <language>${htmlLang[lang]}</language>`,
    `    <lastBuildDate>${toRfc2822(latestDate)}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml" />`,
    items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}
