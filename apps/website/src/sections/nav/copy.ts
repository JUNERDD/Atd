import type { Localized } from '../../i18n/lang';

interface NavCopy {
  label: string;
  home: string;
  skip: string;
  links: { href: string; label: string }[];
  download: string;
  language: string;
}

export const navCopy = {
  en: {
    label: 'Main',
    home: 'Atd home',
    skip: 'Skip to content',
    links: [
      { href: '#cases', label: 'Interfaces' },
      { href: '#features', label: 'Features' },
    ],
    download: 'Download',
    language: 'Change language',
  },
  zh: {
    label: '主导航',
    home: 'Atd 首页',
    skip: '跳到正文',
    links: [
      { href: '#cases', label: '界面' },
      { href: '#features', label: '功能' },
    ],
    download: '下载',
    language: '切换语言',
  },
} satisfies Localized<NavCopy>;
