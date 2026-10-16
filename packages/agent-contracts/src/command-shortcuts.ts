import { Type, type Static } from 'typebox';
import { CommandOutputSchema, type CommandOutput } from './command-output.js';
import {
  CommandModelSchema,
  CommandThinkingLevelSchema,
  type CommandModel,
  type CommandThinkingLevel,
} from './command-run.js';
import { Identifier } from './identifiers.js';

/**
 * Argument values of one command run keyed by parameter key, the value type of a run input's
 * `arguments` (`TaskInput`), of a command's remembered values and of a shortcut's pinned values.
 */
export const CommandArgumentValuesSchema = Type.Record(
  Type.String(),
  Type.Union([Type.String({ maxLength: 10000 }), Type.Number(), Type.Boolean()]),
);
export type CommandArgumentValues = Static<typeof CommandArgumentValuesSchema>;

/** The most shortcuts one command can have. */
export const MAX_COMMAND_SHORTCUTS = 8;

/**
 * Shell registration ids the application's own global shortcuts use. A command shortcut's id is
 * its registration id, so it can never take one of these.
 */
export const RESERVED_SHORTCUT_IDS: readonly string[] = ['togglePanel', 'captureScreenshot'];

/**
 * One global shortcut of a command: an entry point that runs the command with a few of its
 * settings overridden. Each override is optional; a field the shortcut leaves out follows the
 * command, including later changes to it. Instructions, input, tools, memory and placement are
 * never overridden: a shortcut that needs different ones is a different command.
 *
 * Settings a run uses, strongest first:
 * - argument values: what the run's options card or input page picks, then the shortcut's pinned
 *   `arguments`, then the command's remembered values (`lastArguments`), then parameter defaults;
 * - output, model and reasoning level: what the run picks, then the shortcut's override, then the
 *   command's own (`shortcutRunSettings`).
 *
 * Pinned values are never remembered: a run from the shortcut remembers its other values as any
 * run does, and keeps whatever was remembered for the pinned keys.
 */
export const CommandShortcutSchema = Type.Object(
  {
    /**
     * Unique across every command in the store, and the id the shell registers the shortcut
     * under. Never a command id or one of `RESERVED_SHORTCUT_IDS`.
     */
    id: Identifier,
    /** The keys, as an accelerator; empty while none is recorded, which registers nothing. */
    accelerator: Type.String({ maxLength: 100 }),
    /** The person's name for the shortcut; empty lets clients name it after its overrides. */
    name: Type.String({ maxLength: 120 }),
    /** Pinned argument values, each for a parameter the command declares. */
    arguments: CommandArgumentValuesSchema,
    /** Absent: the command's output. */
    output: Type.Optional(CommandOutputSchema),
    /**
     * Absent: the command's model. `{ mode: 'inherit' }` runs with the app's default model even
     * when the command fixes one.
     */
    model: Type.Optional(CommandModelSchema),
    /** Absent: the command's level. `inherit` asks for the connection's default level. */
    thinkingLevel: Type.Optional(CommandThinkingLevelSchema),
  },
  { additionalProperties: false },
);
export type CommandShortcut = Static<typeof CommandShortcutSchema>;

/** A command as the shortcut helpers read it. */
interface ShortcutOwner {
  shortcuts: ReadonlyArray<CommandShortcut>;
}

/** The command's shortcut with `id`; undefined when it has none. */
export function commandShortcut<T extends ShortcutOwner>(
  command: T,
  id: string,
): T['shortcuts'][number] | undefined {
  return command.shortcuts.find((shortcut) => shortcut.id === id);
}

/** The command's shortcuts that have keys, the ones the shell registers. */
export function keyedShortcuts<T extends ShortcutOwner>(command: T): T['shortcuts'] {
  return command.shortcuts.filter((shortcut) => shortcut.accelerator !== '');
}

/** Whether the shortcut overrides anything the command sets. */
export function hasOverrides(shortcut: CommandShortcut): boolean {
  return (
    Object.keys(shortcut.arguments).length > 0 ||
    shortcut.output !== undefined ||
    shortcut.model !== undefined ||
    shortcut.thinkingLevel !== undefined
  );
}

/** A shortcut with no keys, no name and no overrides, which a save drops. */
export function isBlankShortcut(shortcut: CommandShortcut): boolean {
  return shortcut.accelerator === '' && shortcut.name === '' && !hasOverrides(shortcut);
}

/** The parameter keys the shortcut pins, which a run from it never remembers. */
export function pinnedKeys(shortcut: CommandShortcut | undefined): string[] {
  return shortcut ? Object.keys(shortcut.arguments) : [];
}

/** The settings a run starts from before its own picks. */
export interface ShortcutRunSettings {
  output: CommandOutput;
  model: CommandModel;
  thinkingLevel: CommandThinkingLevel;
}

/**
 * The output, model and reasoning level a run from `shortcut` starts from: the shortcut's override
 * of each, else the command's. Without a shortcut (the toolbar, the launcher, a run button, an
 * automation), the command's own. A run's own picks still win over the answer (`runModelSelection`,
 * `commandThinkingLevel`, `CommandRunRequest.output`).
 */
export function shortcutRunSettings(
  command: ShortcutRunSettings,
  shortcut?: CommandShortcut,
): ShortcutRunSettings {
  return {
    output: shortcut?.output ?? command.output,
    model: shortcut?.model ?? command.model,
    thinkingLevel: shortcut?.thinkingLevel ?? command.thinkingLevel,
  };
}
