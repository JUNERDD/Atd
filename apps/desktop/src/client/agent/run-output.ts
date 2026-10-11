import type { Static } from 'typebox';
import {
  actsOnSelection,
  readsSelection,
  writesBack,
  type CommandOutputAction,
} from '@atd/agent-contracts';
import type { CommandOutputOptionSchema } from '../../native-bridge/command-options';
import type { PreparedCommand } from './bridge';
import type { CommandDefinition } from './command-schema';

/** Where a run's answer goes, as the shell offers it beside a command's options. */
export type CommandOutputOption = Static<typeof CommandOutputOptionSchema>;

/**
 * The actions in the order every picker lists them, in groups divided by separators: the
 * conversation, the write-backs into the app the command ran from, then the clipboard.
 */
export const OUTPUT_ACTION_GROUPS: readonly (readonly CommandOutputAction[])[] = [
  ['panel'],
  ['replaceSelection', 'insertAfterSelection', 'insertAtCursor'],
  ['copy'],
];
export const OUTPUT_ACTIONS: readonly CommandOutputAction[] = OUTPUT_ACTION_GROUPS.flat();

/**
 * Why a run of `prepared` cannot send its answer where `action` says, or null when it can: the
 * actions on the selection need a command that reads it (`selection`), and every write-back needs
 * the app the command ran from (`target`), which only a launch from another app records.
 */
export function outputUnavailable(
  prepared: Pick<PreparedCommand, 'command' | 'target'>,
  action: CommandOutputAction,
): 'selection' | 'target' | null {
  if (actsOnSelection(action) && !readsSelection(prepared.command.input)) return 'selection';
  if (writesBack(action) && !prepared.target) return 'target';
  return null;
}

/**
 * `prepared` with its answer going where `action` says for this run, keeping the command's review
 * setting. An action the run cannot use (`outputUnavailable`), or none, leaves it as it was, so a
 * pick that crossed the shell boundary can never point the answer somewhere it cannot go.
 */
export function withOutputAction(
  prepared: PreparedCommand,
  action: CommandOutputAction | undefined,
): PreparedCommand {
  if (!action || action === prepared.output.action || outputUnavailable(prepared, action))
    return prepared;
  return { ...prepared, output: { ...prepared.output, action } };
}

/**
 * Where the answer of a run of `command` goes as the shell offers it: `value` for this run, the
 * command's saved action as the default it marks, and whether the command reads the selection
 * (without it the shell leaves out the actions on the selection).
 */
export function outputOption(
  command: CommandDefinition,
  value: CommandOutputAction = command.output.action,
): CommandOutputOption {
  return { value, saved: command.output.action, selection: readsSelection(command.input) };
}
