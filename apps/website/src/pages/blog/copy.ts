import type { Localized } from '../../i18n/routes.ts';

export const BLOG_NOTE_KINDS = ['improvements', 'fixes', 'other'] as const;
export type BlogNoteKind = (typeof BLOG_NOTE_KINDS)[number];

interface BlogCopy {
  /** The list's heading, lit in dots; also the back button's label on a post. */
  title: string;
  lede: string;
  /** The list's search result and share card title and text. */
  headTitle: string;
  headDescription: string;
  /** The RSS feed title advertised in `<head>` and `<channel>`. */
  rssTitle: string;
  /** A post's search result and share card title, pairing headline with version for release search. */
  postTitle: (title: string, version: string) => string;
  /** Names the release a post announces. */
  release: (version: string) => string;
  /** The back button's accessible name, and the plain link at a post's end. */
  back: string;
  /** Heads a post's contents, the links to its sections. */
  contents: string;
  improvements: string;
  fixes: string;
  other: string;
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
    headTitle: 'Blog & Release Notes — Atd',
    headDescription:
      'Release notes and product updates for Atd, the open-source macOS AI agent: new features, computer use, captures, and fixes.',
    rssTitle: 'Atd Blog & Release Notes',
    postTitle: (title, version) => `${title} — Atd ${version}`,
    release: (version) => `Atd ${version}`,
    back: 'Back to Blog',
    contents: 'On this page',
    improvements: 'Improvements',
    fixes: 'Fixes',
    other: 'Other',
    onGitHub: (version) => `Get Atd ${version}`,
    allReleases: 'All releases on GitHub',
    missing: 'There is no post at this address.',
  },
  zh: {
    title: '博客',
    lede: 'Atd 的版本更新与动态，最新的在前。',
    headTitle: '博客与更新日志 — Atd',
    headDescription:
      'Atd 开源 macOS AI 智能体的版本更新与产品动态：每版新功能、电脑操作、截图录屏与问题修复。',
    rssTitle: 'Atd 博客与更新日志',
    postTitle: (title, version) => `${title} — Atd ${version}`,
    release: (version) => `Atd ${version}`,
    back: '返回博客',
    contents: '目录',
    improvements: '优化',
    fixes: '修复',
    other: '其他',
    onGitHub: (version) => `获取 Atd ${version}`,
    allReleases: '在 GitHub 查看全部版本',
    missing: '这个地址没有对应的文章。',
  },
} satisfies Localized<BlogCopy>;
