/**
 * How much of its files' loaded text a run's material carries: at most `total` characters across
 * a run's non-image files and `perFile` for any one of them. The rest stays in each file's
 * resource, which `read` returns line for line.
 */
export const MATERIAL_BUDGET = { total: 120_000, perFile: 50_000 };

/**
 * Each text's share of the budget, by a fair split: texts that fit their even share keep all of
 * it, and what they leave goes to the larger ones, none above `perFile`.
 */
export function shareBudget(lengths: readonly number[], budget = MATERIAL_BUDGET): number[] {
  const shares = lengths.map(() => 0);
  const order = lengths
    .map((length, index) => ({ length, index }))
    .sort((a, b) => a.length - b.length);
  let remaining = budget.total;
  order.forEach(({ length, index }, position) => {
    const even = Math.floor(remaining / (order.length - position));
    const share = Math.min(length, budget.perFile, even);
    shares[index] = share;
    remaining -= share;
  });
  return shares;
}

/**
 * A file's text cut to `limit` characters on a line boundary, ending with a note that names the
 * line where `read` continues; the whole text when it fits. Line numbers are `read`'s: lines are
 * split on `\n`. A first line longer than `limit` is cut inside it and the note says so.
 */
export function materialText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const total = lineCount(text);
  const end = text.lastIndexOf('\n', limit);
  if (end < 0) {
    const kept = text.slice(0, keepSurrogates(text, limit));
    return `${kept}\n\n[Showing the first ${kept.length} characters of line 1 of ${total}; the line is longer than the material holds. The rest continues in the resource: read it from line 1.]`;
  }
  const kept = text.slice(0, end);
  const shown = lineCount(kept);
  return `${kept}\n\n[Showing lines 1–${shown} of ${total}. The rest continues in the resource: read it from line ${shown + 1}.]`;
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
