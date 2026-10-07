import {
  MAX_AUTOMATIONS,
  type Automation,
  type AutomationAction,
  type AutomationDraft,
  type AutomationStatus,
  type AutomationTrigger,
  type AutomationTriggerProblem,
  type ModelSelection,
  type ServiceCommandFull,
} from '@atd/agent-contracts';
import { CommandStore } from '../commands/store.js';
import { defaultArguments, parameterError, templateReferences } from '../commands/templates.js';
import { readTempCredentials } from '../credentials.js';
import { ConnectionStore } from '../credentials/connections.js';
import type { FolderStore } from '../folders/store.js';
import { findPluginCommand } from '../plugins/commands.js';
import { TEMP_CONNECTION_ID } from '../tasks/run-selection.js';
import { scheduleProblem, validTimeZone } from './schedule.js';

/**
 * What must hold for an automation to be saved and to fire: its trigger resolves, its folders are
 * registered, its model's connection exists, and a command action names an enabled command that
 * can run with nobody present. Saves refuse with a 400 whose message names the problem code;
 * the list reports the same checks as `AutomationStatus.problem` once something changed later.
 */

export interface CheckContext {
  folders: Pick<FolderStore, 'resolve'>;
  /** The saved automations, for chain targets and loops. */
  automations: readonly Automation[];
  lookups: Lookups;
  now: number;
}

/** The saved commands and provider connections, read once per check. */
export interface Lookups {
  command(id: string): Promise<ServiceCommandFull | null>;
  /** Whether a run could get a model: the chosen connection, else a default one or env credentials. */
  modelAvailable(model: ModelSelection | undefined): Promise<boolean>;
}

export function lookups(dataDir: string): Lookups {
  let connections: Promise<ConnectionStore | null> | undefined;
  const commands = new Map<string, Promise<ServiceCommandFull | null>>();
  return {
    command(id) {
      let found = commands.get(id);
      if (!found) {
        found = findCommand(dataDir, id);
        commands.set(id, found);
      }
      return found;
    },
    async modelAvailable(model) {
      connections ??= ConnectionStore.load(dataDir).catch(() => null);
      const store = await connections;
      // A disconnected connection would only fail the run at its start.
      const usable = (id: string | null | undefined) =>
        store?.data.connections.some((item) => item.connectionId === id && item.connected) ?? false;
      const temp = readTempCredentials() !== null;
      if (model)
        return model.connectionId === TEMP_CONNECTION_ID ? temp : usable(model.connectionId);
      return usable(store?.data.defaultConnectionId) || temp;
    },
  };
}

type Problem = NonNullable<AutomationStatus['problem']>;

const PROBLEM_TEXT: Record<Exclude<Problem, 'commandUnavailable'>, string> = {
  invalidExpression:
    'The schedule cannot be read: use a five-field cron expression without "?", or a one-time date and time with an offset.',
  tooFrequent: 'The schedule would run more often than every 15 minutes.',
  invalidTimeZone: 'The time zone is not a known IANA time zone.',
  inPast: 'The one-time run lies in the past.',
  unknownFolder: 'A folder is not registered; choose it again.',
  unknownAutomation: 'The automation it follows does not exist.',
  chainLoop: 'Following that automation would make a chain lead back to this one.',
  folderUnavailable: 'The watched folder cannot be read.',
  modelUnavailable: "The chosen model's provider connection no longer exists.",
};

/** The 400 a save answers: the code in parentheses, then a sentence. */
export function problemError(problem: Problem, detail?: string): TypeError {
  const text =
    problem === 'commandUnavailable'
      ? (detail ?? 'The command cannot run.')
      : PROBLEM_TEXT[problem];
  // The client reads the code in parentheses to word the problem itself; keep this format.
  return new TypeError(`Invalid automation (${problem}): ${text}`);
}

