import type { Localized } from '../../i18n/lang';

interface NavCopy {
  label: string;
  home: string;
  skip: string;
  links: { href: string; label: string }[];
  download: string;
  /** The other language's name, written in that language. */
  switchTo: string;
  switchName: string;
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
    switchTo: '中文',
    switchName: '简体中文',
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
    switchTo: 'EN',
    switchName: 'English',
  },
} satisfies Localized<NavCopy>;
