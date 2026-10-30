import { OCCURRENCE_LIMIT } from './matching.js';
import { linesOf, type LineRange } from './text-view.js';

/**
 * What the model reads back from an edit call. A success names the edited lines and shows them as
 * they now read, so the model need not read the file again to check the edit; a failure says what
 * to change in the call and shows the file's current lines where that helps. Text from the file
 * appears raw under a header naming its lines, without line-number prefixes, as `read` shows it;
 * every explanatory line comes before the first excerpt, so an excerpt runs to the next header or
 * to the end.
 */

/** A file's LF view with its line starts (text-view.ts). */
export interface FileLines {
  readonly lf: string;
  readonly starts: Int32Array;
}

/** The lines one replacement changed, in the edited file. */
export interface Change extends LineRange {
  readonly entry: number;
  readonly fuzzy: boolean;
}

/** Why an edit call changed nothing; line numbers are the file's before the call. */
export type Problem =
  | { readonly kind: 'empty'; readonly entry: number }
  | {
      readonly kind: 'missing';
      readonly entry: number;
      readonly replaceAll: boolean;
      readonly emptyFile: boolean;
      /** Where the entry's newText already stands. */
      readonly present: LineRange | undefined;
      /** The lines most like its oldText. */
      readonly closest: LineRange | undefined;
    }
  | {
      readonly kind: 'ambiguous';
      readonly entry: number;
      readonly fuzzy: boolean;
      readonly lines: readonly number[];
      readonly capped: boolean;
    }
  | {
      readonly kind: 'overlap';
      readonly entries: readonly [number, number];
      readonly ranges: readonly [LineRange, LineRange];
    }
  | { readonly kind: 'collision'; readonly entry: number; readonly line: number }
  | { readonly kind: 'unchanged' };

const FOLDED = 'whitespace, quotes, dashes or full-width characters';
const IGNORING = 'ignoring differences in whitespace, quotes, dashes and full-width characters';
/** Unchanged lines shown around each change in a success snippet. */
const SNIPPET_CONTEXT = 2;
/** File lines a success shows at most, and the characters they may take. */
const SNIPPET_LINES = 40;
const SNIPPET_CHARS = 8000;
/** Unchanged lines shown around a failure's candidate region, and its size limits. */
const EXCERPT_CONTEXT = 3;
const EXCERPT_LINES = 24;
const EXCERPT_CHARS = 4000;
/** Failures of one call that get an excerpt. */
const EXCERPTS = 3;
/** Line numbers and ranges a list names before summing up the rest. */
const LISTED = 8;

interface Block extends LineRange {
  readonly text: string;
}

/** The result of an edit call that wrote the file. */
export function editedText(
  path: string,
  entryCount: number,
  replacements: number,
  changes: readonly Change[],
  unchangedEntries: readonly number[],
  after: FileLines,
): string {
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  for (const change of changes) {
    first = Math.min(first, change.first);
    last = Math.max(last, change.last);
  }
  const counted = `${entryCount} edit${entryCount === 1 ? '' : 's'}`;
  const extra = replacements === entryCount ? '' : ` (${replacements} replacements)`;
  const lines = [`Edited ${path}: ${counted}${extra}, ${range({ first, last })}.`];
  // A folded match is never replaceAll, so each such entry has one change.
  const folded = changes.filter((change) => change.fuzzy);
  if (folded.length === 1 && folded[0] !== undefined) {
    const subject = entryCount === 1 ? 'oldText' : `edits[${folded[0].entry}]`;
    lines.push(
      `${subject} matched after normalizing ${FOLDED} at line ${folded[0].first}; check the result below.`,
    );
  } else if (folded.length > 1) {
    const listed = list(folded.map((change) => `edits[${change.entry}] (line ${change.first})`));
    lines.push(`${listed} matched after normalizing ${FOLDED}; check the result below.`);
  }
  if (unchangedEntries.length > 0) {
    const listed = list(unchangedEntries.map((entry) => `edits[${entry}]`));
    const one = unchangedEntries.length === 1;
    lines.push(
      `${listed} changed nothing: ${one ? 'its' : 'their'} newText is identical to the text ${one ? 'it replaces' : 'they replace'}.`,
    );
  }
  const { blocks, hidden } = snippet(changes, after);
  if (hidden.length > 0)
    lines.push(
      `${capitalized(ranges(hidden))} ${hidden.length === 1 && hidden[0]?.first === hidden[0]?.last ? 'is' : 'are'} not shown.`,
    );
  for (const block of blocks) lines.push(heading(block, 'now'), block.text);
  return lines.join('\n');
}

