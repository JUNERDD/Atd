import { Cron } from 'croner';
import {
  AUTOMATION_MIN_INTERVAL_MINUTES,
  type AutomationSchedule,
  type AutomationTrigger,
  type AutomationTriggerProblem,
} from '@atd/agent-contracts';

/**
 * Occurrence math for schedule triggers (decision D6). croner (pinned 10.0.1) only evaluates
 * calendar and cron schedules here: it is built without a callback, so it never arms its own
 * timer (its timer loop has open DST bugs), and the engine's tick owns all timing. Its observed
 * daylight-saving behavior is the product rule, pinned by tests: a wall-clock time inside a
 * spring-forward gap runs once, shifted forward by the gap, and a time inside a fall-back
 * overlap runs once, at its first occurrence. Intervals and one-time runs are plain arithmetic.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MIN_SPACING_MS = AUTOMATION_MIN_INTERVAL_MINUTES * MINUTE_MS;
/** Occurrences of a custom expression checked for the minimum spacing: a close pair repeats on
 * every day the expression matches, so the first matching days expose it. */
const SPACING_SCAN = 200;
/** ISO 8601 date-time with an explicit offset, seconds optional. */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

type ScheduleTrigger = Extract<AutomationTrigger, { kind: 'schedule' }>;
type CalendarSchedule = Exclude<AutomationSchedule, { kind: 'once' } | { kind: 'interval' }>;

/** Occurrences of one schedule, in epoch milliseconds. */
export interface ScheduleClock {
  /** The first occurrence strictly after `after`; null when none is left. */
  next(after: number): number | null;
  /** The latest occurrence at or before `at`; null when there is none. */
  latest(at: number): number | null;
}

/**
 * Whether `zone` is an IANA time zone this runtime knows. `Intl.supportedValuesOf('timeZone')`
 * omits `UTC`, so the zone is tried instead.
 */
export function validTimeZone(zone: string): boolean {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone !== '';
  } catch {
    return false;
  }
}

/** The instant a one-time schedule names, or null when `at` lacks a date, a time or an offset. */
export function onceTime(at: string): number | null {
  if (!ISO_WITH_OFFSET.test(at)) return null;
  const time = Date.parse(at);
  return Number.isNaN(time) ? null : time;
}

/**
 * The clock of `schedule` in `timezone`. `anchor` is where an interval counts from (the last run,
 * or when the automation was turned on); other kinds ignore it. Throws for a schedule that
 * `scheduleProblem` would refuse.
 */
export function scheduleClock(
  schedule: AutomationSchedule,
  timezone: string,
  anchor: number,
): ScheduleClock {
  switch (schedule.kind) {
    case 'once': {
      const at = onceTime(schedule.at);
      return {
        next: (after) => (at !== null && at > after ? at : null),
        latest: (time) => (at !== null && at <= time ? at : null),
      };
    }
    case 'interval': {
      const every = schedule.everyMinutes * MINUTE_MS;
      return {
        next: (after) => anchor + every * Math.max(1, Math.floor((after - anchor) / every) + 1),
        latest: (time) =>
          time < anchor + every ? null : anchor + every * Math.floor((time - anchor) / every),
      };
    }
    case 'daily':
    case 'weekly':
    case 'monthly':
    case 'cron':
      return cronClock(calendarExpression(schedule), timezone);
  }
}

function cronClock(expression: string, timezone: string): ScheduleClock {
  const cron = new Cron(expression, { timezone, paused: true, mode: '5-part' });
  const nextAfter = (after: number): number | null =>
    cron.nextRun(new Date(after))?.getTime() ?? null;
  return {
    next: (after) => {
      // croner moves a second forward and drops milliseconds, so its next run is later than
      // `after`; the check keeps that contract explicit.
      const next = nextAfter(after);
      return next === null || next > after ? next : nextAfter(after + 1000);
    },
    latest: (time) => {
      // previousRuns steps a second back before matching, so the reference sits one second past
      // `time` (floored) to include an occurrence exactly at it.
      const reference = new Date(Math.floor(time / 1000) * 1000 + 1000);
      return cron.previousRuns(1, reference)[0]?.getTime() ?? null;
    },
  };
}

/** The five-field expression a calendar preset stands for, or the custom expression itself. */
function calendarExpression(schedule: CalendarSchedule): string {
  if (schedule.kind === 'cron') return schedule.expression.trim();
  const [hour, minute] = schedule.time.split(':').map(Number);
  const at = `${minute ?? 0} ${hour ?? 0}`;
  switch (schedule.kind) {
    case 'daily':
      return `${at} * * *`;
    case 'weekly':
      return `${at} * * ${[...new Set(schedule.days)].sort((a, b) => a - b).join(',')}`;
    case 'monthly':
      return `${at} ${schedule.day === 'last' ? 'L' : schedule.day} * *`;
  }
}

