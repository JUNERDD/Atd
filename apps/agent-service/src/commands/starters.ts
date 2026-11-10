import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type {
  AppLanguage,
  CommandCreate,
  CommandInput,
  CommandOutput,
  ServiceCommand,
} from '@atd/agent-contracts';
import { atomicWrite } from '../config.js';
import {
  RETIRED_COPY,
  STARTER_COPY,
  STARTER_IDS,
  type StarterCopy,
  type StarterId,
} from './starter-copy.js';
import { CommandStore } from './store.js';

/**
 * The commands every data dir gets once each (`syncStarterCommands`). They become the user's own
 * commands: editable, deletable, and never restored after the seed. None takes a global
 * shortcut: one could collide with the user's other apps or their own app shortcuts. None chooses
 * a placement either: the ones that work on selected text take the selection as their input, so
 * their default placement (`defaultCommandPlacement`) shows them on the selection toolbar, the ones
 * that take a screenshot show on the screenshot toolbar, and none shows in a conversation until
 * the user places it there.
 *
 * They are written as light commands (product-skills/create-command): no tools, and quick text
 * transforms ask for no reasoning (`off`), which keeps them fast and cheap, while the others take
 * the connection's default level. Transforms whose result does not depend on who the user is
 * leave memory out. Translating and polishing rework the selected text, so their answers replace
 * it (an app that cannot take text shows the answer to copy instead), and they carry adjustment
 * suggestions for the review card once the user turns on review; the other selection answers are
 * meant to be read, not to change the text they came from, and stay in the conversation. A
 * screenshot has no text to write back into: what is read about it (an explanation, a translation,
 * a summary) shows on the island's answer card over the app it was taken in, where the user copies
 * or inserts it, and the Markdown transcription, text to reuse, goes on the clipboard.
 *
 * Their words follow the language the clients show (`starter-copy.ts`) until the user saves them.
 */

const SELECTION: CommandInput = {
  source: 'selection',
  required: true,
  files: false,
  selection: true,
  clipboard: false,
};

const SCREENSHOT: CommandInput = {
  source: 'screenshot',
  required: false,
  files: true,
  selection: false,
  clipboard: false,
};

const REPLACE: CommandOutput = { action: 'replaceSelection', review: false };
const CARD: CommandOutput = { action: 'card', review: false };
const COPY: CommandOutput = { action: 'copy', review: false };

/** Everything of a starter but its words, which are the same in every language. */
type StarterShape = Omit<CommandCreate, 'id' | keyof StarterCopy>;

const SHAPES: Record<StarterId, StarterShape> = {
  translate: { input: SELECTION, output: REPLACE, thinkingLevel: 'off', memory: 'off' },
  polish: { input: SELECTION, output: REPLACE, thinkingLevel: 'off', memory: 'off' },
  summarize: { input: SELECTION, thinkingLevel: 'off', memory: 'off' },
  explain: { input: SELECTION, thinkingLevel: 'off' },
  'action-items': { input: SELECTION, thinkingLevel: 'off', memory: 'off' },
  'review-code': { input: SELECTION, thinkingLevel: 'inherit' },
  'summarize-files': {
    input: { source: 'manual', required: false, files: true, selection: false, clipboard: false },
    thinkingLevel: 'inherit',
  },
  'ask-screenshot': { input: SCREENSHOT, output: CARD, thinkingLevel: 'inherit' },
  'translate-screenshot': { input: SCREENSHOT, output: CARD, thinkingLevel: 'off', memory: 'off' },
  'summarize-screenshot': { input: SCREENSHOT, output: CARD, thinkingLevel: 'off', memory: 'off' },
  'screenshot-markdown': { input: SCREENSHOT, output: COPY, thinkingLevel: 'off', memory: 'off' },
};

/** The starter commands in `language`, in the order the seed adds them. */
export function starterCommands(language: AppLanguage): CommandCreate[] {
  return STARTER_IDS.map((id) => ({ id, ...SHAPES[id], ...STARTER_COPY[language][id] }));
}

/**
 * Run-once marker of the seed; its path is persisted data and stays fixed. It describes the
 * command store beside it, so whatever replaces `commands.json` replaces or drops it too.
 */
export function starterMarkerFile(dataDir: string): string {
  return path.join(dataDir, 'commands-starters.json');
}

/**
 * What the marker records: `added` names the starters the seed added, the only ones the service
 * ever updates and never adds again. Version 1 seeded the starters before they had their own
 * reasoning level and version 2 with it; the version no longer changes what the service does.
 */
