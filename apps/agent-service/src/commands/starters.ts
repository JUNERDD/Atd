import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import type {
  CommandCreate,
  CommandInput,
  CommandParameter,
  CommandThinkingLevel,
  ServiceCommand,
} from '@atd/agent-contracts';
import { atomicWrite } from '../config.js';
import { CommandStore } from './store.js';

/**
 * The commands every data dir gets once (`seedStarterCommands`). They become the user's own
 * commands: editable, deletable, and never restored after the seed. None takes a global
 * shortcut: one could collide with the user's other apps or their own app shortcuts. None chooses
 * a placement either: the ones that work on selected text take the selection as their input, so
 * their default placement (`defaultCommandPlacement`) shows them on the selection toolbar, and in
 * no conversation until the user places them there. Quick text transforms ask for no reasoning
 * (`off`), which keeps them fast and cheap; the others take the connection's default level. Names
 * and instructions are English, like the other content the service ships.
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
  thinkingLevel: CommandThinkingLevel,
  parameters: CommandParameter[] = [],
): CommandCreate {
  return { id, name, description, instructions, input: SELECTION, thinkingLevel, parameters };
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
    'off',
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
    'off',
  ),
  onSelection(
    'summarize',
    'Summarize',
    'Condense the selected text to what matters.',
    'Summarize the text below as {{argument.length}}. Keep the facts, decisions and numbers that matter, and write in the same language as the text.\n\n{{input}}',
    'off',
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
    'off',
  ),
  onSelection(
    'action-items',
    'Extract action items',
    'Turn notes into a list of next steps.',
    'Extract the action items from the text below as a checklist grouped by {{argument.group_by}}. Keep named owners and dates, and mark missing ones as unspecified. Write in the same language as the text.\n\n{{input}}',
    'off',
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
    'inherit',
  ),
  {
    id: 'summarize-files',
    name: 'Summarize files',
    description: 'Find the key points in attached files.',
    instructions:
      'Summarize the attached files: the key points of each and any next steps they imply, citing file names.\n\n{{input}}\n\n{{files}}',
    thinkingLevel: 'inherit',
    input: { source: 'manual', required: false, files: true, selection: false, clipboard: false },
  },
  {
    id: 'ask-screenshot',
    name: 'Ask about screenshot',
    description: 'Capture part of the screen and ask about it.',
    instructions:
      'Answer the request below about the attached screenshot. When there is no request, describe what the screenshot shows and point out anything that needs attention, such as errors or warnings.\n\n{{input}}',
    thinkingLevel: 'inherit',
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
 * What the marker records. Version 1 seeded the starters before they had their own reasoning
 * level; version 2 seeded them with it, or gave the version 1 seed its levels
 * (`upgradeStarterLevels`). `added` names the starters the seed added.
 */
const MarkerSchema = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  added: Type.Array(Type.String()),
});
const MARKER_VERSION = 2;

/** The marker, null before the seed ran; one that cannot be read as a marker counts as current. */
async function readMarker(dataDir: string): Promise<{ version: number; added: string[] } | null> {
  let text: string;
  try {
    text = await readFile(markerFile(dataDir), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  let marker: unknown;
  try {
    marker = JSON.parse(text);
  } catch {
    marker = null;
  }
  return Value.Check(MarkerSchema, marker) ? marker : { version: MARKER_VERSION, added: [] };
}

/**
 * The level a starter the seed added now ships with, when the stored copy is still the shipped
 * one: never saved again (revision 1), its instructions unchanged and its level `inherit`, the
 * level every command had before levels existed. Null leaves the command as the user has it.
 */
function shippedLevel(
  stored: ServiceCommand,
  added: readonly string[],
): CommandThinkingLevel | null {
  const starter = STARTER_COMMANDS.find((draft) => draft.id === stored.id);
  if (!starter?.thinkingLevel || starter.thinkingLevel === 'inherit') return null;
  const level = 'thinkingLevel' in stored ? stored.thinkingLevel : undefined;
  const unmodified =
    added.includes(stored.id) &&
    stored.revision === 1 &&
    stored.instructions === starter.instructions &&
    level === 'inherit';
  return unmodified ? starter.thinkingLevel : null;
}

/**
 * Gives the starters a version 1 seed added the level they now ship with, once, unless the user
 * changed them. The revision stays: the level is the starter's own, not the user's edit.
 */
async function upgradeStarterLevels(dataDir: string, added: readonly string[]): Promise<void> {
  const store = await CommandStore.load(dataDir);
  if (!store.data.commands.some((command) => shippedLevel(command, added))) return;
  await store.change((data) => {
    data.commands = data.commands.map((command) => {
      const level = shippedLevel(command, added);
      return level ? { ...command, thinkingLevel: level } : command;
    });
  });
}

/**
 * Adds the starter commands to the command store once per data dir, whether it is new or already
 * holds the user's commands, then writes the marker so a starter the user deletes never returns.
 * Ids are fixed: a store that already holds one (a crash between the store write and the marker)
 * keeps its copy, so a retry adds nothing twice. A data dir seeded before starters had their own
 * reasoning level gets those levels once instead (`upgradeStarterLevels`).
 */
export async function seedStarterCommands(dataDir: string): Promise<void> {
  const marker = await readMarker(dataDir);
  if (marker && marker.version >= MARKER_VERSION) return;
  if (marker) {
    await upgradeStarterLevels(dataDir, marker.added);
    await atomicWrite(markerFile(dataDir), {
      ...marker,
      version: MARKER_VERSION,
      upgradedAt: new Date().toISOString(),
    });
    return;
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
  await atomicWrite(markerFile(dataDir), {
    version: MARKER_VERSION,
    seededAt: new Date().toISOString(),
    added,
  });
}
