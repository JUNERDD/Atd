import { site } from '../../content/site';
import type { Localized } from '../../i18n/lang';

interface FooterCopy {
  /** Names the link list for assistive tech. */
  linksLabel: string;
  repo: { href: string; label: string };
  /** The site's blog. */
  blog: string;
  issues: { href: string; label: string };
  languages: string;
  note: string;
}

export const footerCopy = {
  en: {
    linksLabel: 'Project',
    repo: { href: site.repoUrl, label: 'Open source on GitHub' },
    blog: 'Blog',
    issues: { href: site.issuesUrl, label: 'Report an issue' },
    languages: 'Language',
    note: 'Atd is an independent project and is not affiliated with Apple Inc.',
  },
  zh: {
    linksLabel: '项目',
    repo: { href: site.repoUrl, label: 'GitHub 开源仓库' },
    blog: '博客',
    issues: { href: site.issuesUrl, label: '反馈问题' },
    languages: '语言',
    note: 'Atd 是独立项目，与 Apple Inc. 无关联。',
  },
} satisfies Localized<FooterCopy>;
