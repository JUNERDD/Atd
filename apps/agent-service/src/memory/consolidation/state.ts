import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { MemoryUnit } from '@atd/agent-contracts';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { atomicWrite } from '../../config.js';
import { memoryRoot } from '../unit-store.js';

/**
 * What the last consolidation left behind, `<memory root>/consolidation.json`: the fingerprint of
 * the enabled units once it finished, so a consolidation of memory that has not changed since ends
 * without a model call. Only the consolidation reads or writes this file.
 */
const StateFileSchema = Type.Object(
  {
    version: Type.Literal(1),
    fingerprint: Type.String({ minLength: 1, maxLength: 128 }),
    consolidatedAt: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
);

function stateFile(agentDir: string): string {
  return path.join(memoryRoot(agentDir), 'consolidation.json');
}

/**
 * A digest of what a consolidation reads: each enabled unit's id and content, in id order. The
 * review flag and the revision stay out, so opening a New memory, which rewrites its file, does not
 * cost the next consolidation a model call.
 */
export function memoryFingerprint(units: readonly MemoryUnit[]): string {
  const content = [...units]
    .filter((unit) => unit.enabled)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((unit) => [
      unit.id,
      unit.name,
      unit.type,
      unit.category,
      unit.activation,
      unit.source,
      unit.description,
      unit.body,
    ]);
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

/** The fingerprint the last consolidation stored; a missing or unreadable file holds none. */
export async function lastFingerprint(agentDir: string): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(stateFile(agentDir), 'utf8'));
  } catch {
    return null;
  }
  return Value.Check(StateFileSchema, parsed) ? parsed.fingerprint : null;
}

export async function storeFingerprint(
  agentDir: string,
  fingerprint: string,
  at: Date,
): Promise<void> {
  await atomicWrite(stateFile(agentDir), {
    version: 1,
    fingerprint,
    consolidatedAt: at.toISOString(),
  });
}