/** The changed lines with their context, within the snippet's line and character budget. */
function snippet(
  changes: readonly Change[],
  after: FileLines,
): { blocks: Block[]; hidden: LineRange[] } {
  const total = after.starts.length;
  const regions: LineRange[] = [];
  for (const change of changes) {
    const first = Math.max(1, change.first - SNIPPET_CONTEXT);
    const last = Math.min(total, change.last + SNIPPET_CONTEXT);
    const previous = regions.at(-1);
    // One line between two regions costs no more than the heading a second block needs.
    if (previous !== undefined && first <= previous.last + 2)
      regions[regions.length - 1] = { first: previous.first, last: Math.max(previous.last, last) };
    else regions.push({ first, last });
  }
  const blocks: Block[] = [];
  const hidden: LineRange[] = [];
  let lines = SNIPPET_LINES;
  let chars = SNIPPET_CHARS;
  const show = (region: LineRange) => {
    const text = linesOf(after.lf, after.starts, region.first, region.last);
    if (text.length > chars) {
      hide(region);
      return;
    }
    blocks.push({ ...region, text });
    lines -= region.last - region.first + 1;
    chars -= text.length;
  };
  const hide = (region: LineRange) => {
    const previous = hidden.at(-1);
    if (previous !== undefined && region.first <= previous.last + 1)
      hidden[hidden.length - 1] = { first: previous.first, last: region.last };
    else hidden.push(region);
  };
  for (const region of regions) {
    const size = region.last - region.first + 1;
    if (size <= lines) show(region);
    else if (lines < 2 * (SNIPPET_CONTEXT + 1)) hide(region);
    else {
      // Too long for what is left: its start and end, where a misplaced edit shows.
      const head = Math.ceil(lines / 2);
      const tail = lines - head;
      show({ first: region.first, last: region.first + head - 1 });
      hide({ first: region.first + head, last: region.last - tail });
      show({ first: region.last - tail + 1, last: region.last });
    }
  }
  return { blocks, hidden };
}

/** The message of an edit call that changed nothing. */
export function failureText(
  path: string,
  entryCount: number,
  problems: readonly Problem[],
  before: FileLines,
): string {
  const [only] = problems;
  if (only?.kind === 'unchanged') {
    const what = entryCount === 1 ? 'newText is' : "every edit's newText is";
    return `No changes made to ${path}: ${what} identical to the text it replaces.`;
  }
  if (entryCount === 1 && problems.length === 1 && only !== undefined) {
    const shown = excerpt(only, before);
    const text = sentence(only, ` in ${path}`, path);
    return shown === undefined ? text : [text, heading(shown, 'currently'), shown.text].join('\n');
  }
  const one = problems.length === 1 && only?.kind !== 'overlap';
  const lines = [
    `No changes made to ${path}. Fix ${one ? 'this edit' : 'these edits'} and send the call again with all of its edits:`,
  ];
  for (const problem of problems)
    lines.push(`- ${subject(problem)}: ${sentence(problem, '', path)}`);
  let excerpts = 0;
  for (const problem of problems) {
    const shown = excerpts < EXCERPTS ? excerpt(problem, before) : undefined;
    if (shown === undefined) continue;
    excerpts += 1;
    lines.push(`For ${subject(problem)}, ${heading(shown, 'currently').toLowerCase()}`, shown.text);
  }
  return lines.join('\n');
}

function subject(problem: Problem): string {
  switch (problem.kind) {
    case 'overlap':
      return `edits[${problem.entries[0]}] and edits[${problem.entries[1]}]`;
    case 'unchanged':
      return 'the edits';
    case 'empty':
    case 'missing':
    case 'ambiguous':
    case 'collision':
      return `edits[${problem.entry}]`;
  }
}

