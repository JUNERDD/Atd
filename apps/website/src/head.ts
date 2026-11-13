import { blogCopy } from './pages/blog/copy.ts';
import { debugCopy } from './pages/debug/copy.ts';
import { notFoundCopy } from './pages/not-found/copy.ts';
import { site } from './content/site.ts';
import { htmlLang, LANGS, pagePath, type Lang, type Localized, type Page } from './i18n/routes.ts';
import {
  blogStructuredData,
  homeStructuredData,
  postStructuredData,
  structuredDataScript,
  type BlogIndexPostData,
} from './structured-data.ts';

interface HeadCopy {
  /** The search result and share card title: the name, then what it is in the words people search. */
  title: string;
  /** The search snippet and share card text, within about 160 characters (80 for Chinese). */
  description: string;
  /** Short breadcrumb root name matching the site language. */
  homeName: string;
  /** What the share image shows, for readers who cannot see it. */
  imageAlt: string;
  ogLocale: string;
}

const shortcut = site.shortcut.join(' ');

const headCopy: Localized<HeadCopy> = {
  en: {
    title: `${site.name} — Open-Source AI Desktop Agent for macOS`,
    description: `${site.name} is a free, open-source macOS AI agent. Press ${shortcut} anywhere for coding, computer use, MCP tools, screenshots, and cloud or local models.`,
    homeName: 'Home',
    imageAlt: `${site.name}, lit in white dots on a black LED panel`,
    ogLocale: 'en_US',
  },
  zh: {
    title: `${site.name} — 开源 macOS AI 桌面智能体，本地模型与电脑操作`,
    description: `${site.name} 是一款免费开源的 macOS AI 智能体。按 ${shortcut} 随时唤起，支持编程、电脑操作、MCP 与技能扩展、长截图录屏，以及云端与本地模型。`,
    homeName: '首页',
    imageAlt: `黑色 LED 面板上，以白色点阵点亮的 ${site.name}`,
    ogLocale: 'zh_CN',
  },
};

function escapeAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function imageType(src: string): string {
  if (src.endsWith('.webp')) return 'image/webp';
  if (src.endsWith('.avif')) return 'image/avif';
  if (src.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
}

export function feedPath(lang: Lang): string {
  return lang === 'zh' ? '/zh/feed.xml' : '/feed.xml';
}

/** What a blog post's page says about itself; its first highlight's image is its share image. */
export interface PostHead {
  slug: string;
  version: string;
  title: string;
  description: string;
  /** The publishing day, `YYYY-MM-DD`. */
  published: string;
  image?: { src: string; width: number; height: number; alt: string };
  keywords?: readonly string[];
}

export interface HeadOptions {
  post?: PostHead;
  blogPosts?: readonly BlogIndexPostData[];
  preloadImage?: string;
}

/** The page's title and description: a post's own (when `post` is given), else its page's. */
function pageCopy(lang: Lang, page: Page, post: PostHead | undefined): HeadCopy {
  if (page === 'not-found')
    return {
      ...headCopy[lang],
      title: notFoundCopy[lang].headTitle,
      description: notFoundCopy[lang].headDescription,
    };
  if (page === 'debug')
    return {
      ...headCopy[lang],
      title: `${debugCopy[lang].title} — Atd`,
      description: debugCopy[lang].description,
    };
  if (post)
    return {
      ...headCopy[lang],
      title: blogCopy[lang].postTitle(post.title, post.version),
      description: post.description,
    };
  if (page !== 'home')
    return {
      ...headCopy[lang],
      title: blogCopy[lang].headTitle,
      description: blogCopy[lang].headDescription,
    };
  return headCopy[lang];
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
  const { post, blogPosts = [], preloadImage } = options;
  const copy = pageCopy(lang, page, post);
  const title = escapeAttr(copy.title);
  const description = escapeAttr(copy.description);

  if (page === 'not-found') {
    return [
      `<title>${title}</title>`,
      `<meta name="description" content="${description}" />`,
      `<meta name="robots" content="noindex, nofollow" />`,
      `<meta name="application-name" content="${site.name}" />`,
      `<meta name="apple-mobile-web-app-title" content="${site.name}" />`,
    ].join('\n    ');
  }

  const url = `${siteUrl}${pagePath(lang, page)}`;
  const share = post?.image
    ? {
        url: `${siteUrl}${post.image.src}`,
        type: imageType(post.image.src),
        width: post.image.width,
        height: post.image.height,
        alt: post.image.alt,
      }
    : {
        url: `${siteUrl}/og.jpg`,
        type: 'image/jpeg',
        width: 1200,
        height: 630,
        alt: copy.imageAlt,
      };
  const image = share.url;
  const imageAlt = escapeAttr(share.alt);
  const alternates = LANGS.map(
    (other) =>
      `<link rel="alternate" hreflang="${htmlLang[other]}" href="${siteUrl}${pagePath(other, page)}" />`,
  );
  const otherLocales = LANGS.filter((other) => other !== lang).map(
    (other) => `<meta property="og:locale:alternate" content="${headCopy[other].ogLocale}" />`,
  );
  const structuredNode =
    page === 'home'
      ? structuredDataScript(
          homeStructuredData(lang, siteUrl, {
            title: copy.title,
            description: copy.description,
            image,
          }),
        )
      : page === 'blog'
        ? structuredDataScript(
            blogStructuredData(
              lang,
              siteUrl,
              headCopy[lang].homeName,
              blogCopy[lang].title,
              { title: copy.title, description: copy.description, image },
              blogPosts,
            ),
          )
        : post
          ? structuredDataScript(
              postStructuredData(
                lang,
                siteUrl,
                headCopy[lang].homeName,
                blogCopy[lang].title,
                post.slug,
                copy.title,
                {
                  version: post.version,
                  title: post.title,
                  description: post.description,
                  published: post.published,
                  image,
                  ...(post.keywords ? { keywords: post.keywords } : {}),
                },
              ),
            )
          : null;

  const tags = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta name="robots" content="${page === 'debug' ? 'noindex, nofollow' : 'index, follow, max-image-preview:large, max-snippet:-1'}" />`,
    `<meta name="application-name" content="${site.name}" />`,
    `<meta name="apple-mobile-web-app-title" content="${site.name}" />`,
    `<link rel="canonical" href="${url}" />`,
    ...alternates,
    `<link rel="alternate" hreflang="x-default" href="${siteUrl}${pagePath('en', page)}" />`,
    ...(page === 'debug'
      ? []
      : [
          `<link rel="alternate" type="application/rss+xml" title="${escapeAttr(blogCopy[lang].rssTitle)}" href="${siteUrl}${feedPath(lang)}" />`,
        ]),
    ...(preloadImage
      ? [
          `<link rel="preload" as="image" href="${escapeAttr(preloadImage)}" fetchpriority="high" />`,
        ]
      : []),
    ...(post
      ? [
          `<meta property="og:type" content="article" />`,
          `<meta property="article:published_time" content="${post.published}" />`,
        ]
      : [`<meta property="og:type" content="website" />`]),
    `<meta property="og:site_name" content="${site.name}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:locale" content="${copy.ogLocale}" />`,
    ...otherLocales,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:type" content="${share.type}" />`,
    `<meta property="og:image:width" content="${share.width}" />`,
    `<meta property="og:image:height" content="${share.height}" />`,
    `<meta property="og:image:alt" content="${imageAlt}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    `<meta name="twitter:image:alt" content="${imageAlt}" />`,
    ...(structuredNode ? [structuredNode] : []),
  ];
  return tags.join('\n    ');
}
