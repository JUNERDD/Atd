import { foldText, fuzzyOccurrences, type FuzzyView, type Occurrence } from './fuzzy-match.js';

/** One entry of an edit call's `edits`, with its line breaks as LF. */
export interface EditEntry {
  readonly oldText: string;
  readonly newText: string;
  /** Replace every exact occurrence of `oldText` rather than requiring one. */
  readonly replaceAll: boolean;
}

/** A region of the file one entry replaces, as offsets in its LF view. */
export interface Span extends Occurrence {
  /** Index of the entry in the call's `edits`. */
  readonly entry: number;
  readonly edit: EditEntry;
  /** Whether it matched only after folding (fuzzy-match.ts). */
  readonly fuzzy: boolean;
}

/** Why an entry matched no region it could replace. */
export type Miss =
  | { readonly kind: 'empty'; readonly entry: number }
  | { readonly kind: 'missing'; readonly entry: number; readonly edit: EditEntry }
  | {
      readonly kind: 'ambiguous';
      readonly entry: number;
      /** Whether the occurrences were counted among folded text, after an exact miss. */
      readonly fuzzy: boolean;
      /** LF offsets of the occurrences, at most `OCCURRENCE_LIMIT` of them. */
      readonly at: readonly number[];
      /** Whether there were more than `OCCURRENCE_LIMIT`. */
      readonly capped: boolean;
    };

/** How many occurrences of an ambiguous oldText are counted and placed before counting stops. */
export const OCCURRENCE_LIMIT = 1000;

/**
 * Matches every entry against the original file, never against the result of another entry. An
 * entry matches exactly first; only when that misses does it match among folded text, and
 * uniqueness counts in the space it matched in, so an exact oldText is unique even when folding
 * would make another region equal to it. `replaceAll` replaces every non-overlapping exact
 * occurrence and never folds. `fuzzy` builds the folded view on first use, so a call folds the
 * file at most once, and only after an exact miss.
 */
export function locate(
  lf: string,
  entries: readonly EditEntry[],
  fuzzy: () => FuzzyView,
): { spans: Span[]; misses: Miss[] } {
  const spans: Span[] = [];
  const misses: Miss[] = [];
  entries.forEach((edit, entry) => {
    const { oldText } = edit;
    if (oldText.length === 0) {
      misses.push({ kind: 'empty', entry });
    } else if (edit.replaceAll) {
      const found = exactOccurrences(lf, oldText, oldText.length, Number.POSITIVE_INFINITY);
      if (found.length === 0) misses.push({ kind: 'missing', entry, edit });
      for (const start of found)
        spans.push({ entry, edit, start, end: start + oldText.length, fuzzy: false });
    } else {
      const exact = exactOccurrences(lf, oldText, 1, OCCURRENCE_LIMIT);
      const [only] = exact;
      if (exact.length > 1) misses.push(ambiguous(entry, false, exact));
      else if (only !== undefined)
        spans.push({ entry, edit, start: only, end: only + oldText.length, fuzzy: false });
      else {
        const found = fuzzyOccurrences(fuzzy(), foldText(oldText), OCCURRENCE_LIMIT);
        const [match] = found;
        if (found.length > 1)
          misses.push(
            ambiguous(
              entry,
              true,
              found.map(({ start }) => start),
            ),
          );
        else if (match !== undefined) spans.push({ entry, edit, ...match, fuzzy: true });
        else misses.push({ kind: 'missing', entry, edit });
      }
    }
  });
  return { spans, misses };
}

/**
 * Offsets where `needle` occurs, the next search starting `step` past the last hit: 1 counts
 * overlapping occurrences (`aa` twice in `aaa`), the needle's length counts disjoint ones. At most
 * `limit` + 1 are returned.
 */
function exactOccurrences(haystack: string, needle: string, step: number, limit: number): number[] {
  const found: number[] = [];
  for (
    let at = haystack.indexOf(needle);
    at !== -1 && found.length <= limit;
    at = haystack.indexOf(needle, at + step)
  )
    found.push(at);
  return found;
}

function ambiguous(entry: number, fuzzy: boolean, at: readonly number[]): Miss {
  return {
    kind: 'ambiguous',
    entry,
    fuzzy,
    at: at.slice(0, OCCURRENCE_LIMIT),
    capped: at.length > OCCURRENCE_LIMIT,
  };
}
