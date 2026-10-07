import type { TFunction } from 'i18next';
import type {
  AutomationItem,
  AutomationOutcome,
  AutomationResult,
  AutomationRun,
  AutomationRunReason,
  AutomationSchedule,
  AutomationStatus,
  AutomationTrigger,
  AutomationTriggerProblem,
} from '@atd/agent-contracts';
import { AutomationProblemError } from '../../client/automations-contract';
import { messageOf } from '../../lib/errors';
import {
  formatDateTime,
  formatTimeOfDay,
  systemTimeZone,
  weekdayName,
  weekdayOrder,
  zoneName,
} from './automation-time';

/**
 * Automations in plain words: a trigger as a sentence ("Every weekday at 9:00"), outcomes,
 * reasons and problems. People never read cron here: a custom schedule shows its expression, and
 * the service's next run time says what it means.
 */

type Translate = TFunction<'automations'>;

/** The results a chain can follow, in the order the editor lists them. */
export const AUTOMATION_RESULTS: readonly AutomationResult[] = [
  'delivered',
  'nothingNew',
  'needsAttention',
  'failed',
];

const WEEKDAYS = [1, 2, 3, 4, 5];

/** An interval in its largest whole unit; one hour and one day read on their own. */
function intervalWords(minutes: number, t: Translate): string {
  if (minutes % 1440 === 0) {
    const n = minutes / 1440;
    return n === 1 ? t('summary.everyDay') : t('summary.everyDays', { n });
  }
  if (minutes % 60 === 0) {
    const n = minutes / 60;
    return n === 1 ? t('summary.hourly') : t('summary.everyHours', { n });
  }
  return t('summary.everyMinutes', { n: minutes });
}

/** A length of time in whole hours when it is one, such as "15 minutes" or "2 hours". */
export function minutesWords(minutes: number, t: Translate): string {
  return minutes % 60 === 0
    ? t('policy.hours', { count: minutes / 60 })
    : t('policy.minutes', { count: minutes });
}

/** The chosen week days named in the language's week order, such as "Mon, Wed and Fri". */
export function daysWords(days: readonly number[], language: string): string {
  const names = weekdayOrder(language)
    .filter((day) => days.includes(day))
    .map((day) => weekdayName(day, language, 'short'));
  return new Intl.ListFormat(language, { style: 'short', type: 'conjunction' }).format(names);
}

function scheduleWords(
  schedule: AutomationSchedule,
  timezone: string,
  t: Translate,
  language: string,
): string {
  switch (schedule.kind) {
    case 'once':
      return t('summary.once', { when: formatDateTime(schedule.at, language, timezone) });
    case 'interval':
      return intervalWords(schedule.everyMinutes, t);
    case 'daily':
      return t('summary.daily', { time: formatTimeOfDay(schedule.time, language) });
    case 'weekly': {
      const time = formatTimeOfDay(schedule.time, language);
      const days = new Set(schedule.days);
      if (days.size === 7) return t('summary.daily', { time });
      if (days.size === 5 && WEEKDAYS.every((day) => days.has(day)))
        return t('summary.weekdays', { time });
      if (days.size === 2 && days.has(0) && days.has(6)) return t('summary.weekends', { time });
      return t('summary.weekly', { days: daysWords(schedule.days, language), time });
    }
    case 'monthly': {
      const time = formatTimeOfDay(schedule.time, language);
      return schedule.day === 'last'
        ? t('summary.monthlyLast', { time })
        : t('summary.monthly', { day: schedule.day, time });
    }
    case 'cron':
      return t('summary.cron', { expression: schedule.expression });
  }
}

/** What a summary needs to name the things a trigger points at. */
export interface TriggerNames {
  /** A folder's name; undefined once the folder is no longer registered. */
  folder: (folderId: string) => string | undefined;
  /** An automation's name; undefined once it was deleted. */
  automation: (automationId: string) => string | undefined;
}

/**
 * A folder's name as the automations' statuses report it (`AutomationStatus.folders`, which
 * names every folder an automation uses). Folder ids are the same wherever a folder is used, so
 * any automation that names it will do; undefined when none does, because the folder is no
 * longer registered.
 */
export function folderNameOf(
  automations: readonly AutomationItem[] | null,
  folderId: string,
): string | undefined {
  for (const { status } of automations ?? []) {
    const name = status.folders.find(({ id }) => id === folderId)?.name;
    if (name) return name;
  }
  return undefined;
}

