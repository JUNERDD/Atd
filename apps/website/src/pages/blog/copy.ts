import type { Localized } from '../../i18n/routes.ts';

interface BlogCopy {
  /** The list's heading, lit in dots; also the back button's label on a post. */
  title: string;
  lede: string;
  /** The list's search result and share card title and text. */
  headTitle: string;
  headDescription: string;
  /** A post's search result and share card title. */
  postTitle: (title: string) => string;
  /** Names the release a post announces. */
  release: (version: string) => string;
  /** The back button's accessible name, and the plain link at a post's end. */
  back: string;
  /** Heads a post's contents, the links to its sections. */
  contents: string;
  fixes: string;
  /** A post's primary action: its GitHub release, which carries the installers. */
  onGitHub: (version: string) => string;
  allReleases: string;
  /** Shown for a post address that names no post (the dev server serves any). */
  missing: string;
}

export const blogCopy = {
  en: {
    title: 'Blog',
    lede: 'Release notes and news from Atd, newest first.',
    headTitle: 'Blog — Atd',
    headDescription:
      'Release notes and news from Atd, the free, open-source AI agent for macOS: new features, improvements and fixes in each version.',
    postTitle: (title) => `${title} — Atd Blog`,
    release: (version) => `Atd ${version}`,
    back: 'Back to Blog',
    contents: 'On this page',
    fixes: 'Fixes',
    onGitHub: (version) => `Get Atd ${version}`,
    allReleases: 'All releases on GitHub',
    missing: 'There is no post at this address.',
  },
  zh: {
    title: '博客',
    lede: 'Atd 的版本更新与动态，最新的在前。',
    headTitle: '博客 — Atd',
    headDescription:
      'Atd 的版本更新与动态：每个版本的新功能、改进与修复。Atd 是一款免费开源的 macOS AI 智能体。',
    postTitle: (title) => `${title} — Atd 博客`,
    release: (version) => `Atd ${version}`,
    back: '返回博客',
    contents: '目录',
    fixes: '修复',
    onGitHub: (version) => `获取 Atd ${version}`,
    allReleases: '在 GitHub 查看全部版本',
    missing: '这个地址没有对应的文章。',
  },
} satisfies Localized<BlogCopy>;