/** One problem in words; `where` names the file in a single-edit call, `path` when it is empty. */
function sentence(problem: Problem, where: string, path: string): string {
  const single = where !== '';
  switch (problem.kind) {
    case 'empty':
      return single
        ? 'oldText is empty. Give the exact text to replace; use write to create or overwrite a whole file.'
        : 'oldText is empty; give the exact text to replace.';
    case 'missing': {
      if (problem.emptyFile)
        return `${single ? path : 'The file'} is empty, so there is no text to replace; use write to give it content.`;
      const missed = single ? `Could not find oldText${where}` : 'oldText was not found';
      const how = problem.replaceAll
        ? '; replaceAll matches exact text only'
        : `, even ${IGNORING}`;
      const { present, closest } = problem;
      const applied =
        present === undefined
          ? ''
          : ` Its newText is already present at ${range(present)}, so the edit may already be applied.`;
      if (closest !== undefined && (present === undefined || !near(closest, present)))
        return `${missed}${how}. The most similar text is at ${range(closest)}; copy oldText from it exactly, whitespace included.${applied}`;
      if (present !== undefined) return `${missed}${how}.${applied}`;
      return `${missed}${how}, and nothing similar was found. Read the file to see its current text.`;
    }
    case 'ambiguous': {
      const lines = lineList(problem.lines, problem.capped);
      const count = problem.capped ? `more than ${OCCURRENCE_LIMIT}` : `${problem.lines.length}`;
      if (problem.fuzzy)
        return `oldText is not${where || ' in the file'} exactly, and ${IGNORING} it matches ${count} places (${lines}). Add surrounding lines to make it unique.`;
      return `oldText occurs ${count} times${where} (${lines}). Add surrounding lines to make it unique, or set replaceAll: true to change every occurrence.`;
    }
    case 'overlap': {
      const [a, b] = problem.ranges;
      const where =
        a.first === b.first && a.last === b.last
          ? `both at ${range(a)}`
          : `${range(a)} and ${range(b)}`;
      return `they overlap (${where}); merge them into one edit or target disjoint regions.`;
    }
    case 'collision':
      return `${single ? 'The' : 'the'} replacement would put a CR line ending right before the LF at line ${problem.line}, which reads as one line break; include that line break in oldText and newText.`;
    case 'unchanged':
      return 'every newText is identical to the text it replaces.';
  }
}

/**
 * The current lines a problem points at, with some context, when they fit: the text most like the
 * missed oldText, or its newText when that stands at the same place.
 */
function excerpt(problem: Problem, before: FileLines): Block | undefined {
  if (problem.kind !== 'missing') return undefined;
  const { present, closest } = problem;
  const target =
    closest !== undefined && (present === undefined || !near(closest, present)) ? closest : present;
  if (target === undefined) return undefined;
  const total = before.starts.length;
  const first = Math.max(1, target.first - EXCERPT_CONTEXT);
  const last = Math.min(total, target.last + EXCERPT_CONTEXT, first + EXCERPT_LINES - 1);
  for (const lines of [
    { first, last },
    { first: target.first, last: Math.min(target.last, last) },
  ]) {
    const text = linesOf(before.lf, before.starts, lines.first, lines.last);
    if (text.length <= EXCERPT_CHARS) return { ...lines, text };
  }
  return undefined;
}

/** Whether two ranges overlap or lie within an excerpt's context of each other. */
function near(a: LineRange, b: LineRange): boolean {
  return a.first <= b.last + EXCERPT_CONTEXT && b.first <= a.last + EXCERPT_CONTEXT;
}

function heading(lines: LineRange, when: 'now' | 'currently'): string {
  const one = lines.first === lines.last;
  const span = one ? `Line ${lines.first}` : `Lines ${lines.first}–${lines.last}`;
  return `${span} ${when} read${one ? 's' : ''}:`;
}

function range(lines: LineRange): string {
  return lines.first === lines.last ? `line ${lines.first}` : `lines ${lines.first}–${lines.last}`;
}

/** `lines 3–5, 9 and 12–14`. */
function ranges(lines: readonly LineRange[]): string {
  const plural = lines.length > 1 || lines[0]?.first !== lines[0]?.last;
  const named = lines.map((item) => range(item).replace(/^lines? /, ''));
  return `${plural ? 'lines' : 'line'} ${list(named)}`;
}

/** `line 4` or `lines 4, 18 and 30`, each line once; `capped` when more were not counted. */
function lineList(lines: readonly number[], capped: boolean): string {
  const unique = [...new Set(lines)];
  const named = unique.slice(0, LISTED).map(String);
  const rest = unique.length - named.length;
  const more = rest > 0 ? [`${rest}${capped ? '+' : ''} more`] : capped ? ['more'] : [];
  return `${unique.length === 1 && more.length === 0 ? 'line' : 'lines'} ${joined([...named, ...more])}`;
}

/** `a`, `a and b` or `a, b and c`, naming at most `LISTED` items and counting the rest. */
function list(items: readonly string[]): string {
  const rest = items.length - LISTED;
  return joined(rest > 0 ? [...items.slice(0, LISTED), `${rest} more`] : items);
}

function joined(items: readonly string[]): string {
  return items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
