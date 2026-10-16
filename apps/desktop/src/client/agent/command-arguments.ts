import type { Static } from 'typebox';
import type {
  CommandArgumentsSchema,
  CommandOptionSchema,
} from '../../native-bridge/command-options';
import type { ArgumentValues, CommandDefinition } from './command-schema';
import { defaultArguments, parameterError } from './command-validation';

/** One of a command's parameters as the shell offers it (`commandOptions.set`, the HUD's card). */
export type CommandOption = Static<typeof CommandOptionSchema>;
/** Values the shell picked in its options menu or card, over the remembered ones. */
export type CommandArguments = Static<typeof CommandArgumentsSchema>;

/** The longest values summary the progress HUD takes (`commandProgress.show` working `summary`). */
const MAX_SUMMARY_LENGTH = 200;

/**
 * The values of `values` a run of `command` can use: only keys of its own parameters, each with a
 * value that parameter accepts (`parameterError`). A blank value counts as no value and is dropped,
 * so it never hides a default or a remembered value. Anything else is dropped silently: remembered
 * values can predate a parameter change, and the shell's values cross a boundary.
 */
export function sanitizeArguments(
  command: Pick<CommandDefinition, 'parameters'>,
  values: Readonly<Record<string, unknown>> | undefined,
): ArgumentValues {
  if (!values) return {};
  const kept: ArgumentValues = {};
  for (const parameter of command.parameters) {
    if (!Object.hasOwn(values, parameter.key)) continue;
    const value = values[parameter.key];
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
      continue;
    if (typeof value === 'string' && !value.trim()) continue;
    if (!parameterError(parameter, value)) kept[parameter.key] = value;
  }
  return kept;
}

/**
 * The argument values a run of `command` starts from: its parameter defaults, then the values its
 * last run from the app used (`lastArguments`), then the values the launching shortcut pins
 * (`pinned`, `CommandShortcut.arguments`), then `overrides` (picked for this launch), each kept
 * only where it fits the command's current parameters.
 */
export function commandValues(
  command: CommandDefinition,
  overrides?: Readonly<Record<string, unknown>>,
  pinned?: Readonly<Record<string, unknown>>,
): ArgumentValues {
  return {
    ...defaultArguments(command),
    ...sanitizeArguments(command, command.lastArguments),
    ...sanitizeArguments(command, pinned),
    ...sanitizeArguments(command, overrides),
  };
}

/**
 * The shell's argument overrides as values of `command`: a choice only for one of its enum
 * parameters, a toggle only for a boolean one, each fitting that parameter. Keys the command does
 * not declare, and values that do not fit, are dropped, which also bounds them to its parameters.
 */
export function argumentOverrides(
  command: CommandDefinition,
  picked: CommandArguments,
): ArgumentValues {
  const values: Record<string, unknown> = {};
  for (const parameter of command.parameters) {
    const { key } = parameter;
    if (parameter.type === 'enum' && Object.hasOwn(picked.choices, key))
      values[key] = picked.choices[key];
    else if (parameter.type === 'boolean' && Object.hasOwn(picked.toggles, key))
      values[key] = picked.toggles[key];
  }
  return sanitizeArguments(command, values);
}

/**
 * The options the shell offers for `command`, in parameter order, showing `values`: an enum
 * parameter is a `choice` (its value empty while none is set, which checks no option), a boolean a
 * `toggle` (off while unset), and a text or number parameter an `input` the panel fills.
 */
export function commandOptions(
  command: CommandDefinition,
  values: ArgumentValues,
): CommandOption[] {
  return command.parameters.map((parameter): CommandOption => {
    const { key, label } = parameter;
    const value = values[key];
    switch (parameter.type) {
      case 'enum':
        return {
          kind: 'choice',
          key,
          label,
          value: typeof value === 'string' ? value : '',
          options: parameter.options.map((option) => ({
            value: option.value,
            label: option.label,
          })),
        };
      case 'boolean':
        return { kind: 'toggle', key, label, value: value === true };
      case 'text':
      case 'number':
        return { kind: 'input', key, label };
    }
  });
}

/**
 * Whether a text or number parameter of `command` still lacks a usable value in `values`: the
 * options card cannot fill one, so only the command's input step can.
 */
export function needsInput(command: CommandDefinition, values: ArgumentValues): boolean {
  return command.parameters.some(
    (parameter) =>
      (parameter.type === 'text' || parameter.type === 'number') &&
      parameterError(parameter, values[parameter.key]) !== '',
  );
}

/**
 * The values summary the progress HUD's working chip shows: the label of each enum parameter's
 * value and the label of each boolean parameter that is on, joined with ' · ', shortened to the
 * HUD's limit. Absent when the command has no enum or boolean parameter, or none of them shows.
 */
export function valuesSummary(
  command: CommandDefinition,
  values: ArgumentValues,
): string | undefined {
  const parts = command.parameters.flatMap((parameter) => {
    const value = values[parameter.key];
    if (parameter.type === 'boolean') return value === true ? [parameter.label] : [];
    if (parameter.type !== 'enum') return [];
    const option = parameter.options.find((item) => item.value === value);
    const text = option ? option.label.trim() || option.value : '';
    return text ? [text] : [];
  });
  const summary = parts.join(' · ');
  if (!summary) return undefined;
  if (summary.length <= MAX_SUMMARY_LENGTH) return summary;
  // Cut whole code points, so a character outside the BMP is never split in half.
  let cut = '';
  for (const char of summary) {
    if (cut.length + char.length > MAX_SUMMARY_LENGTH - 1) break;
    cut += char;
  }
  return `${cut}…`;
}
