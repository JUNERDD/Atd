import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { SkillRevisionRecord } from '../skills/versions.js';
import { pluginHostPath, type PluginHost } from './host.js';
import { pluginSkillSet } from './skill-set.js';

/**
 * Rendered skill bodies (`plugin-host/rendered/<hash>/SKILL.md`, plugins/map.ts `mapSkill`) are
 * kept while a current plugin skill or an unreleased run (plugins/run-snapshot.ts) points at
 * them. A younger entry is always kept: a freeze may have rendered it and not yet recorded it.
 */
const MIN_AGE_MS = 10 * 60 * 1000;

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** The rendered hashes `records` point at (records whose entry is the revision's own are skipped). */
export function renderedHashes(
  host: PluginHost,
  records: readonly SkillRevisionRecord[],
): string[] {
  const root = host.hostDir('rendered');
  return records
    .filter((record) => path.dirname(path.dirname(record.entry)) === root)
    .map((record) => path.basename(path.dirname(record.entry)));
}

/** Rendered hashes every unreleased run holds. */
async function retainedHashes(dataDir: string): Promise<Set<string>> {
  const held = new Set<string>();
  const dir = pluginHostPath(dataDir, 'runs');
  const names = await readdir(dir).catch((error: unknown) => {
    if (isMissing(error)) return [];
    throw error;
  });
  for (const name of names.filter((entry) => entry.endsWith('.json'))) {
    const raw: unknown = JSON.parse(await readFile(path.join(dir, name), 'utf8'));
    const rendered = typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'rendered') : null;
    if (Array.isArray(rendered))
      for (const hash of rendered) if (typeof hash === 'string') held.add(hash);
  }
  return held;
}

/**
 * Removes rendered bodies that no current plugin skill and no unreleased run references, after a
 * run is released and after a plugin is uninstalled, updated or reconfigured. Failures are logged:
 * collection never fails the operation that triggered it. Answers how many entries it removed.
 */
export async function collectRenderedSkills(host: PluginHost): Promise<number> {
  try {
    const root = host.hostDir('rendered');
    const entries = await readdir(root).catch((error: unknown) => {
      if (isMissing(error)) return [];
      throw error;
    });
    if (!entries.length) return 0;
    const current = await pluginSkillSet(host, await host.view());
    const keep = new Set([
      ...renderedHashes(host, current.records),
      ...(await retainedHashes(host.dataDir)),
    ]);
    let removed = 0;
    for (const entry of entries) {
      if (keep.has(entry)) continue;
      const dir = path.join(root, entry);
      if (Date.now() - (await stat(dir)).mtimeMs < MIN_AGE_MS) continue;
      await rm(dir, { recursive: true, force: true });
      removed += 1;
    }
    return removed;
  } catch (error) {
    host.log.warn('Rendered plugin skills could not be collected.', { error: String(error) });
    return 0;
  }
}
