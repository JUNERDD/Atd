/** Relative day ranges the history list labels by name; older tasks fall into calendar months. */
export type HistoryPeriod = 'today' | 'yesterday' | 'previous7Days' | 'previous30Days';

export type HistorySection<T> = {
  /** Stable key: the period name, or `year-month` for a calendar month. */
  id: string;
  items: T[];
} & (
  | { kind: 'period'; period: HistoryPeriod }
  /** Older than 30 days; `month` is the first day of its calendar month. */
  | { kind: 'month'; month: Date }
);

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Whole calendar days between `date` and `now` in local time, so 23:59 yesterday is one day ago.
 * Rounding absorbs the hour a daylight-saving change adds or removes.
 */
export function daysAgo(date: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
}

function periodOf(days: number): HistoryPeriod | undefined {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'previous7Days';
  if (days < 30) return 'previous30Days';
  return undefined;
}

/**
 * Groups tasks into Today, Yesterday, Previous 7 Days, Previous 30 Days, then one section per
 * calendar month, as Notes does. Sections and their items keep the input order, so a list already
 * sorted newest first stays that way.
 */
export function historySections<T>(
  items: readonly T[],
  dateOf: (item: T) => Date,
  now: Date,
): HistorySection<T>[] {
  const sections = new Map<string, HistorySection<T>>();
  for (const item of items) {
    const date = dateOf(item);
    const period = periodOf(daysAgo(date, now));
    const id = period ?? `${date.getFullYear()}-${date.getMonth() + 1}`;
    let section = sections.get(id);
    if (!section) {
      section = period
        ? { id, kind: 'period', period, items: [] }
        : { id, kind: 'month', month: new Date(date.getFullYear(), date.getMonth(), 1), items: [] };
      sections.set(id, section);
    }
    section.items.push(item);
  }
  return [...sections.values()];
}