/**
 * Exactly five fields, as the contract promises. croner 10.0.1 reads `?` in the day fields as
 * "every day" (croner#392) and a string with `:` as a one-time date, so both are refused.
 */
function customShapeOk(expression: string): boolean {
  return (
    expression.trim().split(/\s+/).length === 5 &&
    !expression.includes('?') &&
    !expression.includes(':')
  );
}

/**
 * Why a schedule cannot be saved or previewed at `now`, or undefined. `forSave` adds what only a
 * save checks: a one-time run already in the past, and the minimum spacing of a custom
 * expression (a status check of a saved schedule skips both).
 */
export function scheduleProblem(
  trigger: ScheduleTrigger,
  now: number,
  forSave: boolean,
): AutomationTriggerProblem | undefined {
  if (!validTimeZone(trigger.timezone)) return 'invalidTimeZone';
  const { schedule } = trigger;
  switch (schedule.kind) {
    case 'once': {
      const at = onceTime(schedule.at);
      if (at === null) return 'invalidExpression';
      return forSave && at <= now ? 'inPast' : undefined;
    }
    case 'interval':
    case 'daily':
    case 'weekly':
    case 'monthly':
      return undefined;
    case 'cron':
      return cronProblem(schedule.expression, trigger.timezone, now, forSave);
  }
}

function cronProblem(
  expression: string,
  timezone: string,
  now: number,
  spacing: boolean,
): AutomationTriggerProblem | undefined {
  if (!customShapeOk(expression)) return 'invalidExpression';
  let cron: Cron;
  try {
    cron = new Cron(expression.trim(), { timezone, paused: true, mode: '5-part' });
    // An expression that never fires (the 30th of February) cannot be used either.
    if (!cron.nextRun(new Date(now))) return 'invalidExpression';
  } catch {
    return 'invalidExpression';
  }
  if (!spacing) return undefined;
  // A daylight-saving change can bring two wall-clock times close in real time, so the
  // occurrences around each change of the coming year are checked as well.
  const starts = [now, ...offsetChanges(timezone, now).map((change) => change - DAY_MS)];
  return starts.some((start) => closePair(cron.nextRuns(SPACING_SCAN, new Date(start))))
    ? 'tooFrequent'
    : undefined;
}

/** Whether consecutive occurrences (in real time) come closer than the minimum spacing. */
function closePair(runs: readonly Date[]): boolean {
  for (let index = 1; index < runs.length; index += 1) {
    const gap = (runs[index]?.getTime() ?? 0) - (runs[index - 1]?.getTime() ?? 0);
    if (gap < MIN_SPACING_MS) return true;
  }
  return false;
}

/**
 * Instants within a year after `from` from which `zone`'s UTC offset changes within a day: the
 * last daily sample before each daylight-saving change.
 */
function offsetChanges(zone: string, from: number): number[] {
  const format = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
  const offset = (time: number) =>
    format.formatToParts(new Date(time)).find((part) => part.type === 'timeZoneName')?.value;
  const changes: number[] = [];
  let previous = offset(from);
  for (let day = 1; day <= 370; day += 1) {
    const current = offset(from + day * DAY_MS);
    if (current !== previous) changes.push(from + (day - 1) * DAY_MS);
    previous = current;
  }
  return changes;
}

/**
 * The cursor of a schedule turned on, created or changed at `now`: the first occurrence after
 * it, and for an interval the anchor it counts from. Other triggers keep none.
 */
export function freshCursor(
  trigger: AutomationTrigger,
  now: number,
): { nextDueAt?: string; anchor?: string } {
  if (trigger.kind !== 'schedule') return {};
  const next = scheduleClock(trigger.schedule, trigger.timezone, now).next(now);
  return {
    ...(next !== null ? { nextDueAt: new Date(next).toISOString() } : {}),
    ...(trigger.schedule.kind === 'interval' ? { anchor: new Date(now).toISOString() } : {}),
  };
}

/** The next `count` occurrences after `now` (previews), as ISO date-times. */
export function upcoming(trigger: ScheduleTrigger, now: number, count: number): string[] {
  const clock = scheduleClock(trigger.schedule, trigger.timezone, now);
  const runs: string[] = [];
  for (let after = now; runs.length < count;) {
    const next = clock.next(after);
    if (next === null) break;
    runs.push(new Date(next).toISOString());
    after = next;
  }
  return runs;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** `YYYY-MM-DD HH:mm` in `timezone`: run titles and the confirm text use this neutral form. */
export function wallClock(time: number, timezone: string): string {
  let format = formatters.get(timezone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timezone, format);
  }
  const parts = format.formatToParts(new Date(time));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '00';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}

/** The zone the service process runs in; titles of runs that are not scheduled use it. */
export function processTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
