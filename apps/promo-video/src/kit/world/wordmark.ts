/** The wordmark's set and measured width, shared by `Wordmark` and `Lockup`. */
import { textWidthEm } from './measure.ts';

/** The wordmark's set: Inter, a firm weight and tight tracking, like the chapter words. */
export const WORDMARK = { text: 'Atd', weight: 620, tracking: -0.035 } as const;

/** The wordmark's width in `em` (its font size), measured in the loaded face. */
export function wordmarkWidthEm(): number {
  return textWidthEm(WORDMARK.text, WORDMARK.weight, WORDMARK.tracking);
}
