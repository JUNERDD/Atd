import { clamp01 } from '../../motion/ease.ts';

/**
 * Text that types or streams in, measured in units a reader sees appear: graphemes for typing (a
 * Chinese character, an emoji or an accented letter is one), and for streamed replies Latin words
 * with their trailing space and CJK characters one at a time, as a model's tokens land.
 */
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

/** Han, kana and hangul: scripts written without spaces, streamed a character at a time. */
const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿＀-￯　-〿]/u;

export function graphemes(text: string): string[] {
  return Array.from(graphemeSegmenter.segment(text), (part) => part.segment);
}

/** The first `progress` share of `text`, cut on a grapheme: what a typist has entered so far. */
export function typed(text: string, progress: number): string {
  const all = graphemes(text);
  return all.slice(0, Math.round(clamp01(progress) * all.length)).join('');
}

/**
 * `text` in streaming units. Spaces and punctuation join the unit before them, so a line never
 * starts with a stray comma and units concatenate back to the text exactly.
 */
export function streamUnits(text: string): string[] {
  const units: string[] = [];
  for (const { segment, isWordLike } of wordSegmenter.segment(text)) {
    if (CJK.test(segment)) {
      units.push(...graphemes(segment));
      continue;
    }
    const last = units.length - 1;
    if (!isWordLike && last >= 0) units[last] += segment;
    else units.push(segment);
  }
  return units;
}

/** How many units the soft reveal head spans: the last few fade in rather than snap. */
export const FADE_UNITS = 5;

/**
 * The opacity of unit `index` when `shown` units (fractional) have streamed: 1 well behind the
 * head, ramping to 0 across the last `FADE_UNITS`.
 */
export function unitAlpha(index: number, shown: number): number {
  return clamp01((shown - index) / FADE_UNITS);
}

/**
 * The reveal head for a stream of `total` units at `progress` (0 → 1): at 1 the last unit has
 * finished fading in, so the head runs `FADE_UNITS` past the end.
 */
export function revealHead(progress: number, total: number): number {
  return clamp01(progress) * (total + FADE_UNITS);
}

/** The shimmer band's place, -1 to 1, sweeping once per 1.6 s like the app's `Shimmer`. */
export function shimmerAt(time: number): number {
  const period = 1.6;
  return ((((time / period) % 1) + 1) % 1) * 2 - 1;
}

/** A spinner's angle in turns: one turn a second, as `animate-spin`. */
export function spinAt(time: number): number {
  return time % 1;
}
