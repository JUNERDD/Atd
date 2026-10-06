import { htmlLang, LANGS, langPath, type Lang, type Localized } from './i18n/routes.ts';

interface HeadCopy {
  title: string;
  description: string;
  ogLocale: string;
}

const headCopy: Localized<HeadCopy> = {
  en: {
    title: 'Atd — A quiet agent for your Mac',
    description:
      'Atd is a native macOS agent panel. Summon it from anywhere with ⌘ ⇧ Space, and it runs coding and everyday tasks on your own Mac.',
    ogLocale: 'en_US',
  },
  zh: {
    title: 'Atd — 安静待命的 Mac 智能体',
    description:
      'Atd 是一款原生 macOS 智能体面板。在任何地方按下 ⌘ ⇧ Space 即可唤出，在你自己的 Mac 上完成编程与日常任务。',
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
 * The `<head>` tags of one language's page: title, description, canonical and alternate language
 * links, and the Open Graph card. `siteUrl` is the production origin, without a trailing slash.
 */
export function renderHead(lang: Lang, siteUrl: string): string {
  const copy = headCopy[lang];
  const url = `${siteUrl}${langPath[lang]}`;
  const alternates = LANGS.map(
    (other) =>
      `<link rel="alternate" hreflang="${htmlLang[other]}" href="${siteUrl}${langPath[other]}" />`,
  );
  const tags = [
    `<title>${escapeAttr(copy.title)}</title>`,
    `<meta name="description" content="${escapeAttr(copy.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    ...alternates,
    `<link rel="alternate" hreflang="x-default" href="${siteUrl}${langPath.en}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Atd" />`,
    `<meta property="og:title" content="${escapeAttr(copy.title)}" />`,
    `<meta property="og:description" content="${escapeAttr(copy.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:locale" content="${copy.ogLocale}" />`,
    `<meta property="og:image" content="${siteUrl}/og.jpg" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ];
  return tags.join('\n    ');
}
