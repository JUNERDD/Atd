import { debugCopy } from './pages/debug/copy.ts';
import { site } from './content/site.ts';
import { htmlLang, LANGS, pagePath, type Lang, type Localized, type Page } from './i18n/routes.ts';
import { structuredData, structuredDataScript } from './structured-data.ts';

interface HeadCopy {
  /** The search result and share card title: the name, then what it is in the words people search. */
  title: string;
  /** The search snippet and share card text, within about 160 characters (80 for Chinese). */
  description: string;
  /** What the share image shows, for readers who cannot see it. */
  imageAlt: string;
  ogLocale: string;
}

const shortcut = site.shortcut.join(' ');

const headCopy: Localized<HeadCopy> = {
  en: {
    title: `${site.name} — A quiet AI agent for your Mac`,
    description: `${site.name} is a free, open-source AI agent for macOS. Press ${shortcut} anywhere and hand it coding and everyday tasks, with cloud or local models.`,
    imageAlt: `${site.name}, lit in white dots on a black LED panel`,
    ogLocale: 'en_US',
  },
  zh: {
    title: `${site.name} — 安静待命的 Mac AI 智能体`,
    description: `${site.name} 是一款免费开源的 macOS AI 智能体。在任何地方按下 ${shortcut} 唤出面板，用云端或本地模型，在自己的 Mac 上完成编程与日常任务。`,
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

/**
 * The `<head>` tags of one language's page: title, description, robots directives, canonical and
 * alternate language links, the Open Graph and X cards, and the structured data. `siteUrl` is the
 * production origin, without a trailing slash.
 */
export function renderHead(lang: Lang, siteUrl: string, page: Page = 'home'): string {
  const copy =
    page === 'debug'
      ? {
          ...headCopy[lang],
          title: `${debugCopy[lang].title} — Atd`,
          description: debugCopy[lang].description,
        }
      : headCopy[lang];
  const url = `${siteUrl}${pagePath(lang, page)}`;
  const image = `${siteUrl}/og.jpg`;
  const title = escapeAttr(copy.title);
  const description = escapeAttr(copy.description);
  const imageAlt = escapeAttr(copy.imageAlt);
  const alternates = LANGS.map(
    (other) =>
      `<link rel="alternate" hreflang="${htmlLang[other]}" href="${siteUrl}${pagePath(other, page)}" />`,
  );
  const otherLocales = LANGS.filter((other) => other !== lang).map(
    (other) => `<meta property="og:locale:alternate" content="${headCopy[other].ogLocale}" />`,
  );
  const tags = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta name="robots" content="${page === 'debug' ? 'noindex, nofollow' : 'index, follow, max-image-preview:large, max-snippet:-1'}" />`,
    `<meta name="application-name" content="${site.name}" />`,
    `<meta name="apple-mobile-web-app-title" content="${site.name}" />`,
    `<link rel="canonical" href="${url}" />`,
    ...alternates,
    `<link rel="alternate" hreflang="x-default" href="${siteUrl}${pagePath('en', page)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${site.name}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:locale" content="${copy.ogLocale}" />`,
    ...otherLocales,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:type" content="image/jpeg" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${imageAlt}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    `<meta name="twitter:image:alt" content="${imageAlt}" />`,
    ...(page === 'home'
      ? [
          structuredDataScript(
            structuredData(lang, siteUrl, {
              title: copy.title,
              description: copy.description,
              image,
            }),
          ),
        ]
      : []),
  ];
  return tags.join('\n    ');
}
