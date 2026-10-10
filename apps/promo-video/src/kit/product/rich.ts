import { streamUnits } from './text.ts';

/**
 * A reply's content, as the transcript's markdown renders it, in a form a scene's `content.ts` can
 * write by hand: paragraphs of inline runs, bullet lists, and small tables.
 *
 * - a string is plain text;
 * - `{ bold }` is strong text, `{ code }` an inline code chip;
 * - `{ mark }` is text the film points at (a unit the reply chose on its own), lit by `highlight`.
 */
export type Inline = string | { bold: string } | { code: string } | { mark: string };

export type RichBlock =
  | { p: readonly Inline[] }
  | { list: readonly (readonly Inline[])[] }
  | { table: { head: readonly string[]; rows: readonly (readonly string[])[] } };

export type RunKind = 'text' | 'bold' | 'code' | 'mark';

/** An inline run cut into streaming units; `start` is its first unit's place in the whole reply. */
export interface Run {
  kind: RunKind;
  units: string[];
  start: number;
}

export type LaidBlock =
  | { kind: 'p'; runs: Run[] }
  | { kind: 'list'; items: Run[][] }
  | { kind: 'table'; head: Run[]; rows: Run[][] };

function runOf(inline: Inline, start: number): Run {
  if (typeof inline === 'string') return { kind: 'text', units: streamUnits(inline), start };
  if ('bold' in inline) return { kind: 'bold', units: streamUnits(inline.bold), start };
  if ('code' in inline) return { kind: 'code', units: streamUnits(inline.code), start };
  return { kind: 'mark', units: streamUnits(inline.mark), start };
}

/**
 * The reply in reading order, every run numbered by unit, so one reveal head streams it from the
 * first word to the last table cell. Returns the blocks and the total unit count.
 */
export function layOut(blocks: readonly RichBlock[]): { blocks: LaidBlock[]; total: number } {
  let next = 0;
  const runs = (inlines: readonly Inline[]): Run[] =>
    inlines.map((inline) => {
      const run = runOf(inline, next);
      next += run.units.length;
      return run;
    });
  const laid = blocks.map((block): LaidBlock => {
    if ('p' in block) return { kind: 'p', runs: runs(block.p) };
    if ('list' in block) return { kind: 'list', items: block.list.map(runs) };
    return {
      kind: 'table',
      head: runs(block.table.head),
      rows: block.table.rows.map(runs),
    };
  });
  return { blocks: laid, total: next };
}
