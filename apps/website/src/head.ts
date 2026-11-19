import { site } from './content/site.ts';
import { htmlLang, LANGS, pagePath, type Lang, type Page } from './i18n/routes.ts';
import { blogCopy } from './pages/blog/copy.ts';
import { pageHead, siteHeadCopy, type HeadOptions, type PostHead } from './seo/page-head.ts';
import { structuredDataScript } from './structured-data.ts';

const INDEX_ROBOTS = 'index, follow, max-image-preview:large, max-snippet:-1';
const NO_INDEX_ROBOTS = 'noindex, nofollow';

function escapeAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function feedPath(lang: Lang): string {
  return lang === 'zh' ? '/zh/feed.xml' : '/feed.xml';
}

/**
 * Open Graph article tags for a release post: its dates (a post is not revised after publishing,
 * so it was last modified when published), author, the blog as its section, and its keywords.
 */
function articleTags(lang: Lang, post: PostHead): string[] {
  return [
    `<meta property="og:type" content="article" />`,
    `<meta property="article:published_time" content="${post.published}" />`,
    `<meta property="article:modified_time" content="${post.published}" />`,
    `<meta property="article:author" content="https://github.com/${site.author}" />`,
    `<meta property="article:section" content="${escapeAttr(blogCopy[lang].title)}" />`,
    ...(post.keywords ?? []).map(
      (keyword) => `<meta property="article:tag" content="${escapeAttr(keyword)}" />`,
    ),
  ];
}

/**
 * The `<head>` tags of one language's page: title, description, robots directives, canonical and
 * alternate language links, RSS alternate, optional high-priority cover preload, Open Graph and X
 * cards, and schema.org structured data. `siteUrl` is the production origin without trailing slash.
 */
export function renderHead(
  lang: Lang,
  siteUrl: string,
  page: Page = 'home',
  options: HeadOptions = {},
): string {
  const head = pageHead(lang, siteUrl, page, options);
  const title = escapeAttr(head.title);
  const description = escapeAttr(head.description);

  if (head.visibility === 'missing') {
    return [
      `<title>${title}</title>`,
      `<meta name="description" content="${description}" />`,
      `<meta name="robots" content="${NO_INDEX_ROBOTS}" />`,
      `<meta name="application-name" content="${site.name}" />`,
      `<meta name="apple-mobile-web-app-title" content="${site.name}" />`,
    ].join('\n    ');
  }

  const indexed = head.visibility === 'indexed';
  const url = `${siteUrl}${pagePath(lang, page)}`;
  const { share } = head;
  const imageAlt = escapeAttr(share.alt);
  const alternates = LANGS.map(
    (other) =>
      `<link rel="alternate" hreflang="${htmlLang[other]}" href="${siteUrl}${pagePath(other, page)}" />`,
  );
  const otherLocales = LANGS.filter((other) => other !== lang).map(
    (other) => `<meta property="og:locale:alternate" content="${siteHeadCopy[other].ogLocale}" />`,
  );

  const tags = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta name="robots" content="${indexed ? INDEX_ROBOTS : NO_INDEX_ROBOTS}" />`,
    `<meta name="application-name" content="${site.name}" />`,
    `<meta name="apple-mobile-web-app-title" content="${site.name}" />`,
    `<link rel="canonical" href="${url}" />`,
    ...alternates,
    `<link rel="alternate" hreflang="x-default" href="${siteUrl}${pagePath('en', page)}" />`,
    ...(indexed
      ? [
          `<link rel="alternate" type="application/rss+xml" title="${escapeAttr(blogCopy[lang].rssTitle)}" href="${siteUrl}${feedPath(lang)}" />`,
        ]
      : []),
    ...(options.preloadImage
      ? [
          `<link rel="preload" as="image" href="${escapeAttr(options.preloadImage)}" fetchpriority="high" />`,
        ]
      : []),
    ...(head.post
      ? articleTags(lang, head.post)
      : [`<meta property="og:type" content="website" />`]),
    `<meta property="og:site_name" content="${site.name}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:locale" content="${siteHeadCopy[lang].ogLocale}" />`,
    ...otherLocales,
    `<meta property="og:image" content="${share.url}" />`,
    `<meta property="og:image:type" content="${share.type}" />`,
    `<meta property="og:image:width" content="${share.width}" />`,
    `<meta property="og:image:height" content="${share.height}" />`,
    `<meta property="og:image:alt" content="${imageAlt}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${share.url}" />`,
    `<meta name="twitter:image:alt" content="${imageAlt}" />`,
    ...(head.structuredData ? [structuredDataScript(head.structuredData)] : []),
  ];
  return tags.join('\n    ');
}
