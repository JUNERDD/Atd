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
  /** The page's heading, for assistive tech and search: the lit display is the visible title. */
  title: string;
  /**
   * The words the display changes between, starting with the name. `|` marks where a word may
   * break onto two lines on narrow screens. The display is drawn, so these stay in English: they
   * spell out the name.
   */
  words: readonly string[];
  /** What the name stands for, first in the strip; its parts light up in step with the display. */
  legend: { label: string; parts: readonly string[]; suffix: string };
  /** Names the toggle that starts and stops the display's motion. */
  motion: string;
  /** Instrument strip along the hero's bottom edge. */
  readings: HeroReading[];
  scroll: string;
}

const keyNames: Partial<Record<string, string>> = { '⌘': 'Command', '⇧': 'Shift' };
const shortcutKeys = site.shortcut.map((legend) => ({ legend, name: keyNames[legend] ?? legend }));
const words = [site.name, 'Any|thing', 'Any|time', 'Any|where'];

export const heroCopy = {
  en: {
    title: 'Atd: anything, anytime, anywhere, to do.',
    words,
    legend: { label: site.name, parts: ['Anything', 'Anytime', 'Anywhere'], suffix: ' — to do' },
    motion: 'Animate the display',
    readings: [
      { label: 'Panel', value: '420 × 580 pt', effect: 'count' },
      { label: 'Summon', keys: shortcutKeys },
      { label: 'Service', value: 'Loopback only', effect: 'decode' },
      { label: 'Languages', value: 'English · 简体中文', effect: 'decode' },
    ],
    scroll: 'Scroll',
  },
  zh: {
    title: 'Atd：任何事、任何时间、任何地点，都能交给它。',
    words,
    legend: { label: site.name, parts: ['任何事', '任何时间', '任何地点'], suffix: '，都能做' },
    motion: '显示屏动画',
    readings: [
      { label: '面板', value: '420 × 580 pt', effect: 'count' },
      { label: '唤起', keys: shortcutKeys },
      { label: '服务', value: '仅监听本机', effect: 'type' },
      { label: '语言', value: 'English · 简体中文', effect: 'decode' },
    ],
    scroll: '向下滚动',
  },
} satisfies Localized<HeroCopy>;
