/**
 * The text an edit works on: a file's stored text (without its BOM) and its LF view, in which every
 * CRLF and lone CR reads as one LF. Matching, line numbers, snippets and the transcript diff use the
 * LF view, as pi's edit does; replacements map back to the stored text, so every byte outside a
 * replaced span, line endings included, stays as it was.
 */

/** A line ending as stored. */
export type Eol = '\n' | '\r\n' | '\r';

export interface TextView {
  /** The stored text, without its BOM. */
  readonly text: string;
  /** `text` with each line ending as one LF. */
  readonly lf: string;
  /** Offsets in `lf` of the LFs that stand for a CRLF in `text`, ascending. */
  readonly crlf: readonly number[];
  /**
   * The ending a new line takes when no line it replaces gives one: the most common ending, the one
   * the file shows first on a tie, LF in a file without line breaks.
   */
  readonly dominant: Eol;
  /** Whether `text` uses at most one kind of line ending, so every line break takes `dominant`. */
  readonly uniform: boolean;
}

const LINE_BREAK = /\r\n|\r|\n/g;

export function textView(text: string): TextView {
  if (!text.includes('\r')) return { text, lf: text, crlf: [], dominant: '\n', uniform: true };
  const parts: string[] = [];
  const crlf: number[] = [];
  // Insertion order is first appearance, so a tie keeps the ending the file shows first.
  const counts = new Map<Eol, number>();
  let from = 0;
  let length = 0;
  for (const match of text.matchAll(LINE_BREAK)) {
    const eol: Eol = match[0] === '\r\n' ? '\r\n' : match[0] === '\r' ? '\r' : '\n';
    counts.set(eol, (counts.get(eol) ?? 0) + 1);
    if (eol === '\n') continue;
    length += match.index - from;
    parts.push(text.slice(from, match.index), '\n');
    if (eol === '\r\n') crlf.push(length);
    length += 1;
    from = match.index + eol.length;
  }
  parts.push(text.slice(from));
  let dominant: Eol = '\n';
  let most = 0;
  for (const [eol, count] of counts) {
    if (count > most) {
      dominant = eol;
      most = count;
    }
  }
  return { text, lf: parts.join(''), crlf, dominant, uniform: counts.size <= 1 };
}

/** The offset in `view.text` of the boundary at `at` in `view.lf`. */
export function storedOffset(view: TextView, at: number): number {
  let low = 0;
  let high = view.crlf.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((view.crlf[middle] ?? at) < at) low = middle + 1;
    else high = middle;
  }
  return at + low;
}

/** A 1-based, inclusive range of lines. */
export interface LineRange {
  readonly first: number;
  readonly last: number;
}

/** The start offset of every line of an LF text; a text has one more line than it has LFs. */
export function lineStarts(lf: string): Int32Array {
  let count = 1;
  for (let at = lf.indexOf('\n'); at !== -1; at = lf.indexOf('\n', at + 1)) count += 1;
  const starts = new Int32Array(count);
  let line = 1;
  for (let at = lf.indexOf('\n'); at !== -1; at = lf.indexOf('\n', at + 1)) starts[line++] = at + 1;
  return starts;
}

/** The 1-based line of the text `starts` indexes that holds offset `at`. */
export function lineAt(starts: Int32Array, at: number): number {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((starts[middle] ?? 0) <= at) low = middle + 1;
    else high = middle;
  }
  return Math.max(1, low);
}

/** Lines `first` to `last` (1-based, inclusive) of an LF text, without the LF that ends `last`. */
export function linesOf(lf: string, starts: Int32Array, first: number, last: number): string {
  const next = starts[last];
  return lf.slice(starts[first - 1] ?? lf.length, next === undefined ? lf.length : next - 1);
}
