import type { Localized } from '../../i18n/lang';
import type { ThemeSwitchLabels } from './theme-switch';

/** The footer's directory of the site's pages: its landmark name, group headings and links. */
export interface DirectoryLabels {
  /** The directory's accessible name, beside the main nav's. */
  label: string;
  /** Heads the features hub and each capability page. */
  features: string;
  /** The hub's link; the capabilities follow under their own names. */
  allFeatures: string;
  /** Heads the questions page, the blog and the project on GitHub. */
  resources: string;
  faq: string;
  blog: string;
  github: string;
  releases: string;
}

interface FooterCopy {
  languages: string;
  directory: DirectoryLabels;
  theme: ThemeSwitchLabels;
  note: string;
}

export const footerCopy = {
  en: {
    languages: 'Language',
    directory: {
      label: 'Site directory',
      features: 'Features',
      allFeatures: 'All features',
      resources: 'Resources',
      faq: 'FAQ',
      blog: 'Blog',
      github: 'GitHub',
      releases: 'Releases',
    },
    theme: {
      label: 'Color theme',
      system: 'Match system',
      light: 'Light',
      dark: 'Dark',
    },
    note: 'Atd is an independent project and is not affiliated with Apple Inc.',
  },
  zh: {
    languages: '语言',
    directory: {
      label: '网站目录',
      features: '功能',
      allFeatures: '全部功能',
      resources: '资源',
      faq: '常见问题',
      blog: '博客',
      github: 'GitHub',
      releases: '版本发布',
    },
    theme: {
      label: '外观主题',
      system: '跟随系统',
      light: '浅色',
      dark: '深色',
    },
    note: 'Atd 是独立项目，与 Apple Inc. 无关联。',
  },
} satisfies Localized<FooterCopy>;
