import type { Localized } from '../../i18n/lang';
import type { ThemeSwitchLabels } from './theme-switch';

interface FooterCopy {
  languages: string;
  theme: ThemeSwitchLabels;
  note: string;
}

export const footerCopy = {
  en: {
    languages: 'Language',
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
    theme: {
      label: '外观主题',
      system: '跟随系统',
      light: '浅色',
      dark: '深色',
    },
    note: 'Atd 是独立项目，与 Apple Inc. 无关联。',
  },
} satisfies Localized<FooterCopy>;
