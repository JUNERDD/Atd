import {
  snapshotToolsFor,
  type Automation,
  type AutomationAction,
  type AutomationDraft,
  type AutomationPolicy,
  type AutomationSchedule,
  type AutomationTrigger,
  type CommandTool,
} from '@atd/agent-contracts';
import type { CommandDefinition } from '../../client/agent/command-schema';
import { defaultArguments } from '../../client/agent/command-validation';
import { systemTimeZone, zonedIso, zonedLocal } from './automation-time';

/**
 * The editor's drafts: what a new, copied or command-started automation begins with, and how a
 * kind switch keeps what still applies. The service validates every save; these only shape it.
 */

export type TriggerKind = AutomationTrigger['kind'];
export type ScheduleKind = AutomationSchedule['kind'];
export type ActionKind = AutomationAction['kind'];
export type CommandAction = Extract<AutomationAction, { kind: 'command' }>;

/**
 * Applies a change to the draft as it is when the change lands, not as it was when it began: a
 * folder pick answers after the person may have edited other fields meanwhile.
 */
export type DraftPatch = (update: (draft: AutomationDraft) => AutomationDraft) => void;

/** The longest name the contract accepts. */
const MAX_NAME_LENGTH = 120;

/** The tools a prompt run can be given, in the order the editor lists them. */
export const PROMPT_TOOLS: readonly CommandTool[] = ['read', 'write', 'edit', 'bash', 'command'];
/** A new prompt automation reads and edits files, without the terminal or command changes. */
const DEFAULT_TOOLS: readonly CommandTool[] = ['read', 'write', 'edit'];

const DEFAULT_TIME = '09:00';

/** A command run uses the command's own tools, so its policy names none. */
const COMMAND_POLICY: AutomationPolicy = {
  // Nobody approves an unattended run: under `auto` the review lets safe actions through (web
  // reads, the task's own folder) and anything it would ask about is declined, while `manual`
  // would decline every guarded action, web search included.
  permissionTier: 'auto',
  memory: true,
  folderIds: [],
  maxDurationMinutes: 30,
  missedRuns: 'runOnce',
};
const PROMPT_POLICY: AutomationPolicy = {
  ...COMMAND_POLICY,
  tools: snapshotToolsFor(DEFAULT_TOOLS),
};

/** Tomorrow at nine on the zone's clock, the first offer of a one-time schedule. */
function tomorrowMorning(timezone: string): string {
  const [date = ''] = zonedLocal(new Date(Date.now() + 86_400_000).toISOString(), timezone).split(
    'T',
  );
  return zonedIso(`${date}T${DEFAULT_TIME}`, timezone) ?? '';
}

/** The schedule a repeat choice starts with; daily, weekly and monthly keep the time already set. */
export function defaultSchedule(
  kind: ScheduleKind,
  timezone: string,
  previous?: AutomationSchedule,
): AutomationSchedule {
  const time = previous && 'time' in previous ? previous.time : DEFAULT_TIME;
  switch (kind) {
    case 'once':
      return { kind, at: tomorrowMorning(timezone) };
    case 'interval':
      return { kind, everyMinutes: 60 };
    case 'daily':
      return { kind, time };
    case 'weekly':
      return { kind, days: [1, 2, 3, 4, 5], time };
    case 'monthly':
      return { kind, day: 1, time };
    case 'cron':
      return { kind, expression: '0 9 * * 1-5' };
  }
}

/** The trigger a kind switch starts with. A schedule's zone is the Mac's when it is made. */
export function defaultTrigger(kind: TriggerKind): AutomationTrigger {
  switch (kind) {
    case 'schedule': {
      const timezone = systemTimeZone();
      return { kind, schedule: defaultSchedule('daily', timezone), timezone };
    }
    case 'folder':
      return { kind, folderId: '', events: ['added'], patterns: [], recursive: false };
    case 'automation':
      return { kind, automationId: '', outcomes: ['delivered'] };
  }
}

export function defaultAction(kind: ActionKind): AutomationAction {
  switch (kind) {
    case 'prompt':
      return { kind, prompt: '' };
    case 'command':
      return { kind, commandId: '', arguments: {}, input: '' };
  }
}

/** A new automation: a prompt every day at nine, read-only unless the person allows more. */
export function newDraft(): AutomationDraft {
  return {
    name: '',
    enabled: true,
    trigger: defaultTrigger('schedule'),
    action: defaultAction('prompt'),
    policy: { ...PROMPT_POLICY },
    delivery: { notify: 'whenNew', includePreviousResult: true },
  };
}

/** The command's action with its default parameter values, which its run would take anyway. */
export function commandAction(command: CommandDefinition): CommandAction {
  return {
    kind: 'command',
    commandId: command.id,
    arguments: defaultArguments(command),
    input: '',
  };
}

/** Whether a command's runs use memory: its own setting, as its runs from the panel do. */
export function commandMemory(command: CommandDefinition): boolean {
  return command.memory !== 'off';
}

