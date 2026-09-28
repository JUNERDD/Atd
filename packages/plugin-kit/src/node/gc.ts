import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { PluginRegistryFile } from '../model/records.js';
import type { PluginRefsFile } from './store.js';

async function listDirs(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * Deletes every `revisions/<id>/<revision>` that is neither a plugin's current revision nor
 * frozen by a run, then any `revisions/<id>` left empty. Returns the removed `<id>/<revision>`s.
 */
export async function collectGarbage(
  revisionsRoot: string,
  registry: PluginRegistryFile,
  refs: PluginRefsFile,
): Promise<string[]> {
  const keep = new Set(registry.plugins.map((plugin) => `${plugin.id}/${plugin.revision}`));
  for (const run of Object.values(refs.runs)) {
    for (const ref of run) keep.add(`${ref.id}/${ref.revision}`);
  }
  const removed: string[] = [];
  for (const id of await listDirs(revisionsRoot)) {
    const pluginDir = path.join(revisionsRoot, id);
    const revisions = await listDirs(pluginDir);
    let kept = 0;
    for (const revision of revisions) {
      if (keep.has(`${id}/${revision}`)) {
        kept += 1;
        continue;
      }
      await rm(path.join(pluginDir, revision), { recursive: true, force: true });
      removed.push(`${id}/${revision}`);
    }
    if (kept === 0) await rm(pluginDir, { recursive: true, force: true });
  }
  return removed;
}
