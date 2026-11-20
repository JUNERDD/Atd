import { faq } from '../content/faq/index.ts';
import { featurePage, featuresHub } from '../content/features/index.ts';
import { site } from '../content/site.ts';
import { featureSlugOf, type Lang, type Localized, type Page } from '../i18n/routes.ts';
import { blogCopy } from '../pages/blog/copy.ts';
import { debugCopy } from '../pages/debug/copy.ts';
import { notFoundCopy } from '../pages/not-found/copy.ts';
import { homeStructuredData, type PageFacts } from '../structured-data.ts';
import {
  blogStructuredData,
  postStructuredData,
  type BlogIndexPostData,
} from './blog-structured-data.ts';
import { faqStructuredData } from './faq-structured-data.ts';
import { featureStructuredData, featuresHubStructuredData } from './feature-structured-data.ts';

interface SiteHeadCopy {
  /** The search result and share card title: the name, then what it is in the words people search. */
  title: string;
  /** The search snippet and share card text, within about 160 characters (80 for Chinese). */
  description: string;
  /** Short breadcrumb root name matching the site language. */
  homeName: string;
  /** What the default share image shows, for readers who cannot see it. */
  imageAlt: string;
  ogLocale: string;
}

const shortcut = site.shortcut.join(' ');

/** The home page's head copy, and the defaults every other page's head shares. */
export const siteHeadCopy: Localized<SiteHeadCopy> = {
  en: {
    title: `${site.name} — Open-Source AI Desktop Agent for macOS`,
    description: `${site.name} is a free, open-source AI desktop agent app for macOS. Press ${shortcut} for coding, computer use, MCP tools, screenshots, and cloud or local models.`,
    homeName: 'Home',
    imageAlt: `${site.name}, lit in white dots on a black LED panel`,
    ogLocale: 'en_US',
  },
  zh: {
    title: `${site.name} — 开源 macOS AI 桌面智能体，本地模型与电脑操作`,
    description: `${site.name} 是一款免费开源的 macOS AI 桌面智能体应用。按 ${shortcut} 随时唤起，支持编程、电脑操作、MCP 与技能扩展、长截图录屏，以及云端与本地模型。`,
    homeName: '首页',
    imageAlt: `黑色 LED 面板上，以白色点阵点亮的 ${site.name}`,
    ogLocale: 'zh_CN',
  },
};

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

/**
 * Facts the head cannot derive from the page alone, because they come from the blog's
 * build-time content (`virtual:atd-blog`), which only the server bundle can import.
 */
export interface HeadOptions {
  post?: PostHead;
  blogPosts?: readonly BlogIndexPostData[];
  preloadImage?: string;
}

/** A page's share card image, with an absolute URL. */
export interface ShareImage {
  url: string;
  type: string;
  width: number;
  height: number;
  alt: string;
}

/**
 * How search engines may treat a page: an `indexed` page is listed and advertises the feed, an
 * `unlisted` one (diagnostic downloads) is reachable but `noindex`, and a `missing` one gets only
 * the tags a not-found response needs.
 */
export type Visibility = 'indexed' | 'unlisted' | 'missing';

/** What one language's page says about itself in its `<head>`. */
export interface PageHead {
  visibility: Visibility;
  title: string;
  description: string;
  share: ShareImage;
  /** A release post, which the head marks up as an article; every other page is a `website`. */
  post?: PostHead;
  /** The page's schema.org graph, when it has one. */
  structuredData?: object;
}

function imageType(src: string): string {
  if (src.endsWith('.webp')) return 'image/webp';
  if (src.endsWith('.avif')) return 'image/avif';
  if (src.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
}

/**
 * Resolves a page's head facts. Capability and FAQ copy comes from `page` itself, so the dev
 * server, which passes no options, still gets those pages' full heads.
 */
export function pageHead(
  lang: Lang,
  siteUrl: string,
  page: Page,
  options: HeadOptions = {},
): PageHead {
  const { post, blogPosts = [] } = options;
  const { homeName } = siteHeadCopy[lang];
  const defaultShare: ShareImage = {
    url: `${siteUrl}/og.jpg`,
    type: 'image/jpeg',
    width: 1200,
    height: 630,
    alt: siteHeadCopy[lang].imageAlt,
  };
  const indexed = (
    title: string,
    description: string,
    graph?: (facts: PageFacts) => object,
  ): PageHead => ({
    visibility: 'indexed',
    title,
    description,
    share: defaultShare,
    ...(graph ? { structuredData: graph({ title, description, image: defaultShare.url }) } : {}),
  });

  const featureSlug = featureSlugOf(page);
  const feature = featureSlug === null ? undefined : featurePage(featureSlug);
  // Only the dev server, which answers every path, reaches a capability slug with no page.
  if (page === 'not-found' || (featureSlug !== null && !feature))
    return {
      visibility: 'missing',
      title: notFoundCopy[lang].headTitle,
      description: notFoundCopy[lang].headDescription,
      share: defaultShare,
    };
  if (page === 'debug')
    return {
      visibility: 'unlisted',
      title: `${debugCopy[lang].title} — Atd`,
      description: debugCopy[lang].description,
      share: defaultShare,
    };
  if (post) {
    const title = blogCopy[lang].postTitle(post.title, post.version);
    const share: ShareImage = post.image
      ? {
          url: `${siteUrl}${post.image.src}`,
          type: imageType(post.image.src),
          width: post.image.width,
          height: post.image.height,
          alt: post.image.alt,
        }
      : defaultShare;
    return {
      visibility: 'indexed',
      title,
      description: post.description,
      share,
      post,
      structuredData: postStructuredData(
        lang,
        siteUrl,
        homeName,
        blogCopy[lang].title,
        post.slug,
        title,
        {
          version: post.version,
          title: post.title,
          description: post.description,
          published: post.published,
          image: share.url,
          ...(post.keywords ? { keywords: post.keywords } : {}),
        },
      ),
    };
  }
  if (feature) {
    const copy = feature.copy[lang];
    return indexed(copy.headTitle, copy.headDescription, (facts) =>
      featureStructuredData(lang, siteUrl, homeName, feature, facts),
    );
  }
  if (page === 'features') {
    const copy = featuresHub.copy[lang];
    return indexed(copy.headTitle, copy.headDescription, (facts) =>
      featuresHubStructuredData(lang, siteUrl, homeName, facts),
    );
  }
  if (page === 'faq') {
    const copy = faq.copy[lang];
    return indexed(copy.headTitle, copy.headDescription, (facts) =>
      faqStructuredData(lang, siteUrl, homeName, facts),
    );
  }
  if (page === 'home') {
    const copy = siteHeadCopy[lang];
    return indexed(copy.title, copy.description, (facts) =>
      homeStructuredData(lang, siteUrl, facts),
    );
  }
  // The blog's list, or a post the caller passed no facts for (the dev server's case): both read
  // as the blog, and only the list carries the blog's graph.
  return indexed(
    blogCopy[lang].headTitle,
    blogCopy[lang].headDescription,
    page === 'blog'
      ? (facts) =>
          blogStructuredData(lang, siteUrl, homeName, blogCopy[lang].title, facts, blogPosts)
      : undefined,
  );
}
