import { CommandInputSchema, defaultCommandPlacement } from '@atd/agent-contracts';
import { Value } from 'typebox/value';

/**
 * A command stored before placements existed has none, and one stored before a place existed has
 * no choice for it: each missing choice takes the default of its input source
 * (`defaultCommandPlacement`), so the command shows where it always did, and in a new place
 * exactly when a new command with its input would. Text in a screenshot is the exception: it
 * offers the same commands as the selection toolbar over other apps, so a command that chose that
 * toolbar's place keeps the choice there too. The choices it made stay. Idempotent, and the same
 * object when nothing is missing, or when its input or placement does not read as one, which the
 * full parse reports when the command is read.
 */
export function withPlacement<T extends object>(command: T): T {
  if (!('input' in command) || !Value.Check(CommandInputSchema, command.input)) return command;
  const defaults = defaultCommandPlacement(command.input.source);
  if (!('placement' in command)) return { ...command, placement: defaults };
  const { placement } = command;
  if (typeof placement !== 'object' || placement === null || Array.isArray(placement))
    return command;
  if (Object.keys(defaults).every((place) => place in placement)) return command;
  const chosen = 'selectionToolbar' in placement ? placement.selectionToolbar : undefined;
  const inherited = typeof chosen === 'boolean' ? { screenshotText: chosen } : {};
  return { ...command, placement: { ...defaults, ...inherited, ...placement } };
}
