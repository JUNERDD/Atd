import { Type } from 'typebox';
import { Value } from 'typebox/value';

/**
 * Dates and times as the automation pages show them. Every instant is formatted with `Intl` in
 * the app's language; schedules keep wall-clock times in their trigger's time zone. Nothing here
 * computes when a schedule fires: next run times come only from the service's preview.
 */

/** The Mac's time zone now; a new schedule starts in it (the service's zone is fixed at its start). */
export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Whether `zone` is an IANA time zone this WebKit knows. */
export function isTimeZone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Every IANA time zone, for the zone picker; `current` stays listed even when unknown here. */
export function timeZones(current: string): string[] {
  const zones = Intl.supportedValuesOf('timeZone');
  return current && !zones.includes(current) ? [current, ...zones] : zones;
}

/** A zone's localized generic name, such as "Eastern Time"; the IANA id when it has none. */
export function zoneName(zone: string, language: string): string {
  if (!isTimeZone(zone)) return zone;
  const part = new Intl.DateTimeFormat(language, { timeZone: zone, timeZoneName: 'longGeneric' })
    .formatToParts(new Date())
    .find(({ type }) => type === 'timeZoneName');
  return part?.value ?? zone;
}

const pad = (value: number) => String(value).padStart(2, '0');

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** What a wall clock in `timeZone` shows at `date`. */
function wallParts(date: Date, timeZone: string | undefined): WallParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
  };
}

/** Minutes `timeZone` is ahead of UTC at `instant` (milliseconds), to the minute. */
function offsetMinutes(instant: number, timeZone: string): number {
  const wall = wallParts(new Date(instant), timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  return Math.round((asUtc - Math.floor(instant / 60000) * 60000) / 60000);
}

const DAY_MS = 86_400_000;

/** `instant` as an ISO date-time on `timeZone`'s clock, with that zone's offset then. */
function isoInZone(instant: number, timeZone: string): string {
  const wall = wallParts(new Date(instant), timeZone);
  const offset = offsetMinutes(instant, timeZone);
  const sign = offset < 0 ? '-' : '+';
  const size = Math.abs(offset);
  const date = `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`;
  const time = `${pad(wall.hour)}:${pad(wall.minute)}:00`;
  return `${date}T${time}${sign}${pad(Math.floor(size / 60))}:${pad(size % 60)}`;
}

/**
 * A `datetime-local` value (`YYYY-MM-DDTHH:MM`) read as a wall time in `timeZone`, as the ISO
 * date-time with that zone's offset a one-time schedule stores; null for an incomplete value or
 * an unknown zone. Daylight-saving changes follow the service's schedules: a wall time a
 * spring-forward change skips moves forward by the gap (02:30 becomes 03:30), and one a fall-back
 * change repeats means its first occurrence.
 */
export function zonedIso(local: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.slice(0, 16));
  if (!match || !isTimeZone(timeZone)) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // The zone's offsets a day before and after: equal unless a change falls in between.
  const before = offsetMinutes(wall - DAY_MS, timeZone);
  const after = offsetMinutes(wall + DAY_MS, timeZone);
  const shows = (instant: number) => zonedLocal(new Date(instant).toISOString(), timeZone);
  const matching = [wall - before * 60_000, wall - after * 60_000]
    .filter((instant) => shows(instant) === local.slice(0, 16))
    .sort((a, b) => a - b);
  // No instant shows the time when a change skipped it: read it with the offset before the
  // change, which lands the same distance past the gap.
  return isoInZone(matching[0] ?? wall - before * 60_000, timeZone);
}

/** An ISO date-time as the `datetime-local` value a clock in `timeZone` shows; '' when unreadable. */
export function zonedLocal(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime()) || !isTimeZone(timeZone)) return '';
  const wall = wallParts(date, timeZone);
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** A schedule's `HH:MM` in the language's clock style, such as "9:00 AM" or "09:00". */
export function formatTimeOfDay(time: string, language: string): string {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return new Intl.DateTimeFormat(language, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
}

/** Week days as cron counts them (0 is Sunday), named in `language`. */
export function weekdayName(day: number, language: string, width: 'short' | 'long'): string {
  // 1 January 2023 was a Sunday.
  return new Intl.DateTimeFormat(language, { weekday: width, timeZone: 'UTC' }).format(
    new Date(Date.UTC(2023, 0, 1 + day)),
  );
}

const WeekInfoSchema = Type.Object({ firstDay: Type.Integer({ minimum: 1, maximum: 7 }) });

/**
 * The week days (cron numbering) in the order the language's calendar lists them: from Monday
 * for Chinese, from Sunday for US English. `Intl.Locale.getWeekInfo` is not in the ES2025 typings
 * yet, so its answer is checked at runtime; a WebKit without it starts the week on Monday (ISO).
 */
export function weekdayOrder(language: string): number[] {
  const locale: object = new Intl.Locale(language);
  const info: unknown =
    'getWeekInfo' in locale && typeof locale.getWeekInfo === 'function'
      ? Reflect.apply(locale.getWeekInfo, locale, [])
      : undefined;
  const first = Value.Check(WeekInfoSchema, info) ? info.firstDay % 7 : 1;
  return Array.from({ length: 7 }, (_, index) => (first + index) % 7);
}

/** Whole days between the calendar dates of two instants on the Mac's clock. */
function calendarDays(from: Date, to: Date): number {
  const day = (date: Date) => {
    const wall = wallParts(date, undefined);
    return Date.UTC(wall.year, wall.month - 1, wall.day) / 86_400_000;
  };
  return day(to) - day(from);
}

/**
 * An instant on the Mac's clock relative to `now`: "today 9:00", "tomorrow 9:00", a week day
 * within a week, else a date (with its year when it is not this year's).
 */
export function formatWhen(iso: string, now: Date, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const days = calendarDays(now, date);
  const time = new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }).format(
    date,
  );
  if (Math.abs(days) <= 1) {
    const day = new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(days, 'day');
    return `${day} ${time}`;
  }
  const day = new Intl.DateTimeFormat(language, {
    ...(Math.abs(days) < 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' }),
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(date);
  return `${day} ${time}`;
}

/** A full date and time in `timeZone` (a one-time schedule's own zone), such as "Wed, Oct 7, 9:00 AM". */
export function formatDateTime(iso: string, language: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(language, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone && isTimeZone(timeZone) ? { timeZone } : {}),
  }).format(date);
}

/** How long a run took, in the largest unit that keeps it readable: "45 sec", "12 min", "1.5 hr". */
export function formatDuration(milliseconds: number, language: string): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const [value, unit] =
    seconds < 60
      ? [seconds, 'second']
      : seconds < 3600
        ? [Math.round(seconds / 60), 'minute']
        : [Math.round(seconds / 360) / 10, 'hour'];
  return new Intl.NumberFormat(language, { style: 'unit', unit, unitDisplay: 'short' }).format(
    value,
  );
}
