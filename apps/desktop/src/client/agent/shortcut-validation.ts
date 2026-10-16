import {
  actsOnSelection,
  commandShortcutHolder,
  parseAccelerator,
  readsSelection,
  type CommandShortcut,
  type SelectionToolbarGesture,
  type ShortcutBindingsWire,
  type ShortcutHolder,
} from '@atd/agent-contracts';
import type { CommandDefinition } from './command-schema';
import { parameterError } from './command-validation';

/**
 * Why one of a command's shortcuts cannot be saved, as data: the editor translates it and shows
 * it on the shortcut's row. The service checks the same rules again on save, in English.
 * - `invalidKeys`: the keys are not a combination the shell can register;
 * - `conflict`: an app action, the selection toolbar's double-tap or another enabled command's
 *   shortcut (this command's other shortcuts included) already presses them;
 * - `pinnedValue`: a pinned value is no longer one the parameter takes, or the parameter is gone
 *   (`label` is its label, else its key);
 * - `outputUnavailable`: the result override acts on the selection, which the command no longer
 *   reads.
 */
export type ShortcutProblem =
  | { code: 'invalidKeys' }
  | { code: 'conflict'; holder: ShortcutHolder }
  | { code: 'pinnedValue'; params: { label: string } }
  | { code: 'outputUnavailable' };

/** What a shortcut's keys are checked against: everything else that registers keys. */
export interface ShortcutContext {
  appShortcuts: ShortcutBindingsWire;
  /** The saved commands; the command being checked replaces its saved version. */
  commands: readonly CommandDefinition[];
  platform: string;
  selectionToolbar: SelectionToolbarGesture;
}

/** `commands` with `command` as it is about to be saved, in place of its saved version. */
function withDraft(commands: readonly CommandDefinition[], command: CommandDefinition) {
  const others = commands.filter((item) => item.id !== command.id);
  return [...others, command];
}

function keysProblem(
  command: CommandDefinition,
  shortcut: CommandShortcut,
  context: ShortcutContext,
): ShortcutProblem | null {
  if (!shortcut.accelerator) return null;
  try {
    // The shell registers command shortcuts globally, so one may be a modifier's double-tap.
    parseAccelerator(shortcut.accelerator, true, 'darwin', { allowDoubleTap: true });
  } catch {
    return { code: 'invalidKeys' };
  }
  // Disabled commands retain their keys but do not register them with the shell.
  if (!command.enabled) return null;
  const holder = commandShortcutHolder(
    shortcut,
    context.appShortcuts,
    withDraft(context.commands, command),
    context.platform,
    context.selectionToolbar,
  );
  return holder ? { code: 'conflict', holder } : null;
}

function settingsProblem(
  command: CommandDefinition,
  shortcut: CommandShortcut,
): ShortcutProblem | null {
  for (const [key, value] of Object.entries(shortcut.arguments)) {
    const parameter = command.parameters.find((item) => item.key === key);
    if (!parameter || parameterError(parameter, value))
      return { code: 'pinnedValue', params: { label: parameter?.label ?? key } };
  }
  if (shortcut.output && actsOnSelection(shortcut.output.action) && !readsSelection(command.input))
    return { code: 'outputUnavailable' };
  return null;
}

/**
 * The first problem of `shortcut` as part of `command` (which should already hold it), or null.
 * Keys come first: they are what the row shows, and a conflict is the likeliest problem.
 */
export function shortcutProblem(
  command: CommandDefinition,
  shortcut: CommandShortcut,
  context: ShortcutContext,
): ShortcutProblem | null {
  return keysProblem(command, shortcut, context) ?? settingsProblem(command, shortcut);
}

/** Each of the command's shortcuts that cannot be saved, keyed by shortcut id. */
export function shortcutProblems(
  command: CommandDefinition,
  context: ShortcutContext,
): Record<string, ShortcutProblem> {
  const problems: Record<string, ShortcutProblem> = {};
  for (const shortcut of command.shortcuts) {
    const problem = shortcutProblem(command, shortcut, context);
    if (problem) problems[shortcut.id] = problem;
  }
  return problems;
}
