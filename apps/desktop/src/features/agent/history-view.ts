import { Type, type Static } from 'typebox';
import type { AgentTask, RunStatus } from '../../client/agent/task-schema';
import { daysAgo, historySections, type HistoryPeriod } from './history-sections';

export const HISTORY_GROUPS = ['date', 'status', 'model', 'origin', 'none'] as const;
export const HISTORY_SORTS = ['updated', 'created', 'title'] as const;

/** How the history list is sectioned. `date` follows the date the list is sorted by. */
export type HistoryGroup = (typeof HISTORY_GROUPS)[number];
/** What orders the rows within a section: the two dates run newest first, the title A to Z. */
export type HistorySort = (typeof HISTORY_SORTS)[number];

export const HistoryViewSchema = Type.Object(
  {
    group: Type.Enum(HISTORY_GROUPS),
    sort: Type.Enum(HISTORY_SORTS),
  },
  { additionalProperties: false },
);
export type HistoryView = Static<typeof HistoryViewSchema>;

export const DEFAULT_HISTORY_VIEW: HistoryView = { group: 'date', sort: 'updated' };

/**
 * What a task's last run says about it, coarser than the run status: the groups the status
 * sections name, in the order they are shown (what needs the user first).
 */
export const STATUS_GROUPS = [
  'needsInput',
  'inProgress',
  'failed',
  'stopped',
  'completed',
  'draft',
] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];

const STATUS_GROUP_OF: Record<RunStatus, StatusGroup> = {
  awaiting_input: 'needsInput',
  awaiting_confirmation: 'needsInput',
  queued: 'inProgress',
  running: 'inProgress',
  stopping: 'inProgress',
  failed: 'failed',
  interrupted: 'failed',
  unknown: 'failed',
  stopped: 'stopped',
  cancelled: 'stopped',
  completed: 'completed',
};

/** A task without a run is an imported draft that never ran. */
export function statusGroupOf(task: AgentTask): StatusGroup {
  const status = task.runs.at(-1)?.status;
  return status ? STATUS_GROUP_OF[status] : 'draft';
}

/**
 * Who started a task, as the origin sections name it, in the order they are shown: an automation
 * fired it, a user app's backend ran it, or the person did.
 */
export const ORIGIN_GROUPS = ['automation', 'app', 'personal'] as const;
export type OriginGroup = (typeof ORIGIN_GROUPS)[number];

export function originGroupOf(task: AgentTask): OriginGroup {
  return task.origin?.kind ?? 'personal';
}

/** The model the task's last run used, as the name the list shows; null for a task never run. */
export function modelNameOf(task: AgentTask): string | null {
  const model = task.runs.at(-1)?.snapshot.model;
  if (!model) return null;
  return 'definition' in model ? model.definition.name : model.modelId;
}

export type HistorySection<T> = {
  /** Stable key: the period name, `year-month`, the status group, the model, or `all`. */
  id: string;
  items: T[];
} & (
  | { kind: 'period'; period: HistoryPeriod }
  /** Older than 30 days; `month` is the first day of its calendar month. */
  | { kind: 'month'; month: Date }
  | { kind: 'status'; status: StatusGroup }
  /** `model` is null for tasks that never ran. */
  | { kind: 'model'; model: string | null }
  | { kind: 'origin'; origin: OriginGroup }
  /** The whole list, without a heading. */
  | { kind: 'all' }
);

/** The timestamp the view orders and dates rows by: creation for that sort, else the last update. */
export function stampOf(task: AgentTask, sort: HistorySort): string {
  return sort === 'created' ? task.createdAt : task.updatedAt;
}

export function dateOfTask(task: AgentTask, sort: HistorySort): Date {
  return new Date(stampOf(task, sort));
}

/** Timestamp for ordering; a date that does not parse sorts as the oldest. */
function timeOf(date: Date): number {
  return date.getTime() || 0;
}

