import { foldText, type FuzzyView } from './fuzzy-match.js';
import { lineAt, type LineRange } from './text-view.js';

/**
 * Where a missed oldText most likely was meant to match, so the model can fix the call from a few
 * lines instead of reading the whole file again. Lines compare by their folded text with
 * whitespace runs collapsed, so indentation, trailing spaces and quote or width variants do not
 * count; a window of the oldText's line count scores by how alike its lines are.
 */

/** Old lines beyond this many do not take part in the search. */
const MAX_WINDOW = 40;
/** Lines shorter than this, such as a lone brace, are too common to point at a region. */
const MIN_ANCHOR = 3;
/** Windows with the most anchoring lines that are scored in full. */
const SCORED = 5;
/** The lowest average line similarity still worth showing. */
const MIN_SCORE = 0.5;
/** A newText with fewer non-whitespace characters is too common to report as already present. */
const MIN_PRESENT = 6;

const keyCache = new WeakMap<FuzzyView, readonly string[]>();

function key(folded: string): string {
  return folded.replace(/\s+/g, ' ').trim();
}

function keysOf(view: FuzzyView): readonly string[] {
  let keys = keyCache.get(view);
  if (keys === undefined) {
    keys = view.lines.map(key);
    keyCache.set(view, keys);
  }
  return keys;
}

/** The lines most like a missed oldText, or undefined when nothing is alike enough. */
export function closestRegion(view: FuzzyView, oldText: string): LineRange | undefined {
  const all = foldText(oldText).split('\n').map(key);
  let lead = 0;
  while (lead < all.length && all[lead] === '') lead += 1;
  let end = all.length;
  while (end > lead && all[end - 1] === '') end -= 1;
  if (lead === end) return undefined;
  const target = all.slice(lead, Math.min(end, lead + MAX_WINDOW));
  const lines = keysOf(view);
  const starts = anchoredStarts(lines, target);
  if (starts.length === 0 || (starts[0]?.votes ?? 0) * 2 < target.length) {
    const start = similarLineStart(lines, target);
    if (start !== undefined) starts.push({ start, votes: 0 });
  }
  let best: { start: number; score: number } | undefined;
  for (const { start } of starts) {
    const score = windowScore(lines, target, start);
    if (best === undefined || score > best.score) best = { start, score };
  }
  if (best === undefined || best.score < MIN_SCORE) return undefined;
  const first = Math.max(0, best.start);
  const last = Math.min(lines.length - 1, best.start + target.length - 1);
  return { first: first + 1, last: last + 1 };
}

/**
 * Window starts that file lines equal to an old line point at, the most pointed-at first: a file
 * line equal to old line `i` votes for the window that starts `i` lines above it.
 */
function anchoredStarts(
  lines: readonly string[],
  target: readonly string[],
): { start: number; votes: number }[] {
  const offsets = new Map<string, number[]>();
  target.forEach((line, index) => {
    if (line.length >= MIN_ANCHOR) offsets.set(line, [...(offsets.get(line) ?? []), index]);
  });
  const votes = new Map<number, number>();
  lines.forEach((line, index) => {
    for (const offset of offsets.get(line) ?? [])
      votes.set(index - offset, (votes.get(index - offset) ?? 0) + 1);
  });
  return [...votes]
    .map(([start, count]) => ({ start, votes: count }))
    .sort((a, b) => b.votes - a.votes || a.start - b.start)
    .slice(0, SCORED);
}

/** With no line equal, the window around the file line most like the longest old line. */
function similarLineStart(lines: readonly string[], target: readonly string[]): number | undefined {
  let pivot = 0;
  target.forEach((line, index) => {
    if (line.length > (target[pivot]?.length ?? 0)) pivot = index;
  });
  const wanted = target[pivot] ?? '';
  let best: { index: number; score: number } | undefined;
  lines.forEach((line, index) => {
    if (line.length * 2 < wanted.length || line.length > wanted.length * 2) return;
    const score = similarity(line, wanted);
    if (score >= MIN_SCORE && (best === undefined || score > best.score)) best = { index, score };
  });
  return best === undefined ? undefined : best.index - pivot;
}

function windowScore(lines: readonly string[], target: readonly string[], start: number): number {
  let total = 0;
  target.forEach((line, index) => {
    total += similarity(lines[start + index] ?? '', line);
  });
  return total / target.length;
}

/** Dice similarity of two lines' character bigrams: 1 for equal lines, 0 for nothing shared. */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const counts = new Map<number, number>();
  for (let index = 0; index < a.length - 1; index++) {
    const pair = a.charCodeAt(index) * 0x10000 + a.charCodeAt(index + 1);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  let shared = 0;
  for (let index = 0; index < b.length - 1; index++) {
    const pair = b.charCodeAt(index) * 0x10000 + b.charCodeAt(index + 1);
    const count = counts.get(pair) ?? 0;
    if (count > 0) {
      shared += 1;
      counts.set(pair, count - 1);
    }
  }
  return (2 * shared) / (a.length + b.length - 2);
}

/**
 * The lines where a missed entry's newText already stands, which suggests the edit was applied
 * before; undefined when it is absent, stands in more than one place, or is too short to tell.
 */
export function presentRegion(
  lf: string,
  starts: Int32Array,
  newText: string,
): LineRange | undefined {
  if (newText.replace(/\s+/g, '').length < MIN_PRESENT) return undefined;
  const at = lf.indexOf(newText);
  if (at === -1 || lf.indexOf(newText, at + 1) !== -1) return undefined;
  return { first: lineAt(starts, at), last: lineAt(starts, at + newText.length - 1) };
}
