import { processFile, type FileDiffMetadata } from '@pierre/diffs';

/**
 * Unified patches for the `@pierre/diffs` renderer, built from what Pi's file tools return: the
 * `edit` tool's numbered display diff, and a `read` excerpt that starts past line 1. Tool text is
 * untrusted, so every builder returns `null` when its input does not hold together and callers keep
 * their plain rendering.
 */

/** One line of Pi's display diff: sign, left-padded line number, one space, then the text. */
const PI_LINE = /^([+\- ]) *(\d+)(?: (.*))?$/;
/** Pi's marker for skipped unchanged lines: padding and `...`, with no line number. */
const PI_GAP = /^ +\.\.\.$/;

interface Hunk {
  oldStart: number;
  newStart: number;
  oldCount: number;
  newCount: number;
  lines: string[];
}

/** A unified hunk header; a side with no lines names the line before the hunk, as diff does. */
function hunkHeader({ oldStart, newStart, oldCount, newCount }: Hunk): string {
  const side = (start: number, count: number) => `${count === 0 ? start - 1 : start},${count}`;
  return `@@ -${side(oldStart, oldCount)} +${side(newStart, newCount)} @@`;
}

/** File header lines end at a tab or line break, so those never reach the path. */
function patchText(path: string, hunks: Hunk[]): string {
  const name = path.replace(/[\t\r\n]/g, ' ').trim() || 'file';
  const body = hunks.flatMap((hunk) => [hunkHeader(hunk), ...hunk.lines]);
  return [`--- ${name}`, `+++ ${name}`, ...body, ''].join('\n');
}

/**
 * Pi's `edit` display diff as a unified patch for `path`. Pi numbers added lines by the new file
 * and removed and context lines by the old one, and replaces skipped context with a gap line; each
 * gap starts a new hunk. A hunk's new-side start is its old-side start shifted by the lines added
 * minus the lines removed before it. Every number Pi printed is checked against that count, so a
 * diff in any other shape (or a reordered one) returns `null` instead of a patch with wrong numbers.
 */
export function piDiffToPatch(path: string, diff: string): string | null {
  const hunks: Hunk[] = [];
  let hunk: Hunk | null = null;
  // Lines added minus lines removed so far: the new file's offset from the old one.
  let shift = 0;
  // The next line number expected on each side.
  let oldLine = 1;
  let newLine = 1;
  for (const raw of diff.split('\n')) {
    if (raw === '') continue;
    if (PI_GAP.test(raw)) {
      hunk = null;
      continue;
    }
    const match = PI_LINE.exec(raw);
    if (!match) return null;
    const [, sign = ' ', digits = '', text = ''] = match;
    const number = Number(digits);
    if (!hunk) {
      const oldStart = sign === '+' ? number - shift : number;
      const newStart = oldStart + shift;
      // Hunks only move forward; a start before the previous hunk's end is not Pi's diff.
      if (oldStart < oldLine || newStart < newLine) return null;
      hunk = { oldStart, newStart, oldCount: 0, newCount: 0, lines: [] };
      hunks.push(hunk);
      oldLine = oldStart;
      newLine = newStart;
    }
    if (sign === '+') {
      if (number !== newLine) return null;
      newLine += 1;
      hunk.newCount += 1;
      shift += 1;
    } else if (sign === '-') {
      if (number !== oldLine) return null;
      oldLine += 1;
      hunk.oldCount += 1;
      shift -= 1;
    } else {
      if (number !== oldLine) return null;
      oldLine += 1;
      newLine += 1;
      hunk.oldCount += 1;
      hunk.newCount += 1;
    }
    hunk.lines.push(`${sign}${text}`);
  }
  return hunks.length > 0 ? patchText(path, hunks) : null;
}

/**
 * A run of file lines starting at `startLine` as an unchanged hunk, so the diff renderer numbers
 * them from that line (the plain file renderer always starts at 1). `null` for an empty text.
 */
export function excerptPatch(path: string, text: string, startLine: number): string | null {
  const body = text.replace(/\r\n/g, '\n').replace(/\n$/, '');
  if (!body || !Number.isInteger(startLine) || startLine < 1) return null;
  const lines = body.split('\n').map((line) => ` ${line}`);
  const hunk = {
    oldStart: startLine,
    newStart: startLine,
    oldCount: lines.length,
    newCount: lines.length,
    lines,
  };
  return patchText(path, [hunk]);
}

/** A patch from this module parsed for `FileDiff`; `null` when the parser rejects it. */
export function parsePatch(patch: string): FileDiffMetadata | null {
  try {
    return processFile(patch, { throwOnError: true }) ?? null;
  } catch {
    return null;
  }
}
