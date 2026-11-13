import type { Localized } from '../../i18n/lang';

interface GitHubEntryCopy {
  /** Visible action label shown alongside the mark from 416 px upward. */
  label: string;
  /** Screen-reader name formatter including the repository star count. */
  ariaLabel: (stars: string) => string;
}

interface NavCopy {
  label: string;
  home: string;
  skip: string;
  /** The home page's sections, as `#id` links. */
  links: { href: string; label: string }[];
  /** The blog's link. */
  blog: string;
  github: GitHubEntryCopy;
  download: string;
  language: string;
}

export const navCopy = {
  en: {
    label: 'Main',
    home: 'Atd home',
    skip: 'Skip to content',
    links: [
      { href: '#cases', label: 'Features' },
      { href: '#features', label: 'Control' },
    ],
    blog: 'Blog',
    github: {
      label: 'Star',
      ariaLabel: (stars) => `Star Atd on GitHub (${stars})`,
    },
    download: 'Download',
    language: 'Change language',
  },
  zh: {
    label: '主导航',
    home: 'Atd 首页',
    skip: '跳到正文',
    links: [
      { href: '#cases', label: '功能' },
      { href: '#features', label: '掌控' },
    ],
    blog: '博客',
    github: {
      label: 'Star',
      ariaLabel: (stars) => `在 GitHub 为 Atd 点亮 Star（${stars}）`,
    },
    download: '下载',
    language: '切换语言',
  },
} satisfies Localized<NavCopy>;
