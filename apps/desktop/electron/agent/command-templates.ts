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
  return {
    id,
    revision: 1,
    name: '',
    description: '',
    instructions: '',
    enabled: true,
    shortcut: '',
    templateId: null,
    input: { source: 'manual', required: true, files: false, selection: false, clipboard: false },
    parameters: [],
    model: { mode: 'inherit' },
    tools: [],
    memory: 'inherit',
  };
}

export function initialCommands(): CommandDefinition[] {
  const command = (
    id: string,
    name: string,
    description: string,
    instructions: string,
  ): CommandDefinition => ({
    ...newCommand(id),
    name,
    description,
    instructions,
    templateId: id,
    input: { source: 'selection', required: true, files: true, selection: true, clipboard: false },
  });
  const translate = command(
    'translate',
    'Translate selection',
    'Keep the meaning. Find the right words.',
    'Translate the following material into {{argument.language}}. Preserve meaning and formatting. Return the translation.\n\n{{input}}',
  );
  translate.shortcut = 'Control+Alt+T';
  translate.parameters = [
    {
      key: 'language',
      label: 'Target language',
      description: '',
      type: 'enum',
      required: true,
      default: 'English',
      options: ['English', 'Chinese', 'Japanese', 'Korean', 'French', 'German', 'Spanish'].map(
        (value) => ({ value, label: value }),
      ),
    },
  ];
  const extract = command(
    'extract',
    'Extract action items',
    'Turn notes into a clear next step.',
    'Extract action items from this material. Group by {{argument.group_by}}. Preserve named owners and dates; mark missing details as unspecified.\n\n{{input}}',
  );
  extract.shortcut = 'Control+Alt+A';
  extract.parameters = [
    {
      key: 'group_by',
      label: 'Group by',
      description: '',
      type: 'enum',
      required: true,
      default: 'Owner',
      options: ['Owner', 'Due date', 'Priority'].map((value) => ({ value, label: value })),
    },
  ];
  const polish = command(
    'polish',
    'Polish writing',
    'Make your writing clear and natural.',
    'Polish the following writing while preserving its meaning and voice. Return the revised text.\n\n{{input}}',
  );
  const summarize = command(
    'summarize',
    'Summarize files',
    'Find the key points in your files.',
    'Summarize the attached files, identifying key points and next steps. Cite the filenames.\n{{input}}\n{{files}}',
  );
  summarize.input = {
    source: 'manual',
    required: false,
    files: true,
    selection: false,
    clipboard: false,
  };
  return [translate, extract, polish, summarize];
}
