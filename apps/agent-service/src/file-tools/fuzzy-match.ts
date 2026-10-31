import { lineAt } from './text-view.js';

/**
 * pi's fuzzy edit matching, made reversible. pi retries a missed oldText against the file
 * normalized with NFKC, each line's trailing whitespace removed, and smart quotes, Unicode dashes
 * and special spaces folded to ASCII (`normalizeForFuzzyMatch` in pi-coding-agent
 * dist/core/tools/edit-diff.js), then rewrites every touched line from that normalized text. Here
 * the same folds apply one code point at a time with NFKD, which equates the same strings NFKC
 * does, so every folded character names the stored character it came from and a match maps back
 * to exact offsets in the file: only the matched span is replaced.
 */

const SINGLE_QUOTES = /[\u2018\u2019\u201A\u201B]/g;
const DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F]/g;
const DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g;
const SPACES = /[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g;
const NON_ASCII = /[^\p{ASCII}]/u;

/** Folded forms of the non-ASCII characters met so far, emptied when it grows large. */
const folds = new Map<string, string>();
const FOLD_CACHE_SIZE = 65_536;

/** One code point folded for matching; never empty. */
export function foldChar(char: string): string {
  if (char.charCodeAt(0) < 0x80) return char;
  let folded = folds.get(char);
  if (folded === undefined) {
    folded = char
      .normalize('NFKD')
      .replace(SINGLE_QUOTES, "'")
      .replace(DOUBLE_QUOTES, '"')
      .replace(DASHES, '-')
      .replace(SPACES, ' ');
    if (folds.size >= FOLD_CACHE_SIZE) folds.clear();
    folds.set(char, folded);
  }
  return folded;
}

/** One line folded for matching, without its trailing whitespace. */
export function foldLine(line: string): string {
  if (!NON_ASCII.test(line)) return line.trimEnd();
  let folded = '';
  for (const char of line) folded += foldChar(char);
  return folded.trimEnd();
}

/** An LF text folded line by line. */
export function foldText(text: string): string {
  return text.split('\n').map(foldLine).join('\n');
}

/** The folded form of a file's LF view, line by line, with what maps it back. */
export interface FuzzyView {
  readonly lf: string;
  /** Start offset of each line in `lf`. */
  readonly lfStarts: Int32Array;
  /** Each line of `lf`, folded. */
  readonly lines: readonly string[];
  /** `lines` joined by LF: what folded oldText is searched in. */
  readonly folded: string;
  /** Start offset of each line in `folded`. */
  readonly foldedStarts: Int32Array;
}

/** Folds a file once per edit call, and only after some oldText missed exactly. */
export function fuzzyView(lf: string, lfStarts: Int32Array): FuzzyView {
  const lines = lf.split('\n').map(foldLine);
  const foldedStarts = new Int32Array(lines.length);
  let at = 0;
  lines.forEach((line, index) => {
    foldedStarts[index] = at;
    at += line.length + 1;
  });
  return { lf, lfStarts, lines, folded: lines.join('\n'), foldedStarts };
}

/** A region of the file as offsets in its LF view. */
export interface Occurrence {
  readonly start: number;
  readonly end: number;
}

/**
 * Where a folded needle occurs in the view, as LF offsets. Overlapping occurrences count, since
 * each is a region the edit could mean; one that would split a stored character (`e` inside a
 * composed `é`) is no match. Returns at most `limit` + 1, so a caller can tell there are more.
 */
export function fuzzyOccurrences(view: FuzzyView, needle: string, limit: number): Occurrence[] {
  const found: Occurrence[] = [];
  if (needle.length === 0) return found;
  const starts = new Mapper(view, 'start');
  const ends = new Mapper(view, 'end');
  for (
    let at = view.folded.indexOf(needle);
    at !== -1 && found.length <= limit;
    at = view.folded.indexOf(needle, at + 1)
  ) {
    const start = starts.map(at);
    const end = ends.map(at + needle.length);
    if (start !== -1 && end !== -1 && start < end) found.push({ start, end });
  }
  return found;
}

/**
 * Maps folded offsets of one side of the matches to LF offsets. A match starts as late and ends as
 * early as its folded text allows, so the trailing whitespace folding dropped stays outside it.
 * Offsets arrive in ascending order, so each line is walked at most once per side.
 */
class Mapper {
  readonly #view: FuzzyView;
  readonly #side: 'start' | 'end';
  #line = -1;
  #lf = 0;
  #folded = 0;

  constructor(view: FuzzyView, side: 'start' | 'end') {
    this.#view = view;
    this.#side = side;
  }

  /** The LF offset of folded offset `at`, or -1 when it falls inside one character's fold. */
  map(at: number): number {
    const view = this.#view;
    const line = lineAt(view.foldedStarts, at) - 1;
    const foldedStart = view.foldedStarts[line] ?? 0;
    const lfStart = view.lfStarts[line] ?? 0;
    if (at === foldedStart) return lfStart;
    if (this.#side === 'start' && at === foldedStart + (view.lines[line]?.length ?? 0)) {
      const next = view.lfStarts[line + 1];
      return next === undefined ? view.lf.length : next - 1;
    }
    if (line !== this.#line || at < this.#folded) {
      this.#line = line;
      this.#lf = lfStart;
      this.#folded = foldedStart;
    }
    while (this.#folded < at) {
      const code = view.lf.codePointAt(this.#lf) ?? 0;
      const width = code > 0xffff ? 2 : 1;
      const size = foldChar(view.lf.slice(this.#lf, this.#lf + width)).length;
      if (this.#folded + size > at) return -1;
      this.#folded += size;
      this.#lf += width;
    }
    return this.#lf;
  }
}
