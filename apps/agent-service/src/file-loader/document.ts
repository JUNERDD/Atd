import type { ExtractOutcome } from './jobs.js';

/** Most characters a file's loaded text keeps; the rest is cut with a note saying so. */
export const MAX_TEXT_CHARS = 8_000_000;

/**
 * Longest line in flat text (Spotlight's): longer lines are wrapped, since `read` pages by lines
 * and stops at a line longer than its byte limit.
 */
const FLAT_LINE_CHARS = 1000;

export interface DocumentParts {
  label: string;
  /** Counts that size the document, such as `5 pages`. */
  facts: readonly string[];
  /** What the text holds and leaves out. */
  included: string;
  /** Lines that warn about what was not read, each shown in brackets under the header. */
  warnings?: readonly string[];
  body: string;
}

/**
 * A document's loaded text: `[<label> · <facts> · <included>]`, a bracketed line per warning, a
 * blank line and the body, cut at `MAX_TEXT_CHARS`. The product skill `file-loader` teaches the
 * agent this shape.
 */
export function documentText({
  label,
  facts,
  included,
  warnings = [],
  body,
}: DocumentParts): string {
  const header = `[${[label, ...facts, included].join(' · ')}]`;
  return [header, ...warnings.map((warning) => `[${warning}]`), '', capText(body)].join('\n');
}

/** `text` cut on a line boundary once it passes `max` characters, ending in a note that says so. */
export function capText(text: string, max = MAX_TEXT_CHARS): string {
  if (text.length <= max) return text;
  const end = text.lastIndexOf('\n', max);
  const kept = text.slice(0, end > 0 ? end : max);
  return `${kept}\n[The rest is not included: the text is longer than ${max.toLocaleString('en-US')} characters.]`;
}

/** `1 page`, `1,204 pages`. */
export function counted(count: number, noun: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? noun : `${noun}s`}`;
}

/** Han and kana characters each count as a word, as word processors count them. */
const WORDS =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|(?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[\p{L}\p{N}])+/u;

/** A text's word count, such as `1,204 words`. */
export function wordCount(text: string): string {
  const pattern = new RegExp(WORDS.source, 'gu');
  let words = 0;
  while (pattern.exec(text)) words += 1;
  return counted(words, 'word');
}

/** Plain text another tool extracted, with its header, its long lines wrapped. */
export function flatDocument(
  text: string,
  label: string,
  included: string,
  warnings: readonly string[],
): ExtractOutcome {
  const body = wrapLines(text.replace(/\r\n?/g, '\n').trim(), FLAT_LINE_CHARS);
  if (!body) return { status: 'failed', reason: 'macOS found no text in it' };
  return {
    status: 'text',
    text: documentText({ label, facts: [wordCount(body)], included, warnings, body }),
  };
}

/** Lines longer than `width` broken at their last space before it, or at `width` without one. */
function wrapLines(text: string, width: number): string {
  return text
    .split('\n')
    .flatMap((line) => {
      const parts: string[] = [];
      let rest = line;
      while (rest.length > width) {
        const space = rest.lastIndexOf(' ', width);
        let cut = space > width / 2 ? space : width;
        // Keep a surrogate pair together.
        if (/[\ud800-\udbff]/.test(rest.charAt(cut - 1))) cut -= 1;
        parts.push(rest.slice(0, cut).trimEnd());
        rest = rest.slice(cut).trimStart();
      }
      parts.push(rest);
      return parts;
    })
    .join('\n');
}