export function folderRegistered(folders: Pick<FolderStore, 'resolve'>, id: string): boolean {
  try {
    folders.resolve([id]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Why `trigger` cannot fire, for the automation `automationId` (absent for a new one). `forSave`
 * adds the checks only a save or preview makes (a one-time run in the past, cron spacing).
 */
export function triggerProblem(
  trigger: AutomationTrigger,
  ctx: CheckContext,
  automationId: string | undefined,
  forSave: boolean,
): AutomationTriggerProblem | undefined {
  switch (trigger.kind) {
    case 'schedule':
      return scheduleProblem(trigger, ctx.now, forSave);
    case 'folder':
      return folderRegistered(ctx.folders, trigger.folderId) ? undefined : 'unknownFolder';
    case 'idle':
      return validTimeZone(trigger.timezone) ? undefined : 'invalidTimeZone';
    case 'automation': {
      if (trigger.automationId === automationId) return 'chainLoop';
      if (!ctx.automations.some((item) => item.id === trigger.automationId))
        return 'unknownAutomation';
      return automationId !== undefined &&
        chainReaches(trigger.automationId, automationId, ctx.automations)
        ? 'chainLoop'
        : undefined;
    }
  }
}

/** Whether following the chain upstream from `start` reaches `target`. */
function chainReaches(start: string, target: string, automations: readonly Automation[]): boolean {
  let current: string | undefined = start;
  for (let step = 0; current !== undefined && step <= MAX_AUTOMATIONS; step += 1) {
    if (current === target) return true;
    const trigger: AutomationTrigger | undefined = automations.find(
      (item) => item.id === current,
    )?.trigger;
    current = trigger?.kind === 'automation' ? trigger.automationId : undefined;
  }
  return false;
}

/** The saved command an action names: the user's own first, then an installed plugin's. */
export async function findCommand(dataDir: string, id: string): Promise<ServiceCommandFull | null> {
  const own = await CommandStore.load(dataDir)
    .then((store) => store.list().find((command) => command.id === id))
    .catch(() => undefined);
  if (own) return own;
  return (await findPluginCommand(dataDir, id).catch(() => null))?.value ?? null;
}

/**
 * Why the command cannot run unattended with the action's values, or undefined. Selection,
 * clipboard and screenshot input need a person at the Mac, and `{{files}}` needs a folder trigger.
 */
export function commandRefusal(
  command: ServiceCommandFull | null,
  action: Extract<AutomationAction, { kind: 'command' }>,
  trigger: AutomationTrigger,
): string | undefined {
  if (!command) return 'The command no longer exists.';
  if (!command.enabled) return 'The command is turned off.';
  const { input } = command;
  if (input.source === 'selection' || input.selection)
    return 'The command reads selected text, which nobody selects while an automation runs.';
  if (input.source === 'clipboard' || input.clipboard)
    return 'The command reads the clipboard, which an automation cannot capture.';
  if (input.source === 'screenshot')
    return 'The command takes a screenshot, which an automation cannot capture.';
  if (input.required && !action.input.trim()) return 'The command needs input text.';
  const references = templateReferences(command.instructions).map((reference) => reference.name);
  if (references.includes('files') && trigger.kind !== 'folder')
    return 'The command needs files, which only a folder trigger hands it.';
  const values = { ...defaultArguments(command), ...action.arguments };
  for (const key of Object.keys(values))
    if (!command.parameters.some((parameter) => parameter.key === key))
      return `The command has no parameter "${key}".`;
  for (const parameter of command.parameters) {
    const error = parameterError(parameter, values[parameter.key]);
    if (error) return error;
  }
  return undefined;
}

/**
 * The model a run really uses: the automation's own pick, else a command's fixed model, else
 * none, which means the default connection's default model at fire time.
 */
export function runModel(
  automation: AutomationDraft,
  command: ServiceCommandFull | null,
): ModelSelection | undefined {
  if (automation.policy.model) return automation.policy.model;
  if (automation.action.kind !== 'command' || command?.model.mode !== 'fixed') return undefined;
  return { connectionId: command.model.connectionId, modelId: command.model.modelId };
}

/**
 * Whether the policy's readable folders are registered. A memory consolidation reads no folder,
 * so the folders it carries are ignored, as its tier, tools and memory switch are.
 */
function policyFoldersRegistered(
  draft: AutomationDraft,
  folders: Pick<FolderStore, 'resolve'>,
): boolean {
  if (draft.action.kind === 'consolidateMemory') return true;
  return draft.policy.folderIds.every((id) => folderRegistered(folders, id));
}

/** Refuses a draft that cannot be saved; `automationId` names the automation an update edits. */
export async function checkDraft(
  draft: AutomationDraft,
  ctx: CheckContext,
  automationId: string | undefined,
): Promise<void> {
  const trigger = triggerProblem(draft.trigger, ctx, automationId, true);
  if (trigger) throw problemError(trigger);
  if (!policyFoldersRegistered(draft, ctx.folders)) throw problemError('unknownFolder');
  if (draft.policy.model && !(await ctx.lookups.modelAvailable(draft.policy.model)))
    throw problemError('modelUnavailable');
  if (draft.action.kind === 'command') {
    const command = await ctx.lookups.command(draft.action.commandId);
    const refusal = commandRefusal(command, draft.action, draft.trigger);
    if (refusal) throw problemError('commandUnavailable', refusal);
  }
}

/**
 * Why a saved automation cannot fire as it is now (`AutomationStatus.problem`): its trigger, a
 * folder, its command or its model no longer resolves. `folderTrouble` is what the last scan of
 * its watched folder found.
 */
export async function firingProblem(
  automation: Automation,
  ctx: CheckContext,
  folderTrouble: boolean,
): Promise<Problem | undefined> {
  const trigger = triggerProblem(automation.trigger, ctx, automation.id, false);
  if (trigger) return trigger;
  if (folderTrouble || !policyFoldersRegistered(automation, ctx.folders))
    return 'folderUnavailable';
  const { action } = automation;
  const command = action.kind === 'command' ? await ctx.lookups.command(action.commandId) : null;
  if (action.kind === 'command' && commandRefusal(command, action, automation.trigger))
    return 'commandUnavailable';
  if (!(await ctx.lookups.modelAvailable(runModel(automation, command)))) return 'modelUnavailable';
  return undefined;
}
