import type { ReactNode } from 'react';
import { commandFilter } from '@ai/ui/lib/command-filter';

/** One selectable row of the quick panel; every source maps its candidates to this shape. */
export interface QuickOption {
  /** Unique within the open panel; the controlled cmdk value. */
  value: string;
  icon: ReactNode;
  title: string;
  /** `[from, to)` range of `title` emphasized as the query match. */
  match?: readonly [number, number];
  description?: string;
  /** Trailing muted text, such as a state or a relative time. */
  status?: string;
  /** Greyed rows stay visible with their reason but are skipped by keyboard and pointer. */
  disabled?: boolean;
  /** The current choice in a drill list (model, effort). */
  checked?: boolean;
  /** Relevance to the query (cmdk's 0–1 score); absent without a query or a local match. */
  score?: number;
  /** Runs for a click, Enter, or Tab alike. */
  select: () => void;
}

/** A section of the list. `notice` explains a loading, unavailable, or empty group in place. */
export interface QuickGroup {
  id: string;
  /** Omitted for the trailing "Browse files…" row, which ends the list without a heading. */
  heading?: string;
  options: QuickOption[];
  notice?: string;
}

/** Groups for one panel view, plus the line shown when none of them has anything to show. */
export interface QuickView {
  groups: QuickGroup[];
  empty: string;
}

/**
 * Keeps the items matching `query` (all of them, unscored, for an empty query) with the best
 * matches first; equal scores keep the source order. Matching is cmdk's filter, shared with the
 * app's other lists.
 */
export function rankByQuery<T>(
  items: readonly T[],
  query: string,
  text: (item: T) => string,
): { item: T; score?: number }[] {
  const search = query.trim();
  if (!search) return items.map((item) => ({ item }));
  return items
    .map((item, index) => ({ item, index, score: commandFilter(text(item), search) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item, score }) => ({ item, score }));
}

/**
 * Orders groups for a query the way cmdk does when it filters: by their best option score, ties
 * in source order. Groups without a scored option (notices, the trailing "Browse files…") keep
 * their relative order after the matches, so the first selectable option is the best match.
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

/** Drops groups with nothing to show: no options and no notice. */
export function visibleGroups(groups: readonly QuickGroup[]): QuickGroup[] {
  return groups.filter((group) => group.options.length > 0 || group.notice !== undefined);
}