/** `items` in the view's order. Rows that compare equal keep their incoming order. */
export function sortHistory<T extends { task: AgentTask }>(
  items: readonly T[],
  sort: HistorySort,
  language: string,
): T[] {
  const collator = new Intl.Collator(language, { numeric: true, sensitivity: 'base' });
  return [...items].sort((a, b) =>
    sort === 'title'
      ? collator.compare(a.task.title, b.task.title)
      : timeOf(dateOfTask(b.task, sort)) - timeOf(dateOfTask(a.task, sort)),
  );
}

const PERIODS: readonly HistoryPeriod[] = ['today', 'yesterday', 'previous7Days', 'previous30Days'];

/** Newest section first: the named periods in order, then calendar months, latest month first. */
function newestFirst<T>(a: HistorySection<T>, b: HistorySection<T>): number {
  if (a.kind === 'period' && b.kind === 'period')
    return PERIODS.indexOf(a.period) - PERIODS.indexOf(b.period);
  if (a.kind === 'period') return -1;
  if (b.kind === 'period') return 1;
  if (a.kind === 'month' && b.kind === 'month') return b.month.getTime() - a.month.getTime();
  return 0;
}

/**
 * Sections for the already sorted `items`. Each keeps the incoming order of its rows; the sections
 * themselves follow the group: dates newest first, statuses in `STATUS_GROUPS` order, models by
 * their latest activity with tasks that never ran last, origins in `ORIGIN_GROUPS` order. Empty
 * sections are omitted, and `none` is one section without a heading.
 */
export function groupHistory<T extends { task: AgentTask }>(
  items: readonly T[],
  { group, sort }: HistoryView,
  now: Date,
): HistorySection<T>[] {
  if (!items.length) return [];
  switch (group) {
    case 'none':
      return [{ id: 'all', kind: 'all', items: [...items] }];
    case 'date':
      return historySections(items, ({ task }) => dateOfTask(task, sort), now).sort(newestFirst);
    case 'status':
      return STATUS_GROUPS.flatMap((status): HistorySection<T>[] => {
        const inGroup = items.filter(({ task }) => statusGroupOf(task) === status);
        return inGroup.length ? [{ id: status, kind: 'status', status, items: inGroup }] : [];
      });
    case 'origin':
      return ORIGIN_GROUPS.flatMap((origin): HistorySection<T>[] => {
        const inGroup = items.filter(({ task }) => originGroupOf(task) === origin);
        return inGroup.length
          ? [{ id: `origin:${origin}`, kind: 'origin', origin, items: inGroup }]
          : [];
      });
    case 'model': {
      const sections = new Map<string, { model: string | null; latest: number; items: T[] }>();
      for (const item of items) {
        const model = modelNameOf(item.task);
        const entry = sections.get(model ?? '') ?? { model, latest: 0, items: [] };
        entry.latest = Math.max(entry.latest, timeOf(new Date(item.task.updatedAt)));
        entry.items.push(item);
        sections.set(model ?? '', entry);
      }
      return [...sections.values()]
        .sort((a, b) =>
          a.model === null || b.model === null
            ? Number(a.model === null) - Number(b.model === null)
            : b.latest - a.latest,
        )
        .map(({ model, items: inModel }) => ({
          id: `model:${model ?? ''}`,
          kind: 'model',
          model,
          items: inModel,
        }));
    }
  }
}

/**
 * How long ago the row's date is, for its meta line: a time of day for today, the weekday within
 * the week, a date beyond. Rows outside a date section have no day heading above them, so
 * yesterday's reads "Yesterday 23:35", and an older year shows its year.
 */
export function rowDate(date: Date, now: Date, language: string, dayHeading: boolean): string {
  const days = daysAgo(date, now);
  const time = date.toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit' });
  if (days <= 0) return time;
  if (days === 1) {
    if (dayHeading) return time;
    const yesterday = new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(-1, 'day');
    return `${yesterday} ${time}`;
  }
  if (days < 7) return date.toLocaleDateString(language, { weekday: 'long' });
  return date.toLocaleDateString(language, {
    month: 'short',
    day: 'numeric',
    // A date section's month heading already names an older year.
    ...(dayHeading || date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}
