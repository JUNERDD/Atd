import type { ReactNode } from 'react';
import type { MatchRange } from '@ai/ui/lib/fuzzy-match';

/** One selectable row of the quick panel; every source maps its candidates to this shape. */
export interface QuickOption {
  /** Unique within the open panel; the controlled cmdk value. */
  value: string;
  icon: ReactNode;
  title: string;
  description?: string | undefined;
  /**
   * Query matches to emphasize. Views match their visible text as the `title` and `description`
   * fields, so a match object fits here as is; other fields (command keywords) match unmarked.
   */
  ranges?: { title?: readonly MatchRange[]; description?: readonly MatchRange[] } | undefined;
  /** Trailing muted text, such as a state or a relative time. */
  status?: string | undefined;
  /** Greyed rows stay visible with their reason but are skipped by keyboard and pointer. */
  disabled?: boolean | undefined;
  /** The current choice in a drill list (model, effort). */
  checked?: boolean | undefined;
  /** 0–1 relevance to the query (`FieldsMatch.score`); absent without a query. */
  score?: number | undefined;
  /** Runs for a click, Enter, or Tab alike. */
  select: () => void;
}

/** A section of the list; it shows only while it has options. */
export interface QuickGroup {
  id: string;
  /** Omitted for the trailing "Browse files…" row, which ends the list without a heading. */
  heading?: string | undefined;
  /** Query matches in the heading, when the options also match on it (a model's connection). */
  headingRanges?: readonly MatchRange[] | undefined;
  options: QuickOption[];
  /** A remark above the options, such as incomplete file results. */
  notice?: string | undefined;
}

/** Groups for one panel view, plus the line shown when no group with a heading has options. */
export interface QuickView {
  groups: QuickGroup[];
  /** Why nothing is listed, such as no match or a loading source; null shows no line. */
  empty: string | null;
}

/**
 * Orders groups for a query the way cmdk does when it filters: by their best option score, ties
 * in source order. Groups without a scored option (the trailing "Browse files…") keep their
 * relative order after the matches, so the first selectable option is the best match.
 */
export function orderGroups(groups: readonly QuickGroup[], query: string): QuickGroup[] {
  if (!query.trim()) return [...groups];
  const best = (group: QuickGroup) =>
    group.options.reduce((top, option) => Math.max(top, option.score ?? 0), 0);
  return groups
    .map((group, index) => ({ group, index, score: best(group) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.group);
}

/**
 * Drops groups without options: a loading, unavailable, or empty source takes no room, and a
 * notice only accompanies options.
 */
export function visibleGroups(groups: readonly QuickGroup[]): QuickGroup[] {
  return groups.filter((group) => group.options.length > 0);
}
