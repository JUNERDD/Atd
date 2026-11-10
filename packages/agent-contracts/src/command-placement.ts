import { Type, type Static } from 'typebox';
import type { CommandInput } from './commands.js';

/**
 * Where a command is offered beyond the command list, its shortcut and the launcher. Each place
 * hands the command what stands in for its input: the text selected in another app
 * (`selectionToolbar`), the text selected in a conversation's answers (`turnSelection`), a settled
 * turn's answer (`turnActions`), or the screenshot being taken (`screenshotToolbar`). Clients offer
 * a command only where it is placed and only while its input can take what that place hands it
 * (`offeredAt`).
 */
export const CommandPlacementSchema = Type.Object(
  {
    /** The selection toolbar over text selected in other apps. */
    selectionToolbar: Type.Boolean(),
    /** The toolbar over text selected in a conversation's answers. */
    turnSelection: Type.Boolean(),
    /** A settled turn's actions, which run the command on the turn's answer. */
    turnActions: Type.Boolean(),
    /** The screenshot capture's command row, which runs the command on the screenshot. */
    screenshotToolbar: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type CommandPlacement = Static<typeof CommandPlacementSchema>;
export type CommandPlace = keyof CommandPlacement;

/**
 * The placement of a command that never chose one (stored before placements existed, or created
 * without one), and the choice of a place it never chose (stored before the place existed): a
 * command that takes the selection as its input shows on the selection toolbar over other apps, as
 * every such command did before, one that takes a screenshot on the screenshot toolbar, and none
 * in a conversation until it is put there.
 */
export function defaultCommandPlacement(source: CommandInput['source']): CommandPlacement {
  return {
    selectionToolbar: source === 'selection',
    turnSelection: false,
    turnActions: false,
    screenshotToolbar: source === 'screenshot',
  };
}

/** Whether a command reads the selection: as its input, or through the `{{selection}}` variable. */
export function readsSelection(input: CommandInput): boolean {
  return input.source === 'selection' || input.selection;
}

/**
 * Whether `place` can offer a command with `input` at all. The screenshot toolbar hands a command
 * the screenshot just taken, so its input must be a screenshot; every other place hands it text
 * that stands in for a selection, so it must read the selection.
 */
export function placeAvailable(input: CommandInput, place: CommandPlace): boolean {
  return place === 'screenshotToolbar' ? input.source === 'screenshot' : readsSelection(input);
}

/** Whether a client offers `command` at `place`: it is enabled, placed there and can run there. */
export function offeredAt(
  command: { enabled: boolean; input: CommandInput; placement: CommandPlacement },
  place: CommandPlace,
): boolean {
  return command.enabled && command.placement[place] && placeAvailable(command.input, place);
}
