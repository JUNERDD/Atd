import { randomUUID } from 'node:crypto';
import { Type, type Static } from 'typebox';
import {
  CommandArgumentValuesSchema,
  CommandOutputSchema,
  CommandThinkingLevelSchema,
  Identifier,
  MAX_COMMAND_SHORTCUTS,
  parseAccelerator,
  type CommandShortcut,
} from '@atd/agent-contracts';

/**
 * The `shortcuts` field of the `command` tool: what the Agent may author of a command's global
 * shortcuts, and how a list it sends merges into the stored one. A shortcut is an entry point that
 * runs the command with a few settings overridden (`CommandShortcut`). The Agent never sets a
 * shortcut's model; the user picks it in Settings, and an update by `id` keeps it.
 */

/** One shortcut as the Agent writes it; the stored `model` is not part of it. */
const ShortcutInputSchema = Type.Object(
  {
    id: Type.Optional({
      ...Identifier,
      description:
        "The id of one of this command's existing shortcuts (from get), to update that shortcut and keep its model override. Omit it to add a new shortcut; the service assigns its id.",
    }),
    accelerator: Type.String({
      maxLength: 100,
      description:
        'The keys, as an Electron accelerator such as CommandOrControl+Alt+S (Alt is Option on macOS), or on macOS a double-tap of one modifier: DoubleTap+Command, DoubleTap+Alt, DoubleTap+Control or DoubleTap+Shift (needs Accessibility access). Empty records no keys yet and registers nothing.',
    }),
    name: Type.Optional(
      Type.String({
        maxLength: 120,
        description:
          'A short name for this shortcut. Omit it to let the app name it after its overrides.',
      }),
    ),
    arguments: Type.Optional({
      ...CommandArgumentValuesSchema,
      description:
        "Parameter values this shortcut fixes, by parameter key; each key must be a parameter the command declares and the value must be valid for it. Parameters left out follow the user's choice on each run. A fixed value is never remembered as the command's last-used value.",
    }),
    output: Type.Optional({
      ...CommandOutputSchema,
      description:
        "Where a run from this shortcut sends the answer, in the shape of the command's output field. Omit it to follow the command's output. The same rules apply: a write-back over or after the selection needs a command that reads the selection.",
    }),
    thinkingLevel: Type.Optional({
      ...CommandThinkingLevelSchema,
      description:
        "The reasoning level of runs from this shortcut, in the meaning of the command's thinkingLevel field. Omit it to follow the command. Set it only when the user asks for a level.",
    }),
  },
  { additionalProperties: false },
);
type ShortcutInput = Static<typeof ShortcutInputSchema>;

/** The tool field: the whole list of shortcuts, or absent to keep the stored one. */
export const ShortcutsField = Type.Optional(
  Type.Array(ShortcutInputSchema, {
    maxItems: MAX_COMMAND_SHORTCUTS,
    description: `The command's global shortcuts, at most ${MAX_COMMAND_SHORTCUTS}. Omit the field to keep the current shortcuts. An array replaces the whole list: a shortcut missing from it is removed, and [] removes them all. Each shortcut runs the command like its other entry points do, with only the settings it overrides changed: accelerator, name, arguments (fixed parameter values), output and thinkingLevel. To change an existing shortcut, send it with its id, with every setting it should keep (get shows them); its model override stays as the user set it. A shortcut sent without an id is added. A key combination already used by the app, the selection toolbar or another shortcut is refused, so ask the user for another combination.`,
  }),
);

/** The accelerator in canonical form; throws a TypeError naming it when it is unsupported. */
function canonicalAccelerator(accelerator: string): string {
  if (accelerator === '') return accelerator;
  try {
    // The desktop registers command shortcuts globally, so a modifier's double-tap is allowed.
    return parseAccelerator(accelerator, true, process.platform, { allowDoubleTap: true });
  } catch {
    throw new TypeError(
      `"${accelerator}" is not a supported shortcut. Use an Electron accelerator that includes CommandOrControl, Command, Control, Alt or Super, such as CommandOrControl+Alt+S.`,
    );
  }
}

/**
 * The shortcut list a save stores. Without `requested` the stored list stays. Otherwise the
 * request is the whole list: an item with the id of a stored shortcut replaces its settings and
 * keeps its model override, an item without an id is added under a fresh id, and a stored shortcut
 * the request leaves out is removed. An id that names no shortcut of this command is refused, so
 * the Agent can neither invent ids nor take another command's.
 */
export function mergeShortcuts(
  stored: readonly CommandShortcut[],
  requested: readonly ShortcutInput[] | undefined,
): CommandShortcut[] {
  if (requested === undefined) return [...stored];
  const used = new Set<string>();
  return requested.map((item) => {
    const previous = item.id === undefined ? undefined : stored.find(({ id }) => id === item.id);
    if (item.id !== undefined && !previous)
      throw new TypeError(
        `The shortcut id ${item.id} is not a shortcut of this command. Read the command with get and use its shortcut ids, or omit id to add a new shortcut.`,
      );
    if (previous && used.has(previous.id))
      throw new TypeError(`The shortcut id ${previous.id} appears twice in shortcuts.`);
    const id = previous?.id ?? randomUUID();
    used.add(id);
    return {
      id,
      accelerator: canonicalAccelerator(item.accelerator),
      name: item.name ?? '',
      arguments: item.arguments ?? {},
      ...(item.output ? { output: item.output } : {}),
      ...(previous?.model ? { model: previous.model } : {}),
      ...(item.thinkingLevel ? { thinkingLevel: item.thinkingLevel } : {}),
    };
  });
}

/** What the save result tells the model about a stored shortcut. */
export function shortcutResult(shortcuts: readonly CommandShortcut[]) {
  return shortcuts.map(({ id, accelerator, name }) => ({ id, accelerator, name }));
}
