import { site } from '../../content/site';
import type { Localized } from '../../i18n/lang';

interface FooterCopy {
  /** Names the link list for assistive tech. */
  linksLabel: string;
  links: { href: string; label: string }[];
  languages: string;
  note: string;
}

export const footerCopy = {
  en: {
    linksLabel: 'Project',
    links: [
      { href: site.repoUrl, label: 'Source on GitHub' },
      { href: site.releasesUrl, label: 'Release notes' },
      { href: site.issuesUrl, label: 'Report an issue' },
    ],
    languages: 'Language',
    note: 'Atd is an independent project and is not affiliated with Apple Inc.',
  },
  zh: {
    linksLabel: '项目',
    links: [
      { href: site.repoUrl, label: 'GitHub 源码' },
      { href: site.releasesUrl, label: '更新说明' },
      { href: site.issuesUrl, label: '反馈问题' },
    ],
    languages: '语言',
    note: 'Atd 是独立项目，与 Apple Inc. 无关联。',
  },
} satisfies Localized<FooterCopy>;
