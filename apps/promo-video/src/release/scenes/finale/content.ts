import type { Lang } from '../../../copy.ts';
import { WORDMARK } from '../../../kit/world/wordmark.ts';
import { releaseCopy } from '../../copy.ts';

/**
 * What the finale shows, per language: the wordmark the caret types after the mark, the tagline,
 * the address and the specs (from the film's narrative copy, so they cannot drift). The shortcut's
 * legends (⌘ ⇧ Space) are the keycaps' own and the same in both cuts.
 */
export interface FinaleContent {
  word: string;
  line: string;
  url: string;
  specs: string;
}

export const content = {
  en: {
    word: WORDMARK.text,
    line: releaseCopy.en.finale.line,
    url: releaseCopy.en.finale.url,
    specs: releaseCopy.en.finale.specs,
  },
  zh: {
    word: WORDMARK.text,
    line: releaseCopy.zh.finale.line,
    url: releaseCopy.zh.finale.url,
    specs: releaseCopy.zh.finale.specs,
  },
} as const satisfies Record<Lang, FinaleContent>;
