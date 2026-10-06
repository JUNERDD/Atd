import { site } from '../../content/site';
import type { Localized } from '../../i18n/lang';

interface HeroKey {
  /** The legend printed on the key. */
  legend: string;
  /** What a screen reader says for a symbol legend. */
  name: string;
}

/**
 * One instrument readout: a plain value with the text effect it arrives with (see styles/motion.css),
 * or keys (set in the text face, which has ⌘ and ⇧).
 */
export type HeroReading =
  | { label: string; value: string; effect: 'count' | 'decode' | 'type' }
  | { label: string; keys: readonly HeroKey[] };

interface HeroCopy {
  /** The page's heading, for assistive tech and search: the lit wordmark is the visible title. */
  title: string;
  /** Instrument strip along the hero's bottom edge. */
  readings: HeroReading[];
  scroll: string;
}

const keyNames: Partial<Record<string, string>> = { '⌘': 'Command', '⇧': 'Shift' };
const shortcutKeys = site.shortcut.map((legend) => ({ legend, name: keyNames[legend] ?? legend }));

export const heroCopy = {
  en: {
    title: 'Atd — a quiet agent in the corner of your screen.',
    readings: [
      { label: 'Panel', value: '420 × 580 pt', effect: 'count' },
      { label: 'Summon', keys: shortcutKeys },
      { label: 'Service', value: 'Loopback only', effect: 'decode' },
      { label: 'Languages', value: 'English · 简体中文', effect: 'decode' },
    ],
    scroll: 'Scroll',
  },
  zh: {
    title: 'Atd——屏幕一角，安静待命的智能体。',
    readings: [
      { label: '面板', value: '420 × 580 pt', effect: 'count' },
      { label: '唤起', keys: shortcutKeys },
      { label: '服务', value: '仅监听本机', effect: 'type' },
      { label: '语言', value: 'English · 简体中文', effect: 'decode' },
    ],
    scroll: '向下滚动',
  },
} satisfies Localized<HeroCopy>;
