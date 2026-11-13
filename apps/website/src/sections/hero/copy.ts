import { site } from '../../content/site';
import type { Localized } from '../../i18n/lang';

interface HeroCopy {
  /** The page's primary heading rendered under the LED display, aligning search & visible copy. */
  title: string;
  /**
   * The words the display changes between, starting with the name. `|` marks where a word may
   * break onto two lines on narrow screens. The display is drawn, so these stay in English: they
   * spell out the name.
   */
  words: readonly string[];
}

const words = [site.name, 'Any|thing', 'Any|time', 'Any|where'];

export const heroCopy = {
  en: {
    title: 'Atd — Open-source AI desktop agent for macOS',
    words,
  },
  zh: {
    title: 'Atd — 开源 macOS AI 桌面智能体',
    words,
  },
} satisfies Localized<HeroCopy>;
