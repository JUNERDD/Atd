import { site } from '../../content/site';
import type { Localized } from '../../i18n/lang';

interface HeroCopy {
  /** The page's heading, for assistive tech and search: the lit display is the visible title. */
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
    title: 'Atd: anything, anytime, anywhere, to do. A quiet AI agent for your Mac.',
    words,
  },
  zh: {
    title: 'Atd：任何事、任何时间、任何地点，都能交给它。安静待命的 Mac AI 智能体。',
    words,
  },
} satisfies Localized<HeroCopy>;
