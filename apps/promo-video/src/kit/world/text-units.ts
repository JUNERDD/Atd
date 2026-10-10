/**
 * Splits a line into the pieces that move together: words in English, and in Chinese the word
 * groups the browser's segmenter finds (never single strokes of a phrase, never spaces). Trailing
 * punctuation stays with the piece before it, so no line starts with it.
 */
export interface TextUnit {
  text: string;
  /** Whitespace after the piece, kept outside it so lines can break there. */
  space: string;
}

const segmenters = new Map<string, Intl.Segmenter>();

/** `lang` is a BCP 47 tag or the film's `en` / `zh`. */
export function textUnits(text: string, lang: string): TextUnit[] {
  const locale = lang.startsWith('zh') ? 'zh-CN' : 'en';
  let segmenter = segmenters.get(locale);
  if (!segmenter) {
    segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
    segmenters.set(locale, segmenter);
  }
  const units: TextUnit[] = [];
  for (const { segment, isWordLike } of segmenter.segment(text)) {
    const last = units[units.length - 1];
    if (/^\s+$/u.test(segment)) {
      if (last) last.space += segment;
    } else if (!isWordLike && last && last.space === '') last.text += segment;
    else units.push({ text: segment, space: '' });
  }
  return units;
}

const graphemeSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** A string's user-perceived characters (letters for a per-letter animation). */
export function graphemes(text: string): string[] {
  return Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment);
}

/** The lang attribute for the film's language codes. */
export function langTag(lang: string): string {
  return lang === 'zh' ? 'zh-CN' : lang;
}
