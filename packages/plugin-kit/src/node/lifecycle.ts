import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { normalizePlugin } from '../formats/index.js';
import type { PluginSourceSpec } from '../model/manifest.js';
import { isPluginName } from '../model/names.js';
import type { InstallPreview, InstalledPlugin } from '../model/records.js';
import type { Clock, Logger, SecretStore } from '../ports.js';
import { fetchSource, sourceIdentity, type FetchContext } from './fetch.js';
import { createNodeFs } from './fs.js';
import { collectGarbage } from './gc.js';
import { hashTree } from './hash.js';
import type { Mutex } from './mutex.js';
import { buildReview } from './review.js';
import { readPreview, removeExpiredStaging, stagingPaths, writePreview } from './staging.js';
import type { Store, StorePaths } from './store.js';

/** Everything the install lifecycle shares with the installer facade. */
export interface InstallerContext {
  paths: StorePaths;
  store: Store;
  mutex: Mutex;
  secrets: SecretStore;
  clock: Clock;
  logger: Logger;
  fetch: FetchContext;
  previewTtlMs: number;
  /** Staging generations still being fetched, which expiry cleanup must skip. */
  fetching: Set<string>;
}

/** Same plugin id, different source identity. */
export class PluginConflictError extends Error {
  constructor(
    readonly pluginId: string,
    message: string,
  ) {
    super(message);
    this.name = 'PluginConflictError';
  }
}

function describeSource(source: PluginSourceSpec): string {
  switch (source.kind) {
    case 'local':
      return source.path;
    case 'npm':
      return `npm ${source.spec}`;
    case 'git':
      return source.subdir === undefined ? source.url : `${source.url} (${source.subdir})`;
  }
}

/** Removes superseded revisions that no run references. Callers hold the mutex. */
export async function runGarbageCollection(context: InstallerContext): Promise<void> {
  const registry = await context.store.readRegistry();
  const refs = await context.store.readRefs();
  const removed = await collectGarbage(context.paths.revisions, registry, refs);
  if (removed.length > 0) context.logger.info('Removed unused plugin revisions', { removed });
}

/**
 * Fetches and normalizes `source` into a fresh staging generation. The fetch runs outside the
 * mutex so slow downloads do not block state changes; only the expiry sweep is serialized.
 */
export async function previewSource(
  context: InstallerContext,
  source: PluginSourceSpec,
): Promise<InstallPreview> {
  const { paths, clock } = context;
  await context.mutex.run(() => removeExpiredStaging(paths.staging, clock.now(), context.fetching));
  const previewId = randomUUID();
  const staging = stagingPaths(paths.staging, previewId);
  context.fetching.add(previewId);
  try {
    await mkdir(staging.work, { recursive: true });
    const fetched = await fetchSource(
      source,
      { tree: staging.tree, workDir: staging.work },
      context.fetch,
    );
    await rm(staging.work, { recursive: true, force: true });
    for (const warning of fetched.warnings ?? []) context.logger.warn(warning, { source });
    const fs = createNodeFs(staging.tree);
    const plugin = await normalizePlugin(fs, { fallbackName: fetched.fallbackName });
    if (!isPluginName(plugin.manifest.name)) {
      throw new Error(`"${plugin.manifest.name}" is not a valid plugin name.`);
    }
    const revision = await hashTree(staging.tree);
    const review = await buildReview(plugin, fs);
    const current = (await context.store.readRegistry()).plugins.find(
      (installed) => installed.id === plugin.manifest.name,
    );
    const preview: InstallPreview = {
      previewId,
      expiresAt: new Date(clock.now().getTime() + context.previewTtlMs).toISOString(),
      source: fetched.source,
      resolved: fetched.resolved,
      revision,
      plugin,
      ...(current === undefined
        ? {}
        : { existing: { revision: current.revision, source: current.source } }),
      review,
    };
    await writePreview(paths.staging, preview);
    return preview;
  } catch (error) {
    await rm(staging.dir, { recursive: true, force: true });
    throw error;
  } finally {
    context.fetching.delete(previewId);
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Publishes a preview. State is read before any file moves so a malformed state file stops the
 * install early, and a new plugin is written to `disabled` before it appears in the registry.
 */
export function installPreview(
  context: InstallerContext,
  previewId: string,
): Promise<InstalledPlugin> {
  const { paths, store, clock } = context;
  return context.mutex.run(async () => {
    await removeExpiredStaging(paths.staging, clock.now(), context.fetching);
    const preview = await readPreview(paths.staging, previewId);
    if (preview === null) {
      throw new Error(`The install preview "${previewId}" does not exist or has expired.`);
    }
    const id = preview.plugin.manifest.name;
    const registry = await store.readRegistry();
    const state = await store.readState();
    const current = registry.plugins.find((installed) => installed.id === id);
    if (
      current !== undefined &&
      sourceIdentity(current.source) !== sourceIdentity(preview.source)
    ) {
      throw new PluginConflictError(
        id,
        `A plugin named "${id}" is already installed from ${describeSource(current.source)}.`,
      );
    }
    const staging = stagingPaths(paths.staging, previewId);
    const target = paths.revision(id, preview.revision);
    await mkdir(paths.pluginRevisions(id), { recursive: true });
    // Revisions are content hashes, so an existing directory already holds identical files.
    if (!(await exists(target))) await rename(staging.tree, target);
    await rm(staging.dir, { recursive: true, force: true });

    const now = clock.now().toISOString();
    const record: InstalledPlugin = {
      id,
      source: preview.source,
      resolved: preview.resolved,
      revision: preview.revision,
      plugin: preview.plugin,
      installedAt: current?.installedAt ?? now,
      updatedAt: now,
    };
    if (current === undefined) {
      if (!state.disabled.includes(id)) state.disabled.push(id);
      await store.writeState(state);
      registry.plugins.push(record);
    } else {
      registry.plugins = registry.plugins.map((installed) =>
        installed.id === id ? record : installed,
      );
    }
    await store.writeRegistry(registry);
    await runGarbageCollection(context);
    return record;
  });
}

/**
 * Removes an installed plugin. Its state is cleared while it stays in `disabled`, so a failure
 * before the registry write can never leave it enabled with stale item switches or config.
 */
export function uninstallPlugin(context: InstallerContext, pluginId: string): Promise<void> {
  const { paths, store } = context;
  return context.mutex.run(async () => {
    const registry = await store.readRegistry();
    const record = registry.plugins.find((installed) => installed.id === pluginId);
    if (record === undefined) throw new Error(`The plugin "${pluginId}" is not installed.`);
    await store.updateState((state) => {
      delete state.items[pluginId];
      delete state.config[pluginId];
      if (!state.disabled.includes(pluginId)) state.disabled.push(pluginId);
    });
    registry.plugins = registry.plugins.filter((installed) => installed.id !== pluginId);
    await store.writeRegistry(registry);
    await store.updateState((state) => {
      state.disabled = state.disabled.filter((id) => id !== pluginId);
    });
    for (const option of record.plugin.userConfig) {
      if (option.sensitive) await context.secrets.delete(pluginId, option.key);
    }
    await rm(paths.data(pluginId), { recursive: true, force: true });
    await runGarbageCollection(context);
  });
}
