import type { Localized } from '../../i18n/lang';

interface FooterLink {
  href: string;
  label: string;
}

interface FooterCopy {
  tagline: string;
  columns: { title: string; links: FooterLink[] }[];
  languages: string;
  note: string;
  grid: string;
}

const repo = 'https://github.com/JUNERDD/ai';

export const footerCopy = {
  en: {
    tagline: 'A quiet agent in the corner of your screen.',
    columns: [
      {
        title: 'Product',
        links: [
          { href: '#features', label: 'Features' },
          { href: '#automations', label: 'Automations' },
          { href: '#cases', label: 'In practice' },
          { href: '#download', label: 'Download' },
        ],
      },
      {
        title: 'Resources',
        links: [
          { href: repo, label: 'Source on GitHub' },
          { href: `${repo}/releases`, label: 'Release notes' },
          { href: `${repo}/issues`, label: 'Report an issue' },
        ],
      },
    ],
    languages: 'Language',
    note: 'Atd is an independent project and is not affiliated with Apple Inc.',
    grid: 'Set on a 24 px dot grid',
  },
  zh: {
    tagline: '屏幕一角，安静待命的智能体。',
    columns: [
      {
        title: '产品',
        links: [
          { href: '#features', label: '功能' },
          { href: '#automations', label: '自动化' },
          { href: '#cases', label: '实录' },
          { href: '#download', label: '下载' },
        ],
      },
      {
        title: '资源',
        links: [
          { href: repo, label: 'GitHub 源码' },
          { href: `${repo}/releases`, label: '更新说明' },
          { href: `${repo}/issues`, label: '反馈问题' },
        ],
      },
    ],
    languages: '语言',
    note: 'Atd 是独立项目，与 Apple Inc. 无关联。',
    grid: '排布于 24 px 点阵网格',
  },
} satisfies Localized<FooterCopy>;
