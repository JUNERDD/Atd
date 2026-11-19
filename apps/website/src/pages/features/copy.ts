import type { Localized } from '../../i18n/routes.ts';

/**
 * The feature pages' own labels. Each capability's text and the hub's heading are content
 * (`content/features/`); these are the words around them, shared by the hub and every capability.
 */
interface FeaturesPageCopy {
  /** The hub's short name: the back bar's label on a capability page. */
  hub: string;
  /** The back bar's accessible name. */
  back: string;
  /** The plain link back to the hub at a capability page's end. */
  allFeatures: string;
  /** Heads a capability page's contents, the links to its sections. */
  contents: string;
  /** The capability page's questions section. */
  questions: string;
  /** The capability page's links to other capabilities. */
  related: string;
  /** The capability page's links to the release posts that introduced or changed it. */
  releaseNotes: string;
  /** Names a release, as the blog does. */
  release: (version: string) => string;
  /** The primary action, which leads to the home page's download section. */
  download: string;
  /** The plain link beside the download in a capability page's header. */
  source: string;
  /** The hub's link to the questions page. */
  faq: string;
  /** Shown for a capability address that names no page (the dev server serves any). */
  missing: string;
}

export const featuresPageCopy = {
  en: {
    hub: 'Features',
    back: 'Back to all features',
    allFeatures: 'All features',
    contents: 'On this page',
    questions: 'Questions',
    related: 'Related features',
    releaseNotes: 'Release notes',
    release: (version) => `Atd ${version}`,
    download: 'Download for Mac',
    source: 'Source on GitHub',
    faq: 'Read the FAQ',
    missing: 'There is no feature page at this address.',
  },
  zh: {
    hub: '功能',
    back: '返回全部功能',
    allFeatures: '全部功能',
    contents: '目录',
    questions: '常见问题',
    related: '相关功能',
    releaseNotes: '更新日志',
    release: (version) => `Atd ${version}`,
    download: '下载 Mac 版',
    source: '在 GitHub 查看源码',
    faq: '查看常见问题',
    missing: '这个地址没有对应的功能页面。',
  },
} satisfies Localized<FeaturesPageCopy>;
