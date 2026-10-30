/**
 * A run's material for its attached files (run-attachments.ts): their loaded text measured in
 * estimated tokens, split by the run's budget (tasks/run-budget.ts `materialBudget`) and cut on a
 * line boundary, and the markup that keeps file content apart from the app's own words in the
 * material (prompt-context.ts, folders/material.ts). The rest of a cut file stays in its resource,
 * which `read` returns line for line.
 */

/** The material's own elements: the whole of it, a file's text, a folder's overview. */
export const MATERIAL_TAGS = {
  run: 'run_material',
  file: 'file-material',
  folder: 'folder_overview',
} as const;

const OWN_TAG = new RegExp(`<(\\s*/?\\s*)(${Object.values(MATERIAL_TAGS).join('|')})`, 'gi');

/**
 * Text embedded in the material that cannot open or close one of its elements: the `<` of each
 * such tag becomes `&lt;`, so a file holding `</run_material>` cannot end the material early or
 * pass its own words off as the app's. All other text, line breaks included, stays as it is.
 */
export function materialSafe(text: string): string {
  return text.replace(OWN_TAG, '&lt;$1$2');
}

/** A name or path on one line of the material: `materialSafe`, with line breaks as spaces. */
export function materialLine(text: string): string {
  return materialSafe(text).replace(/[\r\n\u2028\u2029]+/g, ' ');
}

/**
 * Estimated tokens of `text`. Tokenizers give an ideograph, kana or hangul character about one
 * token and English text about four characters a token (Pi's estimate for all text); other
 * scripts (accented Latin, Cyrillic, Greek, Arabic, Indic, Thai) run about two characters a
 * token. So each UTF-16 unit counts a whole, a quarter or half a token; an emoji, two units, one.
 */
export function estimateTokens(text: string): number {
  let quarters = 0;
  for (let index = 0; index < text.length; index += 1)
    quarters += quartersOf(text.charCodeAt(index));
  return Math.ceil(quarters / 4);
}

/** A UTF-16 unit's estimated tokens, in quarters. */
function quartersOf(code: number): number {
  if (code < 0x80) return 1;
  return wide(code) ? 4 : 2;
}

/** Hangul jamo and syllables, kana, CJK ideographs, radicals, symbols and full-width forms. */
function wide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xa960 && code <= 0xa97f) ||
    (code >= 0xac00 && code <= 0xd7ff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xffef)
  );
}

/**
 * A file's loaded text as the material measures it, holding no more of it than the largest
 * share can use, so a long file is not kept whole while the others load.
 */
export interface MaterialSource {
  /** The text's start: all of it, or more than `perFile` tokens of it. */
  head: string;
  /** Whether `head` is the whole text. */
  complete: boolean;
  /**
   * Lines of the whole text as `read` counts them: split on `\n`, a final line break ending the
   * last line rather than starting another (file-loader/read-tool.ts).
   */
  lines: number;
  /** Estimated tokens of the whole text; `Infinity` when it holds more than `perFile`. */
  tokens: number;
}

/** UTF-16 units that always hold more than `tokens` estimated tokens. */
function headLength(tokens: number): number {
  return 4 * tokens + 1;
}

/** `text` measured for a budget whose largest share is `perFile` tokens. */
export function measureText(text: string, perFile: number): MaterialSource {
  const length = headLength(perFile);
  const complete = text.length <= length;
  return {
    head: complete ? text : text.slice(0, length),
    complete,
    lines: lineCount(text) - (text.endsWith('\n') ? 1 : 0),
    tokens: complete ? estimateTokens(text) : Infinity,
  };
}

/**
 * Valid UTF-8 text measured like `measureText` without decoding past what a share can use: a
 * UTF-16 unit takes at most three bytes, so that prefix holds the head, and lines are counted in
 * the bytes.
 */
export function measureUtf8(bytes: Uint8Array, perFile: number): MaterialSource {
  const length = headLength(perFile);
  const prefix = bytes.subarray(0, 3 * length);
  const text = Buffer.from(prefix.buffer, prefix.byteOffset, prefix.byteLength).toString('utf8');
  if (prefix.byteLength === bytes.byteLength) return measureText(text, perFile);
  // A final line break ends the last line, as `read` counts (`MaterialSource.lines`).
  let lines = bytes[bytes.byteLength - 1] === 0x0a ? 0 : 1;
  for (let index = bytes.indexOf(0x0a); index >= 0; index = bytes.indexOf(0x0a, index + 1))
    lines += 1;
  return { head: text.slice(0, length), complete: false, lines, tokens: Infinity };
}

/**
 * Each text's share of the budget, in estimated tokens, by a fair split: texts that fit their
 * even share keep all of it, and what they leave goes to the larger ones, none above `perFile`.
 */
export function shareBudget(
  tokens: readonly number[],
  budget: { total: number; perFile: number },
): number[] {
  const shares = tokens.map(() => 0);
  const order = tokens.map((size, index) => ({ size, index })).sort((a, b) => a.size - b.size);
  let remaining = budget.total;
  order.forEach(({ size, index }, position) => {
    const even = Math.floor(remaining / (order.length - position));
    const share = Math.min(size, budget.perFile, even);
    shares[index] = share;
    remaining -= share;
  });
  return shares;
}

/**
 * A file's material: its text inside a `file-material` element, cut on a line boundary to `limit`
 * estimated tokens, and after the element the app's note on where the text stops: with `read`, the
 * line `read` continues from; without it, that the rest is not included. Line numbers are
 * `read`'s: lines are split on `\n`. A first line longer than `limit` is cut inside it and the
 * note says so. The note stays outside the element, where file content cannot imitate it.
 */
export function materialText(source: MaterialSource, limit: number, read: boolean): string {
  const { head, lines } = source;
  if (source.complete && source.tokens <= limit) return fileElement(head);
  const fits = fittingLength(head, limit);
  const end = head.lastIndexOf('\n', fits);
  if (end < 0) {
    const kept = head.slice(0, keepSurrogates(head, fits));
    return `${fileElement(kept)}\n[Showing the first ${kept.length} characters of line 1 of ${lines}; the line is longer than the material holds. ${rest(read, 1)}]`;
  }
  const kept = head.slice(0, end);
  const shown = lineCount(kept);
  return `${fileElement(kept)}\n[Showing lines 1–${shown} of ${lines}. ${rest(read, shown + 1)}]`;
}

function fileElement(text: string): string {
  return `<${MATERIAL_TAGS.file}>\n${materialSafe(text)}\n</${MATERIAL_TAGS.file}>`;
}

/** Where the rest of a cut file is: in the resource from `line` on, or out of this run's reach. */
function rest(read: boolean, line: number): string {
  return read
    ? `The rest continues in the resource: read it from line ${line}.`
    : 'The rest of the file is not included, and this run has no read tool to load it: tell the user when the rest matters for the answer.';
}

/** How many leading UTF-16 units of `text` fit in `limit` estimated tokens. */
function fittingLength(text: string, limit: number): number {
  const room = 4 * limit;
  let quarters = 0;
  for (let index = 0; index < text.length; index += 1) {
    quarters += quartersOf(text.charCodeAt(index));
    if (quarters > room) return index;
  }
  return text.length;
}

function lineCount(text: string): number {
  let lines = 1;
  for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1))
    lines += 1;
  return lines;
}

/** `end`, moved back one when it would split a surrogate pair. */
function keepSurrogates(text: string, end: number): number {
  const code = text.charCodeAt(end - 1);
  return code >= 0xd800 && code <= 0xdbff ? end - 1 : end;
}
