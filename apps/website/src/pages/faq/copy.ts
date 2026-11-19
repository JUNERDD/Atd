import type { Localized } from '../../i18n/routes.ts';

/**
 * The questions page's own labels. Its heading, lede and questions are content (`content/faq/`);
 * these are the words around them.
 */
interface FaqLabels {
  /** Heads the page's contents, the links to its groups of questions. */
  contents: string;
  /** The link after an answer to the capability page that covers it in depth. */
  learnMore: (feature: string) => string;
  /** Names the release the download installs, as the blog does. */
  release: (version: string) => string;
  /** The primary action, which leads to the home page's download section. */
  download: string;
  /** The plain link to the features hub at the page's end. */
  hub: string;
}

export const faqLabels = {
  en: {
    contents: 'On this page',
    learnMore: (feature) => `Learn more: ${feature}`,
    release: (version) => `Atd ${version}`,
    download: 'Download for Mac',
    hub: 'Explore all features',
  },
  zh: {
    contents: '目录',
    learnMore: (feature) => `了解更多：${feature}`,
    release: (version) => `Atd ${version}`,
    download: '下载 Mac 版',
    hub: '查看全部功能',
  },
} satisfies Localized<FaqLabels>;
