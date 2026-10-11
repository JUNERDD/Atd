import type { Lang } from '../../../copy.ts';
import { releaseCopy } from '../../copy.ts';

/**
 * What the open shows, per language. There is no product UI in this section: a hurried line is
 * typed, selected and rewritten in place (the whole 0.8 idea without an interface), then the title
 * and its line. The title strings come from the film's narrative copy, so they cannot drift.
 */
export interface OpenContent {
  /** The line as a person dashes it off: lowercase, a typo, abbreviations. */
  rough: string;
  /** The same request as Atd writes it back, in place. */
  polished: string;
  title: string;
  titleLine: string;
}

export const content = {
  en: {
    rough: 'hey can u send teh deck by thurs',
    polished: 'Could you send the deck by Thursday?',
    title: releaseCopy.en.title,
    titleLine: releaseCopy.en.titleLine,
  },
  zh: {
    rough: '那个ppt周四前能发我不',
    polished: '能在周四前把演示文稿发给我吗？',
    title: releaseCopy.zh.title,
    titleLine: releaseCopy.zh.titleLine,
  },
} as const satisfies Record<Lang, OpenContent>;
