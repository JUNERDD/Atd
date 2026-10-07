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
      { href: '#features', label: 'Features' },
      { href: '#cases', label: 'Interfaces' },
      { href: '#privacy', label: 'Privacy' },
    ],
    download: 'Download',
    language: 'Change language',
  },
  zh: {
    label: '主导航',
    home: 'Atd 首页',
    skip: '跳到正文',
    links: [
      { href: '#features', label: '功能' },
      { href: '#cases', label: '界面' },
      { href: '#privacy', label: '隐私' },
    ],
    download: '下载',
    language: '切换语言',
  },
} satisfies Localized<NavCopy>;
