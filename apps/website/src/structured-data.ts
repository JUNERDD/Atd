import { site } from './content/site.ts';
import { htmlLang, LANGS, langPath, pagePath, type Lang, type Localized } from './i18n/routes.ts';

/** What one language's page says about itself, shared with its meta tags. */
export interface PageFacts {
  title: string;
  description: string;
  /** The share image, an absolute URL. */
  image: string;
}

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

const featureList: Localized<readonly string[]> = {
  en: [
    'Selection toolbar with in-place actions',
    'Screenshot annotations, scrolling capture, and screen recording',
    'Mac computer use and autonomous subagents',
    'Skills, MCP servers, and slash commands',
    'Local memory and per-action permission approvals',
    'Cloud models and local runtimes on macOS',
  ],
  zh: [
    '选区旁浮动工具栏与就地写回结果',
    '截图标注、滚动长截图与录屏识步提问',
    'Mac 电脑操作（Computer Use）与子智能体协作',
    'Skills、MCP 与斜杠命令扩展',
    '本地审核记忆与关键操作逐次授权',
    '接入云端模型与本地运行时',
  ],
};

function schemaIds(siteUrl: string) {
  const home = `${siteUrl}/`;
  return {
    home,
    website: `${home}#website`,
    author: `${home}#author`,
    app: `${home}#app`,
  };
}

function baseNodes(siteUrl: string) {
  const ids = schemaIds(siteUrl);
  return [
    {
      '@type': 'WebSite',
      '@id': ids.website,
      url: ids.home,
      name: site.name,
      inLanguage: LANGS.map((other) => htmlLang[other]),
      publisher: { '@id': ids.author },
    },
    {
      '@type': 'Person',
      '@id': ids.author,
      name: site.author,
      url: `https://github.com/${site.author}`,
      sameAs: [`https://github.com/${site.author}`, site.repoUrl],
    },
  ];
}

function breadcrumbList(id: string, items: readonly { name: string; item: string }[]) {
  return {
    '@type': 'BreadcrumbList',
    '@id': id,
    itemListElement: items.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.name,
      item: entry.item,
    })),
  };
}

/**
 * Schema.org graph for the localized homepage: `WebSite`, `Person`, `WebPage`, and
 * `SoftwareApplication` sourced from `content/site.ts`.
 */
export function homeStructuredData(lang: Lang, siteUrl: string, page: PageFacts): object {
  const ids = schemaIds(siteUrl);
  const minMacOS = Math.min(...site.downloads.map((download) => Number(download.minMacOS)));
  const url = `${siteUrl}${langPath[lang]}`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      ...baseNodes(siteUrl),
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: page.title,
        description: page.description,
        inLanguage: htmlLang[lang],
        isPartOf: { '@id': ids.website },
        about: { '@id': ids.app },
        primaryImageOfPage: { '@type': 'ImageObject', url: page.image },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': ids.app,
        name: site.name,
        description: page.description,
        url: ids.home,
        image: page.image,
        applicationCategory: 'UtilitiesApplication',
        applicationSubCategory: 'DeveloperApplication',
        operatingSystem: `macOS ${minMacOS} or later`,
        processorRequirements: site.downloads.map((download) => download.chip[lang]).join(', '),
        softwareVersion: site.version,
        downloadUrl: site.downloads.map((download) => download.url),
        releaseNotes: site.releasesUrl,
        license: site.licenseUrl,
        isAccessibleForFree: true,
        featureList: featureList[lang],
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        author: { '@id': ids.author },
        sameAs: [site.repoUrl],
      },
    ],
  };
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
        { name: homeName, item: `${siteUrl}${langPath[lang]}` },
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
        { name: homeName, item: `${siteUrl}${langPath[lang]}` },
        { name: blogName, item: blogUrl },
        { name: post.title, item: url },
      ]),
    ],
  };
}

/**
 * The graph as a `<script>` element. `<` is escaped so no string in the data can close the element
 * early; JSON parsers read `<` back as `<`.
 */
export function structuredDataScript(data: object): string {
  const json = JSON.stringify(data).replaceAll('<', '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}
