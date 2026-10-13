/**
 * The note the commands run in, on the display in points: a window centred above the command
 * island's home, a heading and two lines of 17 pt text. Pure geometry (text widths come from the
 * film's measured faces, with a Node estimate).
 */
import type { Lang } from '../../../copy.ts';
import { lineWidth } from '../../../kit/product/island-layout.ts';
import type { Rect } from '../../../kit/world/points.ts';
import { content } from './content.ts';

export const NOTE: Rect = { x: 446, y: 500, width: 620, height: 262 };

export const TEXT = {
  x: NOTE.x + 32,
  size: 17,
  lineHeight: 26,
  heading: NOTE.y + 52 + 16,
  headingSize: 22,
  /** The two lines' tops: a paragraph apart, so the toolbar fits between them. */
  line1: NOTE.y + 52 + 60,
  line2: NOTE.y + 52 + 140,
} as const;

/** A text run's width in the note's face, in points. */
export const textWidth = (text: string) => lineWidth(text, TEXT.size, 400) - 1;

/** Line 2's box: the drag selects all of it, and the toolbar centres on it. */
export function line2Box(lang: Lang): Rect {
  return {
    x: TEXT.x,
    y: TEXT.line2,
    width: textWidth(content[lang].doors),
    height: TEXT.lineHeight,
  };
}

/** The inserted translation's box, right after line 2 (where the flood starts). */
export function insertBox(lang: Lang): Rect {
  const c = content[lang];
  return {
    x: TEXT.x + textWidth(c.doors),
    y: TEXT.line2,
    width: textWidth(c.doorsJapanese),
    height: TEXT.lineHeight,
  };
}