const MarkerSchema = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  added: Type.Array(Type.String()),
});
type Marker = Static<typeof MarkerSchema>;
const MARKER_VERSION = 2;

/**
 * The marker as written (its other fields kept), null before the seed ran, `unreadable` for one
 * that cannot be read as a marker: what it added is unknown, so the service leaves every starter
 * alone.
 */
async function readMarker(dataDir: string): Promise<Marker | 'unreadable' | null> {
  let text: string;
  try {
    text = await readFile(starterMarkerFile(dataDir), 'utf8');
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
  return Value.Check(MarkerSchema, marker) ? marker : 'unreadable';
}

/** The stored form of a starter, as a seed would write it. */
function stored(draft: CommandCreate): ServiceCommand {
  return CommandStore.storable(CommandStore.compose(draft));
}

/**
 * The words of a stored command, to compare with a starter's copy. Its adjustment suggestions are
 * left out, so a starter seeded before it had any still reads as shipped and takes the current
 * ones; an edit in Settings or by the Agent raises the revision, which keeps the user's.
 */
function wordsOf(command: ServiceCommand) {
  const { name, description, instructions } = command;
  return {
    name,
    description,
    instructions,
    parameters: 'parameters' in command && command.parameters,
  };
}

/**
 * The stored starter `command` should become, or null to leave it as it is. Only a starter the
 * seed added that was never saved (revision 1; every save, the Agent's included, raises it) and
 * still reads as some language's copy, current or retired (`RETIRED_COPY`), is the service's to
 * update: it takes the current shape and the words of `language`. One with other words, which a
 * user may have edited by hand, stays.
 */
function refreshed(
  command: ServiceCommand,
  added: readonly string[],
  language: AppLanguage,
): ServiceCommand | null {
  const id = STARTER_IDS.find((starter) => starter === command.id);
  if (!id || !added.includes(id) || command.revision !== 1) return null;
  const words = wordsOf(command);
  const copies = [
    ...Object.values(STARTER_COPY).map((copy) => copy[id]),
    ...(RETIRED_COPY[id] ?? []),
  ];
  const shipped = copies.some((copy) =>
    isDeepStrictEqual(wordsOf(stored({ id, ...SHAPES[id], ...copy })), words),
  );
  if (!shipped) return null;
  const next = { ...command, ...stored({ id, ...SHAPES[id], ...STARTER_COPY[language][id] }) };
  return isDeepStrictEqual(next, command) ? null : next;
}

/**
 * Adds each starter command to the command store once per data dir, whether it is new or already
 * holds the user's commands, in `language`, and records it in the marker so a starter the user
 * deletes never returns. A data dir seeded before a starter shipped gets it at the next sync. Ids
 * are fixed: a store that already holds one (the user's own command, or a crash between the store
 * write and the marker) keeps its copy, so a retry adds nothing twice.
 *
 * It also brings the starters the user never saved up to date: the shape this build ships them
 * with, in `language`. The service calls it at every start and whenever the language the clients
 * show changes, so they read in the app's language until the user saves them, and writes only when
 * one changes or is added. An unreadable marker leaves every starter alone.
 */
export async function syncStarterCommands(dataDir: string, language: AppLanguage): Promise<void> {
  const marker = await readMarker(dataDir);
  if (marker === 'unreadable') return;
  const added = marker?.added ?? [];
  const store = await CommandStore.load(dataDir);
  const held = new Set(store.data.commands.map((command) => command.id));
  const due = STARTER_IDS.some((id) => !added.includes(id) && !held.has(id));
  const stale = store.data.commands.some((command) => refreshed(command, added, language));
  if (marker && !due && !stale) return;
  const adding = await store.change((data) => {
    data.commands = data.commands.map((command) => refreshed(command, added, language) ?? command);
    const holding = new Set(data.commands.map((command) => command.id));
    const starters = starterCommands(language)
      .map(stored)
      .filter((command) => !added.includes(command.id) && !holding.has(command.id));
    data.commands.push(...starters);
    return starters.map((command) => command.id);
  });
  if (marker && !adding.length) return;
  await atomicWrite(
    starterMarkerFile(dataDir),
    marker
      ? { ...marker, added: [...added, ...adding] }
      : { version: MARKER_VERSION, seededAt: new Date().toISOString(), added: adding },
  );
}
