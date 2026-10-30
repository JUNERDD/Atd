import { foldChar, foldLine } from './fuzzy-match.js';
import type { Eol, TextView } from './text-view.js';

/** A matched span as stored and in the LF view. */
export interface SpanText {
  readonly stored: string;
  readonly lf: string;
}

/** What one replacement writes, as stored and in the LF view. */
export interface Rendered {
  readonly stored: string;
  readonly lf: string;
}

/**
 * The stored characters on either side of a span once the edit is written: `before` is the last
 * character written before it, `after` the first one after it, undefined when another replacement
 * or the end of the file follows.
 */
export interface Neighbors {
  readonly before: string | undefined;
  readonly after: string | undefined;
}

/**
 * Renders an entry's newText (LF line breaks) for the span it replaces. Each line break takes the
 * ending of the line it keeps or takes the place of, else the file's dominant ending, so a mixed
 * or CR-only file keeps its endings. When the span matched only after folding, a line the edit
 * leaves unchanged keeps its stored text, and a changed line keeps the stored text of the words
 * around the change, so full-width punctuation, smart quotes or trailing spaces the model did not
 * reproduce stay as they are. 'collision' when the result would put a lone CR right before an LF
 * that follows the span, which would read as one CRLF line break instead of two.
 */
export function renderReplacement(
  view: TextView,
  span: SpanText,
  oldText: string,
  newText: string,
  fuzzy: boolean,
  around: Neighbors,
): Rendered | 'collision' {
  if (!fuzzy && view.uniform) {
    const eol = view.dominant;
    return { stored: eol === '\n' ? newText : newText.replaceAll('\n', eol), lf: newText };
  }
  const oldLines = oldText.split('\n');
  const spanLines = span.lf.split('\n');
  const newLines = newText.split('\n');
  const breaks: Eol[] = [...span.stored.matchAll(/\r\n|\r|\n/g)].map((match) =>
    match[0] === '\r\n' ? '\r\n' : match[0] === '\r' ? '\r' : '\n',
  );
  const pairs = pairLines(oldLines, newLines);
  let stored = '';
  let lf = '';
  let last = around.before;
  newLines.forEach((written, index) => {
    const { from, kept } = pairs[index] ?? { from: undefined, kept: false };
    const original = from === undefined ? undefined : spanLines[from];
    const old = from === undefined ? undefined : oldLines[from];
    let line = written;
    if (fuzzy && original !== undefined && old !== undefined)
      line = kept ? original : blend(original, old, written);
    stored += line;
    lf += line;
    if (line.length > 0) last = line.at(-1);
    if (index === newLines.length - 1) return;
    let eol = view.dominant;
    if (!view.uniform && from !== undefined) eol = breaks[from] ?? view.dominant;
    // A CR followed by an LF reads as one CRLF: this break takes CR as well.
    if (eol === '\n' && last === '\r') eol = '\r';
    stored += eol;
    lf += '\n';
    last = eol.at(-1);
  });
  if (last === '\r' && around.after === '\n') {
    if (stored.length === 0) return 'collision';
    stored = `${stored.slice(0, -1)}\n`;
  }
  return { stored, lf };
}

/** How one line of the new text relates to the old text it replaces. */
interface Pairing {
  /** The old line it keeps or takes the place of, if any. */
  readonly from: number | undefined;
  /** Whether it is that old line unchanged. */
  readonly kept: boolean;
}

/** Above this many cells, lines between the common head and tail pair by position instead. */
const LCS_CELLS = 250_000;

/**
 * Pairs the new lines with the old ones: lines both texts share (their longest common
 * subsequence) are kept, and between two kept lines the changed lines pair in order.
 */
