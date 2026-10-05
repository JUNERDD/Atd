import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { MemoryProblem } from '@atd/agent-contracts';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { atomicWrite } from '../config.js';

/**
 * The learning settings, `<memory root>/settings.json`: `paused` stops every automatic memory
 * write (tool writes and learners) but never reads or edits in Settings; `askFirst` routes every
 * learner write to the suggestions instead of applying it.
 */
export interface MemorySettings {
  paused: boolean;
  askFirst: boolean;
}

const SettingsFileSchema = Type.Object(
  { version: Type.Literal(1), paused: Type.Boolean(), askFirst: Type.Boolean() },
  { additionalProperties: false },
);

function settingsFile(root: string): string {
  return path.join(root, 'settings.json');
}

/**
 * The saved settings; a missing file means the defaults. A file that does not hold valid settings
 * pauses learning, the one setting that cannot write anything unasked, and stays as it is until
 * the user changes a setting; the problem says so.
 */
export async function readMemorySettings(
  root: string,
): Promise<{ settings: MemorySettings; problem: MemoryProblem | null }> {
  const file = settingsFile(root);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { settings: { paused: false, askFirst: false }, problem: null };
    parsed = undefined;
  }
  if (Value.Check(SettingsFileSchema, parsed))
    return { settings: { paused: parsed.paused, askFirst: parsed.askFirst }, problem: null };
  return {
    settings: { paused: true, askFirst: false },
    problem: {
      path: file,
      message:
        'Memory settings could not be read, so learning is paused. Changing a learning setting saves new settings.',
    },
  };
}

export async function writeMemorySettings(root: string, settings: MemorySettings): Promise<void> {
  await atomicWrite(settingsFile(root), {
    version: 1,
    paused: settings.paused,
    askFirst: settings.askFirst,
  });
}
