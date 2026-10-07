import { defaultCommandPlacement } from '@atd/agent-contracts';
import type { CommandDefinition } from '../src/client/agent/command-schema';
import { newCommand } from '../src/client/agent/command-templates';

/**
 * Commands the tests list and run. The commands a new install starts with are the service's
 * (`apps/agent-service/src/commands/starters.ts`); these stay fixed so tests do not follow them.
 */
export function fixtureCommands(): CommandDefinition[] {
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
    // Placed as the service places a command that never chose: on the selection toolbar only.
    placement: defaultCommandPlacement('selection'),
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
  summarize.placement = defaultCommandPlacement(summarize.input.source);
  return [translate, extract, polish, summarize];
}
