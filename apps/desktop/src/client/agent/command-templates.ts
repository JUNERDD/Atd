import { defaultCommandPlacement } from '@atd/agent-contracts';
import type { CommandDefinition } from './command-schema';

/** An editable copy the user owns: a copy of a plugin command leaves the plugin behind. */
export function copyCommand(command: CommandDefinition, id: string): CommandDefinition {
  const copy: CommandDefinition = {
    ...structuredClone(command),
    id,
    revision: 1,
    name: `${command.name} copy`.slice(0, 120),
    shortcut: '',
    templateId: null,
    enabled: true,
  };
  delete copy.pluginId;
  return copy;
}

/**
 * Duplicate to Personal for a plugin command. The copy takes the plugin-local item name (after the
 * last `:` of the qualified name), suffixed only when one of `names` already uses it, and starts
 * disabled so it does not run alongside the plugin's command until the user turns it on.
 */
export function personalCopy(
  command: CommandDefinition,
  id: string,
  names: readonly string[],
): CommandDefinition {
  const local = command.name.slice(command.name.lastIndexOf(':') + 1).trim() || command.name;
  const name = names.includes(local) ? `${local} copy` : local;
  return { ...copyCommand(command, id), name: name.slice(0, 120), enabled: false };
}

export function newCommand(id: string): CommandDefinition {
  const input: CommandDefinition['input'] = {
    source: 'manual',
    required: true,
    files: false,
    selection: false,
    clipboard: false,
  };
  return {
    id,
    revision: 1,
    name: '',
    description: '',
    instructions: '',
    enabled: true,
    shortcut: '',
    templateId: null,
    input,
    placement: defaultCommandPlacement(input.source),
    parameters: [],
    model: { mode: 'inherit' },
    tools: [],
    memory: 'inherit',
  };
}
