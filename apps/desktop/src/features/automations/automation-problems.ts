import {
  AUTOMATION_MAX_INTERVAL_MINUTES,
  AUTOMATION_MIN_INTERVAL_MINUTES,
  type AutomationDraft,
  type AutomationSchedule,
  type AutomationTrigger,
} from '@atd/agent-contracts';
import type { CommandDefinition } from '../../client/agent/command-schema';
import {
  defaultArguments,
  parameterError,
  templateReferences,
} from '../../client/agent/command-validation';
import { needsPresence, takesInput } from './automation-draft';
import { isTimeZone, zonedLocal } from './automation-time';

/**
 * Why a draft cannot be saved, as data: the editor words each problem under its field. What only
 * the service can judge (a cron expression, a time already past, a chain loop, a folder that is
 * gone) comes from its preview and its answer to the save instead.
 */

/**
 * The editor fields a problem can belong to, in page order; a field shows its problem and names
 * it in `aria-describedby`.
 */
export const AUTOMATION_FIELDS = [
  'name',
  'schedule',
  'timezone',
  'folder',
  'events',
  'patterns',
  'chain',
  'outcomes',
  'prompt',
  'command',
  'input',
  'arguments',
  'folders',
] as const;
export type AutomationField = (typeof AUTOMATION_FIELDS)[number];

export type AutomationProblem =
  | {
      code:
        | 'nameRequired'
        | 'atRequired'
        | 'intervalRange'
        | 'timeRequired'
        | 'daysRequired'
        | 'expressionRequired'
        | 'timeZoneRequired'
        | 'folderRequired'
        | 'eventsRequired'
        | 'patternsInvalid'
        | 'automationRequired'
        | 'outcomesRequired'
        | 'promptRequired'
        | 'commandRequired'
        | 'commandMissing'
        | 'commandNeedsPresence'
        | 'commandOff'
        | 'commandNeedsFiles'
        | 'inputRequired'
        | 'foldersUnavailable';
    }
  | { code: 'argumentsInvalid'; labels: string };

export type AutomationProblems = Partial<Record<AutomationField, AutomationProblem>>;

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
/** Pattern limits of the contract: ten globs of up to a hundred characters. */
const MAX_PATTERNS = 10;
const MAX_PATTERN_LENGTH = 100;

function scheduleProblem(schedule: AutomationSchedule): AutomationProblem | null {
  switch (schedule.kind) {
    case 'once':
      return zonedLocal(schedule.at, 'UTC') ? null : { code: 'atRequired' };
    case 'interval':
      return Number.isInteger(schedule.everyMinutes) &&
        schedule.everyMinutes >= AUTOMATION_MIN_INTERVAL_MINUTES &&
        schedule.everyMinutes <= AUTOMATION_MAX_INTERVAL_MINUTES
        ? null
        : { code: 'intervalRange' };
    case 'daily':
    case 'monthly':
      return TIME.test(schedule.time) ? null : { code: 'timeRequired' };
    case 'weekly':
      if (!schedule.days.length) return { code: 'daysRequired' };
      return TIME.test(schedule.time) ? null : { code: 'timeRequired' };
    case 'cron':
      return schedule.expression.trim().split(/\s+/).length === 5
        ? null
        : { code: 'expressionRequired' };
  }
}

function triggerProblems(trigger: AutomationDraft['trigger']): AutomationProblems {
  switch (trigger.kind) {
    case 'schedule': {
      const schedule = scheduleProblem(trigger.schedule);
      return {
        ...(schedule ? { schedule } : {}),
        ...(isTimeZone(trigger.timezone) ? {} : { timezone: { code: 'timeZoneRequired' } }),
      };
    }
    case 'folder':
      return {
        ...(trigger.folderId ? {} : { folder: { code: 'folderRequired' } }),
        ...(trigger.events.length ? {} : { events: { code: 'eventsRequired' } }),
        ...(trigger.patterns.length > MAX_PATTERNS ||
        trigger.patterns.some((pattern) => pattern.length > MAX_PATTERN_LENGTH)
          ? { patterns: { code: 'patternsInvalid' } }
          : {}),
      };
    case 'idle':
      // The idle time comes from a list of allowed values, so only the zone can be wrong.
      return isTimeZone(trigger.timezone) ? {} : { timezone: { code: 'timeZoneRequired' } };
    case 'automation':
      return {
        ...(trigger.automationId ? {} : { chain: { code: 'automationRequired' } }),
        ...(trigger.outcomes.length ? {} : { outcomes: { code: 'outcomesRequired' } }),
      };
  }
}

/** Whether the command's template uses `{{files}}`, which only a folder trigger fills. */
function readsFiles(command: CommandDefinition): boolean {
  try {
    return templateReferences(command.instructions).some(({ name }) => name === 'files');
  } catch {
    // A saved command's template parses; one that does not is the command editor's to report.
    return false;
  }
}

/**
 * Why `command` cannot run in this automation as it stands, as the service refuses it on save:
 * it is gone, it needs a person (the selection, the clipboard, a screenshot), it is turned off,
 * or it works on files that only a folder trigger hands it. Null when it can run.
 */
export function commandProblem(
  command: CommandDefinition | undefined,
  trigger: AutomationTrigger,
): AutomationProblem | null {
  if (!command) return { code: 'commandMissing' };
  if (needsPresence(command)) return { code: 'commandNeedsPresence' };
  if (!command.enabled) return { code: 'commandOff' };
  if (readsFiles(command) && trigger.kind !== 'folder') return { code: 'commandNeedsFiles' };
  return null;
}

function actionProblems(
  { action, trigger }: AutomationDraft,
  commands: readonly CommandDefinition[],
): AutomationProblems {
  // Consolidating memory has nothing to fill in.
  if (action.kind === 'consolidateMemory') return {};
  if (action.kind === 'prompt')
    return action.prompt.trim() ? {} : { prompt: { code: 'promptRequired' } };
  if (!action.commandId) return { command: { code: 'commandRequired' } };
  const command = commands.find((item) => item.id === action.commandId);
  if (!command) return { command: { code: 'commandMissing' } };
  const problem = commandProblem(command, trigger);
  if (problem) return { command: problem };
  // A run fills parameters the automation leaves out with the command's defaults.
  const values = { ...defaultArguments(command), ...action.arguments };
  const invalid = command.parameters.filter((parameter) =>
    parameterError(parameter, values[parameter.key]),
  );
  return {
    ...(takesInput(command) && command.input.required && !action.input.trim()
      ? { input: { code: 'inputRequired' } }
      : {}),
    ...(invalid.length
      ? {
          arguments: {
            code: 'argumentsInvalid',
            labels: invalid.map((parameter) => parameter.label).join(', '),
          },
        }
      : {}),
  };
}

/**
 * Every problem of `draft`, in the order the editor shows its fields. `folderName` names a
 * registered folder and is undefined for one that is no longer registered, which the service
 * would refuse among the folders runs may read. (A watched folder's is the preview's to report.)
 */
export function draftProblems(
  draft: AutomationDraft,
  commands: readonly CommandDefinition[],
  folderName: (folderId: string) => string | undefined,
): AutomationProblems {
  return {
    ...(draft.name.trim() ? {} : { name: { code: 'nameRequired' } }),
    ...triggerProblems(draft.trigger),
    ...actionProblems(draft, commands),
    ...(draft.policy.folderIds.every((id) => folderName(id) !== undefined)
      ? {}
      : { folders: { code: 'foldersUnavailable' } }),
  };
}