function pairLines(before: readonly string[], after: readonly string[]): Pairing[] {
  const pairs: Pairing[] = after.map(() => ({ from: undefined, kept: false }));
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) {
    pairs[head] = { from: head, kept: true };
    head += 1;
  }
  let tail = 0;
  while (
    head + tail < before.length &&
    head + tail < after.length &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    pairs[after.length - 1 - tail] = { from: before.length - 1 - tail, kept: true };
    tail += 1;
  }
  const rows = before.length - tail - head;
  const columns = after.length - tail - head;
  if (rows === 0 || columns === 0) return pairs;
  if (rows * columns > LCS_CELLS) {
    for (let index = 0; index < Math.min(rows, columns); index++)
      pairs[head + index] = { from: head + index, kept: false };
    return pairs;
  }
  const width = columns + 1;
  const table = new Uint32Array((rows + 1) * width);
  const cell = (row: number, column: number) => table[row * width + column] ?? 0;
  for (let row = rows - 1; row >= 0; row--)
    for (let column = columns - 1; column >= 0; column--)
      table[row * width + column] =
        before[head + row] === after[head + column]
          ? cell(row + 1, column + 1) + 1
          : Math.max(cell(row + 1, column), cell(row, column + 1));
  let gapOld: number[] = [];
  let gapNew: number[] = [];
  const flush = () => {
    gapNew.forEach((column, index) => {
      const from = gapOld[index];
      if (from !== undefined) pairs[column] = { from, kept: false };
    });
    gapOld = [];
    gapNew = [];
  };
  let row = 0;
  let column = 0;
  while (row < rows && column < columns) {
    if (before[head + row] === after[head + column]) {
      flush();
      pairs[head + column] = { from: head + row, kept: true };
      row += 1;
      column += 1;
    } else if (cell(row + 1, column) >= cell(row, column + 1)) gapOld.push(head + row++);
    else gapNew.push(head + column++);
  }
  while (row < rows) gapOld.push(head + row++);
  while (column < columns) gapNew.push(head + column++);
  flush();
  return pairs;
}

const WORD = /^[\p{L}\p{N}\p{M}_]/u;
const MARK = /^\p{M}/u;

/**
 * A changed line of a folded match: the model's new line, with the stored text kept for the parts
 * the model's old and new lines share before and after the change. The kept parts end on word
 * boundaries, so a changed word or number is written whole as the model wrote it.
 */
function blend(stored: string, oldLine: string, newLine: string): string {
  if (foldLine(stored) !== foldLine(oldLine)) return newLine;
  const shorter = Math.min(oldLine.length, newLine.length);
  let head = 0;
  while (head < shorter && oldLine[head] === newLine[head]) head += 1;
  let tail = 0;
  while (
    tail < shorter - head &&
    oldLine[oldLine.length - 1 - tail] === newLine[newLine.length - 1 - tail]
  )
    tail += 1;
  while (head > 0 && (joins(oldLine, head) || joins(newLine, head))) head -= 1;
  while (
    tail > 0 &&
    (joins(oldLine, oldLine.length - tail) || joins(newLine, newLine.length - tail))
  )
    tail -= 1;
  const from = storedBoundary(stored, foldedLength(oldLine.slice(0, head)));
  const to =
    tail === 0
      ? stored.length
      : storedBoundary(stored, foldedLength(oldLine.slice(0, oldLine.length - tail)));
  if (from === -1 || to === -1 || from > to) return newLine;
  const middle = newLine.slice(head, newLine.length - tail);
  return stored.slice(0, from) + middle + (tail === 0 ? '' : stored.slice(to));
}

/** Whether a cut at `at` would split a word, a surrogate pair or a character from its marks. */
function joins(text: string, at: number): boolean {
  if (at <= 0 || at >= text.length) return false;
  const previous = text.charCodeAt(at - 1);
  if (previous >= 0xd800 && previous <= 0xdbff) return true;
  const rest = text.slice(at);
  if (MARK.test(rest)) return true;
  const low = previous >= 0xdc00 && previous <= 0xdfff;
  return WORD.test(text.slice(at - (low ? 2 : 1), at)) && WORD.test(rest);
}

function foldedLength(text: string): number {
  let length = 0;
  for (const char of text) length += foldChar(char).length;
  return length;
}

/** The offset in `stored` whose folded prefix is `length` long, or -1 inside one character. */
function storedBoundary(stored: string, length: number): number {
  let folded = 0;
  let at = 0;
  for (const char of stored) {
    if (folded >= length) break;
    folded += foldChar(char).length;
    at += char.length;
  }
  return folded === length ? at : -1;
}