/** The names a summary takes from the automation list: the folders and automations it names. */
export function triggerNames(automations: readonly AutomationItem[] | null): TriggerNames {
  return {
    folder: (id) => folderNameOf(automations, id),
    automation: (id) =>
      automations?.find(({ automation }) => automation.id === id)?.automation.name,
  };
}

/** A sentence with the trigger's time zone added when it is not the Mac's. */
function inZone(words: string, timezone: string, t: Translate, language: string): string {
  return timezone === systemTimeZone()
    ? words
    : t('summary.inZone', { schedule: words, zone: zoneName(timezone, language) });
}

/** A trigger as one sentence, with its time zone when it is not the Mac's. */
export function triggerWords(
  trigger: AutomationTrigger,
  names: TriggerNames,
  t: Translate,
  language: string,
): string {
  switch (trigger.kind) {
    case 'schedule':
      return inZone(
        scheduleWords(trigger.schedule, trigger.timezone, t, language),
        trigger.timezone,
        t,
        language,
      );
    case 'idle':
      return inZone(
        t('summary.idle', { duration: minutesWords(trigger.idleMinutes, t) }),
        trigger.timezone,
        t,
        language,
      );
    case 'folder': {
      const folder = names.folder(trigger.folderId);
      const added = trigger.events.includes('added');
      const changed = trigger.events.includes('changed');
      // A folder that is gone gets whole sentences: its stand-in phrase is not a name, so it must
      // not take the spacing a name gets in Chinese.
      const words = folder
        ? added && changed
          ? t('summary.folderAny', { folder })
          : changed
            ? t('summary.folderChanged', { folder })
            : t('summary.folderAdded', { folder })
        : added && changed
          ? t('summary.folderGoneAny')
          : changed
            ? t('summary.folderGoneChanged')
            : t('summary.folderGoneAdded');
      if (!trigger.patterns.length) return words;
      const patterns = new Intl.ListFormat(language, { type: 'disjunction' }).format(
        trigger.patterns,
      );
      return t('summary.matching', { trigger: words, patterns });
    }
    case 'automation': {
      const name = names.automation(trigger.automationId) ?? t('summary.deletedAutomation');
      if (AUTOMATION_RESULTS.every((result) => trigger.outcomes.includes(result)))
        return t('summary.chainAny', { name });
      const outcomes = new Intl.ListFormat(language, { type: 'disjunction' }).format(
        AUTOMATION_RESULTS.filter((result) => trigger.outcomes.includes(result)).map((result) =>
          t(`chain.outcome.${result}.phrase`),
        ),
      );
      return t('summary.chain', { name, outcomes });
    }
  }
}

/** How a run or its record turned out, in a word or two. */
export function outcomeWords(outcome: AutomationOutcome, t: Translate): string {
  return t(`outcome.${outcome}`);
}

/**
 * The tone an outcome reads in: a result in the progress green, attention in the warning amber,
 * failures in the destructive red, the rest muted.
 */
export function outcomeTone(outcome: AutomationOutcome): 'progress' | 'warning' | 'error' | null {
  switch (outcome) {
    case 'delivered':
      return 'progress';
    case 'needsAttention':
      return 'warning';
    case 'failed':
    case 'timedOut':
      return 'error';
    case 'running':
    case 'nothingNew':
    case 'stopped':
    case 'interrupted':
    case 'skipped':
      return null;
  }
}

/** Whether the person has yet to open a finished run's result; a running run has none yet. */
export function isUnread(run: AutomationRun): boolean {
  return run.outcome !== 'running' && !run.readAt;
}

/** Why a run was skipped or failed, as a sentence. */
export function reasonWords(reason: AutomationRunReason, t: Translate): string {
  return t(`reason.${reason}`);
}

/** Why an automation cannot run as saved, or why its edited trigger cannot be saved. */
export function problemWords(
  problem: NonNullable<AutomationStatus['problem']> | AutomationTriggerProblem,
  t: Translate,
): string {
  return t(`problem.${problem}`);
}

/**
 * A failed automation request as the person reads it: a problem the service named by code in
 * the app's language, anything else as the error says.
 */
export function failureWords(error: unknown, t: Translate): string {
  return error instanceof AutomationProblemError
    ? problemWords(error.problem, t)
    : messageOf(error);
}

/**
 * Why Run now cannot start the automation, as its tooltip says: the saved automations cannot be
 * read, a run is in progress, or the automation cannot run as saved. Null when it can run.
 */
export function runBlockWords(
  status: AutomationStatus,
  unavailable: boolean,
  t: Translate,
): string | null {
  if (unavailable) return t('list.runUnavailable');
  if (status.running) return t('list.runRunning');
  if (status.problem) return t('list.runProblem');
  return null;
}
