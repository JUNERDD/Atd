import type { Localized } from '../i18n/lang';

export interface SummonPanel {
  src: string;
  width: number;
  height: number;
}

/** Unsent drafts captured in the native app at its 560 × 720 pt default size. */
export const summonPanels = {
  en: { src: '/summon/panel-en.png', width: 560, height: 720 },
  zh: { src: '/summon/panel-zh.png', width: 560, height: 720 },
} satisfies Localized<SummonPanel>;
