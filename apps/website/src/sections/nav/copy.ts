import type { Localized } from '../../i18n/lang';

interface NavCopy {
  label: string;
  home: string;
  skip: string;
  /** The home page's sections, as `#id` links. */
  links: { href: string; label: string }[];
  /** The blog's link. */
  blog: string;
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
    download: '下载',
    language: '切换语言',
  },
} satisfies Localized<NavCopy>;
