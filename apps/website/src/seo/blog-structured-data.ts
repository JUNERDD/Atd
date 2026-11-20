import { htmlLang, pagePath, type Lang } from '../i18n/routes.ts';
import {
  baseNodes,
  breadcrumbList,
  homeCrumb,
  schemaIds,
  type PageFacts,
} from '../structured-data.ts';

/** Minimal post metadata used on blog index structured data. */
export interface BlogIndexPostData {
  slug: string;
  version: string;
  title: string;
  description: string;
  published: string;
  image?: string;
}

/** Full release post facts for `BlogPosting` schema.org markup. */
export interface PostFacts extends PageFacts {
  version: string;
  published: string;
  keywords?: readonly string[];
}

/**
 * Schema.org graph for `/blog` and `/zh/blog`: `Blog` collection and `BreadcrumbList`.
 */
export function blogStructuredData(
  lang: Lang,
  siteUrl: string,
  homeName: string,
  blogName: string,
  page: PageFacts,
  posts: readonly BlogIndexPostData[],
): object {
  const ids = schemaIds(siteUrl);
  const url = `${siteUrl}${pagePath(lang, 'blog')}`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      ...baseNodes(siteUrl),
      {
        '@type': 'Blog',
        '@id': `${url}#blog`,
        url,
        name: page.title,
        description: page.description,
        inLanguage: htmlLang[lang],
        isPartOf: { '@id': ids.website },
        publisher: { '@id': ids.author },
        about: { '@id': ids.app },
        blogPost: posts.map((post) => ({
          '@type': 'BlogPosting',
          headline: post.title,
          description: post.description,
          url: `${siteUrl}${pagePath(lang, `blog/${post.slug}`)}`,
          datePublished: post.published,
          inLanguage: htmlLang[lang],
          ...(post.image ? { image: post.image } : {}),
        })),
      },
      breadcrumbList(`${url}#breadcrumb`, [
        homeCrumb(lang, siteUrl, homeName),
        { name: blogName, item: url },
      ]),
    ],
  };
}

/**
 * Schema.org graph for an individual release post: `WebPage`, `BlogPosting`, and `BreadcrumbList`.
 */
export function postStructuredData(
  lang: Lang,
  siteUrl: string,
  homeName: string,
  blogName: string,
  slug: string,
  pageTitle: string,
  post: PostFacts,
): object {
  const ids = schemaIds(siteUrl);
  const blogUrl = `${siteUrl}${pagePath(lang, 'blog')}`;
  const url = `${siteUrl}${pagePath(lang, `blog/${slug}`)}`;
  const webpageId = `${url}#webpage`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      ...baseNodes(siteUrl),
      {
        '@type': 'WebPage',
        '@id': webpageId,
        url,
        name: pageTitle,
        description: post.description,
        inLanguage: htmlLang[lang],
        isPartOf: { '@id': ids.website },
        breadcrumb: { '@id': `${url}#breadcrumb` },
        primaryImageOfPage: { '@type': 'ImageObject', url: post.image },
      },
      {
        '@type': 'BlogPosting',
        '@id': `${url}#article`,
        headline: post.title,
        description: post.description,
        datePublished: post.published,
        dateModified: post.published,
        url,
        inLanguage: htmlLang[lang],
        image: { '@type': 'ImageObject', url: post.image },
        author: { '@id': ids.author },
        publisher: { '@id': ids.author },
        isPartOf: { '@id': `${blogUrl}#blog` },
        about: { '@id': ids.app },
        mainEntityOfPage: { '@id': webpageId },
        ...(post.keywords && post.keywords.length > 0
          ? { keywords: post.keywords.join(', ') }
          : {}),
      },
      breadcrumbList(`${url}#breadcrumb`, [
        homeCrumb(lang, siteUrl, homeName),
        { name: blogName, item: blogUrl },
        { name: post.title, item: url },
      ]),
    ],
  };
}