/** "Automate…" on a command: a new automation that runs it, named after it, with its memory. */
export function draftFromCommand(command: CommandDefinition): AutomationDraft {
  return {
    ...newDraft(),
    name: command.name,
    action: commandAction(command),
    policy: { ...COMMAND_POLICY, memory: commandMemory(command) },
  };
}

/** The fields a person edits, from a saved automation. */
export function draftOf(automation: Automation): AutomationDraft {
  const { name, enabled, trigger, action, policy, delivery } = automation;
  return structuredClone({ name, enabled, trigger, action, policy, delivery });
}

/**
 * A copy to save as a new automation, named by `format` (" copy" after the name, in the app's
 * language) within the contract's length: a long name is cut, whole characters only, before the
 * suffix. It starts off, so the copy and its original never fire together before it is changed.
 */
export function copyDraft(
  automation: Automation,
  format: (name: string) => string,
): AutomationDraft {
  const room = MAX_NAME_LENGTH - format('').length;
  let base = '';
  for (const character of automation.name) {
    if (base.length + character.length > room) break;
    base += character;
  }
  return { ...draftOf(automation), name: format(base.trimEnd()), enabled: false };
}

/**
 * The draft as it is saved: a command action keeps only the values of parameters its command has
 * now. Values left from a parameter the command dropped show nowhere, and the service refuses them.
 */
export function savedDraft(
  draft: AutomationDraft,
  commands: readonly CommandDefinition[],
): AutomationDraft {
  const { action } = draft;
  if (action.kind !== 'command') return draft;
  const command = commands.find(({ id }) => id === action.commandId);
  if (!command) return draft;
  const keys = new Set(command.parameters.map(({ key }) => key));
  const values = Object.fromEntries(
    Object.entries(action.arguments).filter(([key]) => keys.has(key)),
  );
  return { ...draft, action: { ...action, arguments: values } };
}

/**
 * Whether turning `automation` on needs a new time first: a one-time schedule whose time has
 * passed, because its run is done or it was off when the time came. The service refuses it.
 */
export function needsNewTime(automation: Automation, now = Date.now()): boolean {
  const { trigger } = automation;
  return (
    trigger.kind === 'schedule' &&
    trigger.schedule.kind === 'once' &&
    !(Date.parse(trigger.schedule.at) > now)
  );
}

/** Whether a command reads something only a person can give: the selection, clipboard or screen. */
export function needsPresence(command: CommandDefinition): boolean {
  const { source, selection, clipboard } = command.input;
  return (
    source === 'selection' ||
    source === 'clipboard' ||
    source === 'screenshot' ||
    selection ||
    clipboard
  );
}

/** Whether the command's run takes the automation's input text. */
export function takesInput(command: CommandDefinition): boolean {
  return command.input.source === 'manual';
}

/** Splits the patterns field on commas outside braces, so `*.{png,jpg}` stays one pattern. */
export function splitPatterns(text: string): string[] {
  const patterns: string[] = [];
  let current = '';
  let depth = 0;
  for (const character of text) {
    if (character === '{') depth += 1;
    else if (character === '}') depth = Math.max(0, depth - 1);
    if (character === ',' && depth === 0) {
      patterns.push(current);
      current = '';
    } else current += character;
  }
  patterns.push(current);
  return patterns.map((pattern) => pattern.trim()).filter(Boolean);
}

/** The prompt tools a policy grants, as the editor's switches show them. */
export function chosenTools(policy: AutomationPolicy): CommandTool[] {
  const tools = policy.tools ?? snapshotToolsFor(DEFAULT_TOOLS);
  return PROMPT_TOOLS.filter((tool) => tools.includes(tool));
}

/** A policy granting exactly `tools` (with the search tools reading brings). */
export function withTools(
  policy: AutomationPolicy,
  tools: readonly CommandTool[],
): AutomationPolicy {
  return {
    ...policy,
    tools: snapshotToolsFor(PROMPT_TOOLS.filter((tool) => tools.includes(tool))),
  };
}

const sorted = <T extends string | number>(values: readonly T[]) =>
  [...values].sort((a, b) => String(a).localeCompare(String(b)));

/**
 * A draft as the unsaved-changes check compares it: lists that are sets (tools, folders, days,
 * events, results) compare without their order.
 */
export function comparable(draft: AutomationDraft): string {
  const { trigger, policy } = draft;
  return JSON.stringify({
    ...draft,
    policy: {
      ...policy,
      folderIds: sorted(policy.folderIds),
      ...(policy.tools ? { tools: sorted(policy.tools) } : {}),
    },
    trigger:
      trigger.kind === 'folder'
        ? { ...trigger, events: sorted(trigger.events) }
        : trigger.kind === 'automation'
          ? { ...trigger, outcomes: sorted(trigger.outcomes) }
          : trigger.schedule.kind === 'weekly'
            ? { ...trigger, schedule: { ...trigger.schedule, days: sorted(trigger.schedule.days) } }
            : trigger,
  });
}
