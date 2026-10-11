/**
 * Where the finale's lines sit and how they are set, in frame px. `finale.css` places each line's
 * anchor at the same points (keep them in step). The lockup and the tagline move as one block:
 * until Return the lockup is the only line and sits on the frame's center (the caret's entry
 * point), then the block glides up by `BLOCK_RISE` to make room, as a vertically centered document
 * does when a line is added.
 */
import type { Lang } from '../../../copy.ts';
import { WORDMARK } from '../../../kit/world/wordmark.ts';
import type { TypeSet } from '../open/centered-type.ts';

export const CENTER = { x: 960, y: 540 } as const;
/** The lines' resting centers (the lockup's and the tagline's after the block's glide). */
export const LOCKUP = { x: 960, y: 400 } as const;
export const LINE = { x: 960, y: 610 } as const;
export const KEYS = { x: 960, y: 740 } as const;
export const ADDRESS = { x: 960, y: 905 } as const;
/** How far the block rises on Return: from the lockup on the center to its resting place. */
export const BLOCK_RISE = CENTER.y - LOCKUP.y;

/** The wordmark as the brand sets it; the mark's box and gap in the brand lockup's proportions. */
export const WORD: TypeSet = { size: 196, weight: WORDMARK.weight, tracking: WORDMARK.tracking };
export const MARK = Math.round(WORD.size * 1.19);
export const MARK_GAP = Math.round(WORD.size * 0.24);

/** The tagline set firm but lighter than the wordmark; the address at a reading size. */
export const SETS = {
  en: {
    line: { size: 64, weight: 640, tracking: -0.022 },
    url: { size: 40, weight: 600, tracking: -0.012 },
  },
  zh: {
    line: { size: 64, weight: 700, tracking: 0.02 },
    url: { size: 40, weight: 600, tracking: -0.012 },
  },
} as const satisfies Record<Lang, Record<'line' | 'url', TypeSet>>;

/**
 * The baseline's depth below a typed line's anchor, in em: the row (line-height 1.2) is centered
 * on the anchor, and Inter's ascent puts the baseline 0.963 em below the row's top.
 */
const BASELINE_EM = 0.963 - 0.6;

/**
 * Where the lockup line's own caret stands while the line is still empty and on the center, as
 * `Caret` takes it (top-left and height, frame px): inline it is 1.1 em tall, 0.03 em right of
 * the anchor and reaches 0.25 em below the baseline (`centered-type.css`). The entry caret grows
 * into exactly this before the line's caret takes over.
 */
export function entryCaretTarget(): { x: number; y: number; height: number } {
  const em = WORD.size;
  const height = 1.1 * em;
  return {
    x: CENTER.x + 0.03 * em,
    y: CENTER.y + (BASELINE_EM + 0.25) * em - height,
    height,
  };
}
