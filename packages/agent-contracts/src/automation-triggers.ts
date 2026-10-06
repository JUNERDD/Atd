import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';

/**
 * Automation triggers (docs/plans/2026-10-06-automations.md). A trigger only says when an
 * automation fires; the service owns the one schedule implementation, so clients ask it for the
 * next run times (`POST /v1/automations/preview`) instead of computing them.
 */

/** Recurring schedules never fire more often than this: every run is a full agent task. */
export const AUTOMATION_MIN_INTERVAL_MINUTES = 15;
/** The longest fixed interval, one week. */
export const AUTOMATION_MAX_INTERVAL_MINUTES = 10080;
/** How many levels below a watched folder a recursive folder trigger looks. */
export const AUTOMATION_FOLDER_MAX_DEPTH = 4;
/** A watched folder holding more matching files than this is not watched; the trigger reports it. */
export const AUTOMATION_FOLDER_MAX_FILES = 10000;
/** Files one folder run is given; more changes wait for the next run. */
export const AUTOMATION_FOLDER_FILES_PER_RUN = 20;

/** Wall-clock time of day in the trigger's time zone, 24-hour `HH:MM`. */
export const AutomationTimeOfDaySchema = Type.String({
  pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$',
});

/** Day of the week as cron counts it: 0 is Sunday, 6 is Saturday. Clients order days by locale. */
export const AutomationWeekdaySchema = Type.Integer({ minimum: 0, maximum: 6 });

/**
 * When a schedule trigger fires. Presets cover the common cases so nobody has to read cron;
 * `cron` is the escape hatch, a standard five-field expression that may not fire more often than
 * the minimum interval. Times are wall-clock times in the trigger's time zone, so a daily 09:00
 * stays 09:00 across daylight-saving changes. `interval` counts from the automation's last run,
 * or from when it was turned on.
 */
export const AutomationScheduleSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('once'),
      /** ISO 8601 date-time with an offset, such as `2026-10-07T09:00:00+08:00`. */
      at: Type.String({ minLength: 1, maxLength: 64 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('interval'),
      everyMinutes: Type.Integer({
        minimum: AUTOMATION_MIN_INTERVAL_MINUTES,
        maximum: AUTOMATION_MAX_INTERVAL_MINUTES,
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('daily'), time: AutomationTimeOfDaySchema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('weekly'),
      days: Type.Array(AutomationWeekdaySchema, { minItems: 1, maxItems: 7, uniqueItems: true }),
      time: AutomationTimeOfDaySchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('monthly'),
      /** Day of the month; `last` follows month length. Days 29–31 are not offered. */
      day: Type.Union([Type.Integer({ minimum: 1, maximum: 28 }), Type.Literal('last')]),
      time: AutomationTimeOfDaySchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('cron'),
      /** Minute, hour, day of month, month, day of week. */
      expression: Type.String({ minLength: 9, maxLength: 120 }),
    },
    { additionalProperties: false },
  ),
]);
export type AutomationSchedule = Static<typeof AutomationScheduleSchema>;

/** A file that appeared in the watched folder, or one whose content changed. */
export const AutomationFolderEventSchema = Type.Union([
  Type.Literal('added'),
  Type.Literal('changed'),
]);
export type AutomationFolderEvent = Static<typeof AutomationFolderEventSchema>;

/**
 * How a finished automation run turned out, as far as other automations and notifications care:
 * it had a result to read, it found nothing new, it needed a person (declined actions or
 * unanswered questions), or it failed (including running out of time).
 */
export const AutomationResultSchema = Type.Union([
  Type.Literal('delivered'),
  Type.Literal('nothingNew'),
  Type.Literal('needsAttention'),
  Type.Literal('failed'),
]);
export type AutomationResult = Static<typeof AutomationResultSchema>;

export const AutomationTriggerSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('schedule'),
      schedule: AutomationScheduleSchema,
      /** IANA time zone the schedule's wall-clock times are read in, such as `Asia/Shanghai`. */
      timezone: Type.String({ minLength: 1, maxLength: 64 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('folder'),
      /**
       * A registered folder (`/v1/folders/register`, shell only), so the model can never name a
       * path to watch. Each run of the automation may read it.
       */
      folderId: Identifier,
      events: Type.Array(AutomationFolderEventSchema, {
        minItems: 1,
        maxItems: 2,
        uniqueItems: true,
      }),
      /**
       * File-name globs such as `*.pdf` or `invoice-*.{png,jpg}`, matched case-insensitively against
       * base names. Empty matches every file. Hidden files and partial downloads never match.
       */
      patterns: Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 10 }),
      /** Whether files in subfolders count, down to `AUTOMATION_FOLDER_MAX_DEPTH` levels. */
      recursive: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('automation'),
      /**
       * The automation whose finished runs fire this one: never this automation itself, and no
       * chain of automations may lead back to it.
       */
      automationId: Identifier,
      /** Which results of that automation fire this one; `failed` includes timed-out runs. */
      outcomes: Type.Array(AutomationResultSchema, { minItems: 1, maxItems: 4, uniqueItems: true }),
    },
    { additionalProperties: false },
  ),
]);
export type AutomationTrigger = Static<typeof AutomationTriggerSchema>;

/**
 * Why a trigger cannot be saved or previewed, for the client's own wording: a cron expression the
 * service cannot read, a schedule that fires more often than the minimum interval, an unknown
 * time zone, a one-time run in the past, a folder that is no longer registered, a chained
 * automation that does not exist, or a chain that would loop.
 */
export const AutomationTriggerProblemSchema = Type.Union([
  Type.Literal('invalidExpression'),
  Type.Literal('tooFrequent'),
  Type.Literal('invalidTimeZone'),
  Type.Literal('inPast'),
  Type.Literal('unknownFolder'),
  Type.Literal('unknownAutomation'),
  Type.Literal('chainLoop'),
]);
export type AutomationTriggerProblem = Static<typeof AutomationTriggerProblemSchema>;
