/**
 * The schema.org vocabulary every page's graph shares (stable node ids, the `WebSite` and
 * `Person` nodes, breadcrumbs, questions) and the homepage's graph, which alone defines the
 * `SoftwareApplication` node that other pages reference by `@id` as what they are about. The
 * graphs of other page families live in `seo/*-structured-data.ts`.
 */
import { site } from './content/site.ts';
import { htmlLang, LANGS, langPath, pagePath, type Lang, type Localized } from './i18n/routes.ts';

/** What one language's page says about itself, shared with its meta tags. */
export interface PageFacts {
  title: string;
  description: string;
  /** The share image, an absolute URL. */
  image: string;
}

const SITE_ALTERNATE_NAMES = ['Atd App', 'Atd AI', 'Atd for macOS', 'atd.best'] as const;

const SITE_DESCRIPTION =
  'Atd (anything, anytime, anywhere, to do) is a free, open-source AI desktop agent for macOS.';

const appAlternateNames: Localized<readonly string[]> = {
  en: ['Atd App', 'Atd AI', 'Atd Agent', 'Atd for macOS', 'Anything, Anytime, Anywhere, To Do'],
  zh: ['Atd AI', 'Atd 智能体', 'Atd macOS', 'Atd Mac', 'Anything, Anytime, Anywhere, To Do'],
};

const homeKeywords: Localized<readonly string[]> = {
  en: [
    'Atd',
    'Atd AI',
    'Atd agent',
    'Atd app',
    'Atd macOS',
    'open-source macOS AI agent',
    'AI desktop agent for Mac',
    'Mac computer use agent',
    'local LLM macOS',
    'MCP client for Mac',
  ],
  zh: [
    'Atd',
    'Atd AI',
    'Atd 智能体',
    'Atd macOS',
    'Atd Mac',
    '开源 macOS AI 桌面智能体',
    'Mac 电脑操作 AI',
    '本地大模型 Mac 应用',
    'MCP 客户端',
  ],
};

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

/**
 * The `@id`s of the site-wide nodes. They stay stable across pages and builds so every page's
 * graph can point at the same website, author and app.
 */
export function schemaIds(siteUrl: string) {
  const home = `${siteUrl}/`;
  return {
    home,
    website: `${home}#website`,
    author: `${home}#author`,
    app: `${home}#app`,
  };
}

/** The `WebSite` and `Person` nodes every page's graph starts with. */
export function baseNodes(siteUrl: string) {
  const ids = schemaIds(siteUrl);
  return [
    {
      '@type': 'WebSite',
      '@id': ids.website,
      url: ids.home,
      name: site.name,
      alternateName: [...SITE_ALTERNATE_NAMES],
      description: SITE_DESCRIPTION,
      inLanguage: LANGS.map((other) => htmlLang[other]),
      about: { '@id': ids.app },
      publisher: { '@id': ids.author },
    },
    {
      '@type': 'Person',
      '@id': ids.author,
      name: site.author,
      url: `https://github.com/${site.author}`,
      sameAs: [`https://github.com/${site.author}`],
    },
  ];
}

/** The localized home page as a breadcrumb trail's first step. */
export function homeCrumb(lang: Lang, siteUrl: string, homeName: string) {
  return { name: homeName, item: `${siteUrl}${langPath[lang]}` };
}

export function breadcrumbList(id: string, items: readonly { name: string; item: string }[]) {
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

/** One question and its plain-text answer, as an `FAQPage`'s `mainEntity` lists it. */
export function questionNode(question: string, answer: string) {
  return {
    '@type': 'Question',
    name: question,
    acceptedAnswer: { '@type': 'Answer', text: answer },
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
  const keywords = homeKeywords[lang].join(', ');
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
        keywords,
        isPartOf: { '@id': ids.website },
        about: { '@id': ids.app },
        primaryImageOfPage: { '@type': 'ImageObject', url: page.image },
      },
      {
        '@type': ['SoftwareApplication', 'SoftwareSourceCode'],
        '@id': ids.app,
        name: site.name,
        alternateName: [...appAlternateNames[lang]],
        description: page.description,
        url: ids.home,
        image: page.image,
        applicationCategory: 'UtilitiesApplication',
        applicationSubCategory: 'DeveloperApplication',
        operatingSystem: `macOS ${minMacOS} or later`,
        processorRequirements: site.downloads.map((download) => download.chip[lang]).join(', '),
        softwareVersion: site.version,
        downloadUrl: site.downloads.map((download) => download.url),
        installUrl: `${url}#download`,
        releaseNotes: `${siteUrl}${pagePath(lang, 'blog')}`,
        softwareHelp: `${siteUrl}${pagePath(lang, 'faq')}`,
        codeRepository: site.repoUrl,
        programmingLanguage: ['TypeScript', 'Swift', 'Rust'],
        license: site.licenseUrl,
        isAccessibleForFree: true,
        keywords,
        featureList: featureList[lang],
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        author: { '@id': ids.author },
        sameAs: [...site.sameAs],
      },
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
