import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Type, type Static } from 'typebox';
import { parse } from '@ai/agent-contracts';
import { atomicWrite } from '../config.js';

/**
 * Service policy file: the migrated global permission tier plus the memory
 * paused flag. Per-task tiers travel with their tasks; this file only owns
 * the service defaults for new tasks.
 *
 * Path (freeze candidate): `<dataDir>/policy.json`.
 */
export const ServicePolicySchema = Type.Object(
  {
    version: Type.Literal(1),
    defaultTier: Type.Union([Type.Literal('manual'), Type.Literal('auto'), Type.Literal('always')]),
    memoryPaused: Type.Boolean(),
    migratedAt: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);
export type ServicePolicy = Static<typeof ServicePolicySchema>;

export function policyFile(dataDir: string): string {
  return path.join(dataDir, 'policy.json');
}

export async function loadPolicy(dataDir: string): Promise<ServicePolicy | null> {
  try {
    if ((await stat(policyFile(dataDir))).size > 64 * 1024)
      throw new Error('Policy file is too large.');
    return parse(ServicePolicySchema, JSON.parse(await readFile(policyFile(dataDir), 'utf8')));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw new Error('Saved service policy could not be read. The file is preserved.');
  }
}

/** Writes policy idempotently; divergent values conflict instead of merging. */
export async function importPolicy(
  dataDir: string,
  source: { defaultTier: string; memoryPaused: boolean },
  at: string,
): Promise<'inserted' | 'identical'> {
  const tier =
    source.defaultTier === 'auto' || source.defaultTier === 'always'
      ? source.defaultTier
      : 'manual';
  const existing = await loadPolicy(dataDir);
  const next: ServicePolicy = {
    version: 1,
    defaultTier: tier,
    memoryPaused: source.memoryPaused,
    migratedAt: at,
  };
  if (!existing) {
    await atomicWrite(policyFile(dataDir), parse(ServicePolicySchema, next));
    return 'inserted';
  }
  if (existing.defaultTier !== next.defaultTier || existing.memoryPaused !== next.memoryPaused)
    throw new Error('Service policy diverged since migration; refusing to overwrite.');
  return 'identical';
}
