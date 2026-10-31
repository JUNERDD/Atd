import { generateUnifiedPatch, type EditToolDetails } from '@earendil-works/pi-coding-agent';

const HUNK = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/;

/**
 * pi's edit details for one call, from a single line diff of the LF views before and after it.
 * `patch` is pi's `generateUnifiedPatch` (jsdiff, four lines of context). `diff` and
 * `firstChangedLine` are what pi's `generateDiffString` prints for the same texts, rebuilt from the
 * patch's hunks instead of a second whole-file diff: `+<n> text`, `-<n> text` or ` <n> text` with
 * the number padded to the widest line number, and a padded `...` row wherever unchanged lines are
 * skipped (transcript-details/edit.ts and the renderer read that format). The two group changes
 * alike, since both keep four lines of context and join changes at most eight lines apart.
 * Re-check this against pi's `generateDiffString` when upgrading pi.
 */
export function editDetails(path: string, before: string, after: string): EditToolDetails {
  const patch = generateUnifiedPatch(path, before, after);
  const width = String(Math.max(count(before, '\n') + 1, count(after, '\n') + 1)).length;
  const number = (line: number) => String(line).padStart(width, ' ');
  const gap = ` ${''.padStart(width, ' ')} ...`;
  const rows: string[] = [];
  let firstChangedLine: number | undefined;
  let oldLine = 1;
  let newLine = 1;
  let hunks = 0;
  for (const row of patch.slice(`--- ${path}\n+++ ${path}\n`.length).split('\n')) {
    const hunk = HUNK.exec(row);
    if (hunk !== null) {
      // A side with no lines prints its start one lower, as unified diffs do.
      oldLine = Number(hunk[1]) + (hunk[2] === '0' ? 1 : 0);
      newLine = Number(hunk[3]) + (hunk[4] === '0' ? 1 : 0);
      if (hunks > 0 || oldLine > 1) rows.push(gap);
      hunks += 1;
      continue;
    }
    const text = row.slice(1);
    if (row.startsWith('+')) {
      firstChangedLine ??= newLine;
      rows.push(`+${number(newLine)} ${text}`);
      newLine += 1;
    } else if (row.startsWith('-')) {
      firstChangedLine ??= newLine;
      rows.push(`-${number(oldLine)} ${text}`);
      oldLine += 1;
    } else if (row.startsWith(' ')) {
      rows.push(` ${number(oldLine)} ${text}`);
      oldLine += 1;
      newLine += 1;
    }
    // Anything else is jsdiff's `\ No newline at end of file`, which pi's diff does not show.
  }
  // jsdiff counts a last line without a final LF as a line too.
  const oldLines = count(before, '\n') + (before.length > 0 && !before.endsWith('\n') ? 1 : 0);
  if (hunks > 0 && oldLine - 1 < oldLines) rows.push(gap);
  return {
    diff: rows.join('\n'),
    patch,
    ...(firstChangedLine === undefined ? {} : { firstChangedLine }),
  };
}

function count(text: string, char: string): number {
  let found = 0;
  for (let at = text.indexOf(char); at !== -1; at = text.indexOf(char, at + 1)) found += 1;
  return found;
}
