import type { Localized } from '../../i18n/routes.ts';

interface NotFoundCopy {
  headTitle: string;
  headDescription: string;
  title: string;
  description: string;
  home: string;
  blog: string;
  alternateLabel: string;
}

export const notFoundCopy = {
  en: {
    headTitle: '404 — Page Not Found — Atd',
    headDescription: 'The requested page could not be found on Atd.',
    title: 'Page not found.',
    description: 'This address may have moved, or there is no page at this path.',
    home: 'Back to Atd home',
    blog: 'Read the Blog',
    alternateLabel: '简体中文首页',
  },
  zh: {
    headTitle: '404 — 找不到页面 — Atd',
    headDescription: '你访问的 Atd 页面不存在或已移动。',
    title: '找不到页面。',
    description: '这个链接可能已经变更，或当前路径没有对应的页面。',
    home: '返回 Atd 首页',
    blog: '查看博客与更新日志',
    alternateLabel: 'English home',
  },
} satisfies Localized<NotFoundCopy>;
