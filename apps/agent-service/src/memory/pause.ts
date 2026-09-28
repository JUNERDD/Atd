import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite } from '../config.js';

/**
 * The persisted memory pause, beside the Hermes files in the memory authority's own agentDir.
 * Pausing stops learning (memory/authority.ts `canLearn`); it survives a service restart, and the
 * switch of Personal's memory item is this same flag (plugins/host-plugins.ts), never a copy of it.
 */
interface PauseFile {
  version: 1;
  paused: boolean;
}

function pauseFile(agentDir: string): string {
  return path.join(agentDir, 'memory-pause.json');
}

/** Whether learning is paused. A missing file means it is not; an unreadable one is preserved. */
export async function readMemoryPause(agentDir: string): Promise<boolean> {
  const file = pauseFile(agentDir);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw new Error(`Memory pause ${file} could not be read. The original file is preserved.`);
  }
  if (typeof parsed !== 'object' || parsed === null) return false;
  return Reflect.get(parsed, 'version') === 1 && Reflect.get(parsed, 'paused') === true;
}

export async function writeMemoryPause(agentDir: string, paused: boolean): Promise<void> {
  const file: PauseFile = { version: 1, paused };
  await atomicWrite(pauseFile(agentDir), file);
}
