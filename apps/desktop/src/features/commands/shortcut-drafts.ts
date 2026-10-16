import {
  actsOnSelection,
  keyedShortcuts,
  MAX_COMMAND_SHORTCUTS,
  readsSelection,
  type CommandShortcut,
} from '@atd/agent-contracts';
import type { CommandDefinition } from '../../client/agent/command-schema';

/**
 * How a command's shortcuts follow edits to the command in the editor, so a pinned value or a
 * result override never points at something the command no longer has. Edits that only might
 * invalidate a pin (a parameter's new options or type) are left for the editor to flag
 * (`shortcutProblems`), since the person decides what the shortcut should pin instead.
 */

/**
 * A new shortcut with `accelerator` that overrides nothing. Its id, which the shell registers it
 * under, is a fresh UUID, unique across every command's shortcuts.
 */
export function plainShortcut(accelerator: string): CommandShortcut {
  return { id: crypto.randomUUID(), accelerator, name: '', arguments: {} };
}

/** The shortcuts after a parameter's key changed from `previous` to `next`. */
export function withRenamedPin(
  shortcuts: readonly CommandShortcut[],
  previous: string,
  next: string,
): CommandShortcut[] {
  return shortcuts.map((shortcut) => {
    if (previous === next || !(previous in shortcut.arguments)) return shortcut;
    const { [previous]: value, ...rest } = shortcut.arguments;
    return { ...shortcut, arguments: value === undefined ? rest : { ...rest, [next]: value } };
  });
}

/** The shortcuts without pins of parameters `parameters` no longer has, after a removal. */
export function withExistingPins(
  shortcuts: readonly CommandShortcut[],
  parameters: CommandDefinition['parameters'],
): CommandShortcut[] {
  const keys = new Set(parameters.map((parameter) => parameter.key));
  return shortcuts.map((shortcut) =>
    Object.keys(shortcut.arguments).every((key) => keys.has(key))
      ? shortcut
      : {
          ...shortcut,
          arguments: Object.fromEntries(
            Object.entries(shortcut.arguments).filter(([key]) => keys.has(key)),
          ),
        },
  );
}

/**
 * The shortcuts for a command whose input is now `input`: a result override that acts on the
 * selection returns to following the command once the input stops reading it, as the command's
 * own result returns to the conversation.
 */
export function withServableOutputs(
  shortcuts: readonly CommandShortcut[],
  input: CommandDefinition['input'],
): CommandShortcut[] {
  if (readsSelection(input)) return [...shortcuts];
  return shortcuts.map((shortcut) => {
    if (!shortcut.output || !actsOnSelection(shortcut.output.action)) return shortcut;
    const { output: _stranded, ...rest } = shortcut;
    return rest;
  });
}

/**
 * The shortcuts after keys were recorded on the list row: they replace the first shortcut with
 * keys. A command with none gains a plain shortcut ahead of any without keys (a copy's, which keep
 * their overrides), or, at the limit, the first of those takes the keys.
 */
export function withRowRecording(
  command: CommandDefinition,
  accelerator: string,
): CommandShortcut[] {
  const first = keyedShortcuts(command)[0] ?? null;
  const { shortcuts } = command;
  if (!first && shortcuts.length < MAX_COMMAND_SHORTCUTS)
    return [plainShortcut(accelerator), ...shortcuts];
  const target = first ?? shortcuts[0]!;
  return shortcuts.map((item) => (item === target ? { ...item, accelerator } : item));
}
