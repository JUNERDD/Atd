import { site } from '../../content/site';
import type { Localized } from '../../i18n/lang';

interface HeroKey {
  /** The legend printed on the key. */
  legend: string;
  /** What a screen reader says for a symbol legend. */
  name: string;
}

/** One instrument readout: a plain value, or keys (set in the text face, which has ⌘ and ⇧). */
export type HeroReading =
  | { label: string; value: string }
  | { label: string; keys: readonly HeroKey[] };

interface HeroCopy {
  /** Grid index printed before the kicker, like the sections' `A·01`. */
  index: string;
  kicker: string;
  /** The headline in phrases. Chinese keeps each phrase on one line where it fits (see hero.css). */
  title: readonly string[];
  lede: string;
  download: string;
  github: string;
  requirements: string;
  /** Instrument strip along the hero's bottom edge. */
  readings: HeroReading[];
  scroll: string;
}

const shortcut = site.shortcut.join(' ');
const keyNames: Partial<Record<string, string>> = { '⌘': 'Command', '⇧': 'Shift' };
const shortcutKeys = site.shortcut.map((legend) => ({ legend, name: keyNames[legend] ?? legend }));

export const heroCopy = {
  en: {
    index: 'A·00',
    kicker: 'Atd · Desktop agent panel',
    title: ['A quiet agent in the corner of your screen.'],
    lede: `Press ${shortcut} and a small panel opens in the bottom-right corner. Hand it a coding task or an everyday one. It runs on your own Mac while you keep working.`,
    download: 'Download for Mac',
    github: 'View on GitHub',
    requirements: `macOS ${site.minMacOS} or later · ${site.chip} · v${site.version}`,
    readings: [
      { label: 'Panel', value: '420 × 580 pt' },
      { label: 'Summon', keys: shortcutKeys },
      { label: 'Service', value: 'Loopback only' },
      { label: 'Languages', value: 'English · 简体中文' },
    ],
    scroll: 'Scroll',
  },
  zh: {
    index: 'A·00',
    kicker: 'Atd · 桌面智能体面板',
    title: ['屏幕一角，', '安静待命的智能体。'],
    lede: `按下 ${shortcut}，屏幕右下角便会打开一个小面板。把编程任务或日常琐事交给它，它在你自己的 Mac 上运行，你照常工作。`,
    download: '下载 Mac 版',
    github: '在 GitHub 上查看',
    requirements: `macOS ${site.minMacOS} 或更高版本 · Apple 芯片 · v${site.version}`,
    readings: [
      { label: '面板', value: '420 × 580 pt' },
      { label: '唤起', keys: shortcutKeys },
      { label: '服务', value: '仅监听本机' },
      { label: '语言', value: 'English · 简体中文' },
    ],
    scroll: '向下滚动',
  },
} satisfies Localized<HeroCopy>;
