import type { ReactNode } from 'react';
import type { MatchRange } from '@ai/ui/lib/fuzzy-match';

/**
 * Renders `text` in NFC, the form `matchFields` ranges point into, with each range in a `<mark>`:
 * semibold in the match colour, a paler form of the composer's blue. Ranges past the end are
 * clipped and overlapping ones skipped, so stale ranges cannot throw.
 */
export function HighlightedText({
  text,
  ranges = [],
}: {
  text: string;
  ranges?: readonly MatchRange[] | undefined;
}) {
  const value = text.normalize('NFC');
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [from, to] of ranges) {
    const start = Math.max(from, cursor);
    const end = Math.min(to, value.length);
    if (start >= end) continue;
    if (start > cursor) parts.push(value.slice(cursor, start));
    parts.push(
      <mark key={start} className="bg-transparent font-semibold text-match">
        {value.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < value.length) parts.push(value.slice(cursor));
  return <>{parts}</>;
}
