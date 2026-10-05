import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CommandCreate, CommandInput, CommandParameter } from '@atd/agent-contracts';
import { atomicWrite } from '../config.js';
import { CommandStore } from './store.js';

/**
 * The commands every data dir gets once (`seedStarterCommands`). They become the user's own
 * commands: editable, deletable, and never restored after the seed. None takes a global
 * shortcut: one could collide with the user's other apps or their own app shortcuts. None chooses
 * a placement either: the ones that work on selected text take the selection as their input, so
 * their default placement (`defaultCommandPlacement`) shows them on the selection toolbar, and in
 * no conversation until the user places them there. Names and instructions are English, like the
 * other content the service ships.
 */

const SELECTION: CommandInput = {
  source: 'selection',
  required: true,
  files: false,
  selection: true,
  clipboard: false,
};

/** A required enum parameter whose option values are the phrases the instructions read. */
function choice(
  key: string,
  label: string,
  options: ReadonlyArray<[value: string, label: string]>,
  fallback: string,
): CommandParameter {
  return {
    key,
    label,
    description: '',
    type: 'enum',
    required: true,
    default: fallback,
    options: options.map(([value, option]) => ({ value, label: option })),
  };
}

/** A command that works on the text selected in another app. */
function onSelection(
  id: string,
  name: string,
  description: string,
  instructions: string,
  parameters: CommandParameter[] = [],
): CommandCreate {
  return { id, name, description, instructions, input: SELECTION, parameters };
}

const LANGUAGES = [
  'English',
  'Simplified Chinese',
  'Traditional Chinese',
  'Japanese',
  'Korean',
  'French',
  'German',
  'Spanish',
] as const;

export const STARTER_COMMANDS: readonly CommandCreate[] = [
  onSelection(
    'translate',
    'Translate',
    'Translate the selected text and keep its formatting.',
    'Translate the text below into {{argument.language}}. Preserve its meaning, tone and formatting, including Markdown, line breaks, code, links and names. Return only the translation.\n\n{{input}}',
    [
      choice(
        'language',
        'Target language',
        LANGUAGES.map((language) => [language, language]),
        'English',
      ),
    ],
  ),
  onSelection(
    'polish',
    'Polish writing',
    'Make the selected writing clear and natural.',
    'Improve the clarity, grammar and flow of the text below while keeping its meaning, voice, language and formatting. Return only the revised text.\n\n{{input}}',
  ),
  onSelection(
    'summarize',
    'Summarize',
    'Condense the selected text to what matters.',
    'Summarize the text below as {{argument.length}}. Keep the facts, decisions and numbers that matter, and write in the same language as the text.\n\n{{input}}',
    [
      choice(
        'length',
        'Length',
        [
          ['a single sentence', 'One sentence'],
          ['a short paragraph', 'Short paragraph'],
          ['a bulleted list of key points', 'Key points'],
        ],
        'a bulleted list of key points',
      ),
    ],
  ),
  onSelection(
    'explain',
    'Explain',
    'Explain the selected text or code in plain language.',
    'Explain the text below in plain language: what it means, the key terms, and any context needed to understand it. If it is code, explain what it does step by step and point out anything surprising. Answer in the same language as the text.\n\n{{input}}',
  ),
  onSelection(
    'action-items',
    'Extract action items',
    'Turn notes into a list of next steps.',
    'Extract the action items from the text below as a checklist grouped by {{argument.group_by}}. Keep named owners and dates, and mark missing ones as unspecified. Write in the same language as the text.\n\n{{input}}',
    [
      choice(
        'group_by',
        'Group by',
        [
          ['owner', 'Owner'],
          ['due date', 'Due date'],
          ['priority', 'Priority'],
        ],
        'owner',
      ),
    ],
  ),
  onSelection(
    'review-code',
    'Review code',
    'Find bugs and risks in the selected code.',
    'Review the code below. List concrete problems, most severe first: bugs, unhandled edge cases, security risks and misleading names. Give each a one-line reason and a short fix. If you find none, say so plainly. Do not rewrite the whole code.\n\n{{input}}',
  ),
  {
    id: 'summarize-files',
    name: 'Summarize files',
    description: 'Find the key points in attached files.',
    instructions:
      'Summarize the attached files: the key points of each and any next steps they imply, citing file names.\n\n{{input}}\n\n{{files}}',
    input: { source: 'manual', required: false, files: true, selection: false, clipboard: false },
  },
  {
    id: 'ask-screenshot',
    name: 'Ask about screenshot',
    description: 'Capture part of the screen and ask about it.',
    instructions:
      'Answer the request below about the attached screenshot. When there is no request, describe what the screenshot shows and point out anything that needs attention, such as errors or warnings.\n\n{{input}}',
    input: {
      source: 'screenshot',
      required: false,
      files: true,
      selection: false,
      clipboard: false,
    },
  },
];

/** Run-once marker of the seed; its path is persisted data and stays fixed. */
function markerFile(dataDir: string): string {
  return path.join(dataDir, 'commands-starters.json');
}

/**
 * Adds the starter commands to the command store once per data dir, whether it is new or already
 * holds the user's commands, then writes the marker so a starter the user deletes never returns.
 * Ids are fixed: a store that already holds one (a crash between the store write and the marker)
 * keeps its copy, so a retry adds nothing twice.
 */
export async function seedStarterCommands(dataDir: string): Promise<void> {
  const marker = markerFile(dataDir);
  try {
    await readFile(marker);
    return;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const store = await CommandStore.load(dataDir);
  const added = await store.change((data) => {
    const held = new Set(data.commands.map((command) => command.id));
    const starters = STARTER_COMMANDS.map((draft) => CommandStore.compose(draft)).filter(
      (command) => !held.has(command.id),
    );
    data.commands.push(...starters.map((command) => CommandStore.storable(command)));
    return starters.map((command) => command.id);
  });
  await atomicWrite(marker, { version: 1, seededAt: new Date().toISOString(), added });
}
