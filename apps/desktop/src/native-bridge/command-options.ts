/**
 * Command options in the shell (`NativeCommandOptionsCalls`, part of `NativeCalls` in `calls.ts`):
 * the parameters of a command, and where its answer goes, as the selection toolbar's options menu
 * and the progress HUD's options card offer them, and the values the shell sends back with
 * `shortcut.command`, `commandProgress.action` and `commandOptions.picked`. Loaded by the export
 * script with Node's type stripping, so it imports nothing but TypeBox and its sibling contract
 * files (by their `.ts` names) and uses only erasable TypeScript syntax.
 *
 * Argument overrides (`CommandArgumentsSchema`) cross as two records keyed by parameter key,
 * `choices` (the value of an enum parameter) and `toggles` (a boolean parameter), rather than one
 * `Record<string, string | boolean>`: the Swift generator (`apps/macos/scripts/bridge-emitter.mjs`)
 * types a record's values with one schema and takes no union of a string and a boolean, nor a
 * `maxProperties` bound. The page bounds them instead: it keeps only keys of the command's own
 * parameters (at most 20) whose value fits that parameter, and drops the rest.
 */
import { Type } from 'typebox';
import { Empty } from './primitives.ts';

/** A command parameter's key, as agent-contracts `CommandParameterSchema` bounds it. */
const PARAMETER_KEY_PATTERN = '^[a-zA-Z][a-zA-Z0-9_]{0,63}$';
const ParameterKey = Type.String({ minLength: 1, maxLength: 64, pattern: PARAMETER_KEY_PATTERN });
const ParameterLabel = Type.String({ minLength: 1, maxLength: 120 });
/** An enum parameter's value or option label (agent-contracts bounds both to 256). */
const ChoiceText = Type.String({ maxLength: 256 });

/**
 * One parameter of a command as the shell offers it, with its current value (defaults, then the
 * remembered values, then any overrides): `choice` an enum parameter, picked from `options`;
 * `toggle` a boolean parameter; `input` a text or number parameter, which only the panel's command
 * input page fills.
 */
export const CommandOptionSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('choice'),
      key: ParameterKey,
      label: ParameterLabel,
      value: ChoiceText,
      options: Type.Array(
        Type.Object({ value: ChoiceText, label: ChoiceText }, { additionalProperties: false }),
        { minItems: 1, maxItems: 50 },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('toggle'),
      key: ParameterKey,
      label: ParameterLabel,
      value: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('input'), key: ParameterKey, label: ParameterLabel },
    { additionalProperties: false },
  ),
]);

/** A command's options in parameter order: none for a command without parameters, at most 20. */
export const CommandOptionsSchema = Type.Array(CommandOptionSchema, { maxItems: 20 });

/**
 * Where a run's answer goes, as agent-contracts `CommandOutputActionSchema` names it (repeated
 * here, since this file imports no workspace package). The shell names each one itself.
 */
export const CommandOutputActionSchema = Type.Union([
  Type.Literal('panel'),
  Type.Literal('replaceSelection'),
  Type.Literal('insertAfterSelection'),
  Type.Literal('insertAtCursor'),
  Type.Literal('copy'),
]);

/**
 * Where the answer of a run goes, offered beside the parameters: `value` for this run (the
 * command's saved output until the person picks another), `saved` the command's saved one, which
 * the shell marks as its default. A pick lasts for that run only. `selection` says whether the command reads the selection:
 * without it, the two actions on the selection (`replaceSelection`, `insertAfterSelection`) are
 * not offered.
 */
export const CommandOutputOptionSchema = Type.Object(
  {
    value: CommandOutputActionSchema,
    saved: CommandOutputActionSchema,
    selection: Type.Boolean(),
  },
  { additionalProperties: false },
);

/**
 * Argument overrides the shell sends with a launch or a run (see the file comment): the value
 * picked for each `choice` option in `choices`, for each `toggle` in `toggles`, and where the
 * answer goes in `output` (absent: the command's saved output).
 */
export const CommandArgumentsSchema = Type.Object(
  {
    output: Type.Optional(CommandOutputActionSchema),
    choices: Type.Record(Type.String({ pattern: PARAMETER_KEY_PATTERN }), ChoiceText, {
      additionalProperties: false,
    }),
    toggles: Type.Record(Type.String({ pattern: PARAMETER_KEY_PATTERN }), Type.Boolean(), {
      additionalProperties: false,
    }),
  },
  { additionalProperties: false },
);

/**
 * What `shortcut.command` asks the page to do with the command (absent: `run`): `run` it,
 * `choose` its options first (the shell saw its shortcut held), or `edit` them in the panel's
 * command input page (the toolbar's Fill in Atd), never running it by itself.
 */
export const ShortcutCommandIntentSchema = Type.Union([
  Type.Literal('run'),
  Type.Literal('choose'),
  Type.Literal('edit'),
]);

export const NativeCommandOptionsCalls = {
  /**
   * Replaces the commands whose options the shell offers: every enabled command, each with its
   * parameters' options as they stand (remembered values applied) and where its answer goes. The
   * panel pushes the whole set whenever it changes. A command shortcut or toolbar command in this
   * set gets the shell's options menu, card and hold gesture; any other runs as it is.
   */
  'commandOptions.set': {
    params: Type.Object(
      {
        commands: Type.Array(
          Type.Object(
            {
              id: Type.String({ minLength: 1, maxLength: 128 }),
              name: Type.String({ minLength: 1, maxLength: 256 }),
              options: CommandOptionsSchema,
              output: CommandOutputOptionSchema,
            },
            { additionalProperties: false },
          ),
          { maxItems: 256 },
        ),
      },
      { additionalProperties: false },
    ),
    result: Empty,
  },
};

/** Command option events, part of `NativeEvents` in `contract.ts`. */
export const NativeCommandOptionsEvents = {
  /**
   * The person changed a choice or a toggle of command `id` in the selection toolbar's options
   * menu, without running it yet: `arguments` holds every value the menu now shows, which the
   * page remembers at once as where the command's next run starts. Sent to the panel only.
   */
  'commandOptions.picked': Type.Object(
    { id: Type.String({ minLength: 1, maxLength: 128 }), arguments: CommandArgumentsSchema },
    { additionalProperties: false },
  ),
};
