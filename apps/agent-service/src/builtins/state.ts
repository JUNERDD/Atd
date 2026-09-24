import { readFile } from 'node:fs/promises';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { atomicWrite } from '../config.js';
import type { BuiltinEntry } from './manifest.js';

/** The builtin version and content fingerprint last installed (or found identical) at a location. */
export interface InstallRecord {
  version: number;
  fingerprint: string;
  installedAt: string;
}

const InstallStateSchema = Type.Object({
  version: Type.Literal(1),
  resources: Type.Record(
    Type.String(),
    Type.Object({
      version: Type.Integer({ minimum: 0 }),
      fingerprint: Type.String({ pattern: '^[0-9a-f]{64}$' }),
      installedAt: Type.String(),
    }),
  ),
});

type InstallState = { version: 1; resources: Record<string, InstallRecord> };

/**
 * Reads an install-state file (`<atdHome>/.builtins.json` for skills,
 * `<dataDir>/skills/builtins.json` for the role). A missing or unreadable file means no records:
 * every copy is then compared with the shipped history, which never overwrites a changed copy.
 */
export async function readInstallState(file: string): Promise<Record<string, InstallRecord>> {
  return (await readState(file)).resources;
}

/** Records that `entry`'s shipped version with `fingerprint` now sits at the location. */
export async function recordInstall(
  file: string,
  entry: BuiltinEntry,
  fingerprint: string,
): Promise<InstallRecord> {
  const state = await readState(file);
  const record = { version: entry.version, fingerprint, installedAt: new Date().toISOString() };
  state.resources[entry.id] = record;
  await atomicWrite(file, state);
  return record;
}

async function readState(file: string): Promise<InstallState> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return { version: 1, resources: {} };
  }
  return Value.Check(InstallStateSchema, parsed)
    ? { version: 1, resources: { ...parsed.resources } }
    : { version: 1, resources: {} };
}

const queues = new Map<string, Promise<unknown>>();

/**
 * Runs `task` after every earlier task with the same key (a location's root), so reconciling,
 * restoring and role writes in this process never interleave. The service's single-instance lock
 * keeps other processes out.
 */
export function withBuiltinLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return next;
}
