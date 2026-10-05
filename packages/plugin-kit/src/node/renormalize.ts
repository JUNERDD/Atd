import { Value } from 'typebox/value';
import { InvalidPluginError, normalizePlugin } from '../formats/index.js';
import { NormalizedPluginSchema, type NormalizedPlugin } from '../model/manifest.js';
import type { InstalledPlugin } from '../model/records.js';
import { sourceFallbackName } from './fetch.js';
import { createNodeFs } from './fs.js';
import { exists, type InstallerContext } from './lifecycle.js';

/** A revision's model under the current adapters, or why it no longer loads as its record. */
type Renormalized = { plugin: NormalizedPlugin } | { problem: string; error?: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Normalizes a published revision again with the fallback name its recorded source gave it at
 * install time. What would not install as this record today (missing files, a rejected bundle,
 * another plugin name, an invalid model) or fails unexpectedly comes back as a problem.
 */
async function normalizeRevision(
  context: InstallerContext,
  record: InstalledPlugin,
): Promise<Renormalized> {
  let plugin: NormalizedPlugin;
  try {
    const root = context.paths.revision(record.id, record.revision);
    if (!(await exists(root))) return { problem: 'The installed files are missing.' };
    const fallbackName = sourceFallbackName(record.source);
    plugin = await normalizePlugin(createNodeFs(root), { fallbackName });
  } catch (error) {
    if (error instanceof InvalidPluginError) return { problem: error.message };
    return { problem: 'The installed files could not be read.', error: messageOf(error) };
  }
  if (plugin.manifest.name !== record.id) {
    return { problem: `The installed files now load as a plugin named "${plugin.manifest.name}".` };
  }
  if (!Value.Check(NormalizedPluginSchema, plugin)) {
    return { problem: 'The installed files do not produce a valid plugin.' };
  }
  return { plugin };
}

/**
 * The model of a plugin whose revision no longer loads: no components, so nothing an earlier
 * adapter accepted keeps running, and one error saying why. Its manifest and user config stay,
 * so Settings still shows the plugin and uninstalling it still finds its secrets.
 */
function unloaded(stored: NormalizedPlugin, problem: string): NormalizedPlugin {
  const message = `${problem} The plugin's items stay unavailable until it is updated or reinstalled.`;
  return {
    ...stored,
    components: [],
    diagnostics: [{ level: 'error', code: 'invalid-manifest', message: message.slice(0, 2000) }],
  };
}

/**
 * Normalizes every installed revision again and stores each model that changed (installer
 * `renormalize`). It holds the mutex throughout, so no install, uninstall or garbage collection
 * changes a record or removes its revision meanwhile; the registry is written only when a model
 * changed.
 */
export function renormalizeInstalled(context: InstallerContext): Promise<void> {
  const { store, logger } = context;
  return context.mutex.run(async () => {
    const registry = await store.readRegistry();
    const changed: string[] = [];
    for (const [index, record] of registry.plugins.entries()) {
      const outcome = await normalizeRevision(context, record);
      if ('problem' in outcome) {
        const { problem, error } = outcome;
        logger.warn('An installed plugin no longer loads; its items stay unavailable', {
          pluginId: record.id,
          revision: record.revision,
          problem,
          ...(error === undefined ? {} : { error }),
        });
      }
      const plugin =
        'plugin' in outcome ? outcome.plugin : unloaded(record.plugin, outcome.problem);
      if (Value.Equal(plugin, record.plugin)) continue;
      registry.plugins[index] = { ...record, plugin };
      changed.push(record.id);
    }
    if (changed.length === 0) return;
    await store.writeRegistry(registry);
    logger.info('Installed plugins were normalized again with the current adapters', { changed });
  });
}
