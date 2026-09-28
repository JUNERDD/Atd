import { mkdir } from 'node:fs/promises';
import type { UserConfigOption, PluginSourceSpec } from '../model/manifest.js';
import type {
  ConfigValues,
  InstallPreview,
  InstalledPlugin,
  PluginRunSnapshot,
  PluginStateFile,
} from '../model/records.js';
import {
  silentLogger,
  systemClock,
  type Clock,
  type Logger,
  type ReadonlyFs,
  type SecretStore,
} from '../ports.js';
import { applyConfig, collectConfig } from './config.js';
import { isomorphicGitClone, type GitClone } from './fetch-git.js';
import { createNodeFs } from './fs.js';
import {
  installPreview,
  previewSource,
  runGarbageCollection,
  uninstallPlugin,
  type InstallerContext,
} from './lifecycle.js';
import { DEFAULT_LIMITS } from './limits.js';
import { createMutex } from './mutex.js';
import { createStore, storePaths } from './store.js';

export { PluginConflictError } from './lifecycle.js';
export type { GitClone, GitCloneInput } from './fetch-git.js';

/** Fetch and size limits applied to every staging generation. */
export interface FetchLimits {
  /** Total extracted bytes (default 50 MiB). */
  maxBytes: number;
  /** Total extracted files (default 5000). */
  maxFiles: number;
}

export interface PluginInstallerOptions {
  /** Directory the installer owns: registry.json, state.json, refs.json, revisions/, data/, staging/. */
  root: string;
  secrets: SecretStore;
  clock?: Clock;
  logger?: Logger;
  /** npm registry base URL (default https://registry.npmjs.org). */
  npmRegistry?: string;
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
  limits?: Partial<FetchLimits>;
  /** How long an unconfirmed preview's staging survives (default 15 minutes). */
  previewTtlMs?: number;
  /**
   * Test seam for git sources: clones into a new directory and reports the checked-out commit.
   * Defaults to an isomorphic-git shallow clone over HTTPS.
   */
  gitClone?: GitClone;
}

/**
 * Owns installed plugin files and state. All writes are atomic; a malformed registry or state
 * file is preserved and reported, never overwritten. Methods are safe to call concurrently
 * (serialized internally).
 */
export interface PluginInstaller {
  /**
   * Fetches `source` into staging (local copy, git clone at the resolved commit, or npm tarball
   * verified against its SRI integrity; no lifecycle scripts ever run), normalizes it and keeps
   * the staging for `previewTtlMs`. Throws `InvalidPluginError` for an unusable bundle.
   */
  preview(source: PluginSourceSpec): Promise<InstallPreview>;
  /**
   * Publishes a preview as an immutable revision. A new plugin lands disabled. An existing
   * plugin with the same id is updated in place (state, config and approvals kept) only when
   * its source has the same identity; otherwise this throws `PluginConflictError`.
   */
  install(previewId: string): Promise<InstalledPlugin>;
  /** Re-fetches an installed plugin's recorded source into a new preview. */
  previewUpdate(pluginId: string): Promise<InstallPreview>;
  /** Removes the record, state, secrets and data dir; revision dirs go when unreferenced. */
  uninstall(pluginId: string): Promise<void>;

  list(): Promise<InstalledPlugin[]>;
  get(pluginId: string): Promise<InstalledPlugin | null>;
  /** Absolute path of a published revision directory. */
  revisionDir(pluginId: string, revision: string): string;
  /** Absolute path of a plugin's persistent data directory (created on demand). */
  dataDir(pluginId: string): Promise<string>;
  /** Read-only view of a published revision. */
  revisionFs(pluginId: string, revision: string): ReadonlyFs;

  readState(): Promise<PluginStateFile>;
  setPluginEnabled(pluginId: string, enabled: boolean): Promise<void>;
  setItemEnabled(pluginId: string, itemKey: string, enabled: boolean): Promise<void>;
  setServerApproved(pluginId: string, server: string, approved: boolean): Promise<void>;
  /**
   * Validates values against `options`; sensitive values go to the SecretStore, the rest to
   * state. A `null` value clears the key.
   */
  setConfig(
    pluginId: string,
    options: UserConfigOption[],
    values: Record<string, ConfigValues[string] | null>,
  ): Promise<void>;
  /** Non-sensitive values plus sensitive values read from the SecretStore. */
  readConfig(pluginId: string, options: UserConfigOption[]): Promise<ConfigValues>;

  /** Records that `runId` uses the revisions in `snapshot`, so GC keeps them. */
  retain(runId: string, snapshot: PluginRunSnapshot): Promise<void>;
  /** Drops `runId`'s references and garbage-collects unreferenced, superseded revisions. */
  release(runId: string): Promise<void>;
}

/** Adds or removes `value` so that its presence in `list` matches `present`. */
function setMembership(list: string[] | undefined, value: string, present: boolean): string[] {
  const without = (list ?? []).filter((entry) => entry !== value);
  return present ? [...without, value] : without;
}

/** Stores a per-plugin list, dropping the key when the list is empty. */
function putList(record: Record<string, string[]>, pluginId: string, list: string[]): void {
  if (list.length === 0) delete record[pluginId];
  else record[pluginId] = list;
}

export function createPluginInstaller(options: PluginInstallerOptions): PluginInstaller {
  const paths = storePaths(options.root);
  const store = createStore(paths);
  const mutex = createMutex();
  const context: InstallerContext = {
    paths,
    store,
    mutex,
    secrets: options.secrets,
    clock: options.clock ?? systemClock,
    logger: options.logger ?? silentLogger,
    fetch: {
      limits: { ...DEFAULT_LIMITS, ...options.limits },
      fetch: options.fetch ?? globalThis.fetch,
      npmRegistry: options.npmRegistry ?? 'https://registry.npmjs.org',
      gitClone: options.gitClone ?? isomorphicGitClone,
    },
    previewTtlMs: options.previewTtlMs ?? 15 * 60 * 1000,
    fetching: new Set(),
  };
  const updateState = (change: (state: PluginStateFile) => void) =>
    mutex.run(() => store.updateState(change));

  return {
    preview: (source) => previewSource(context, source),
    install: (previewId) => installPreview(context, previewId),
    async previewUpdate(pluginId) {
      const record = (await store.readRegistry()).plugins.find((plugin) => plugin.id === pluginId);
      if (record === undefined) throw new Error(`The plugin "${pluginId}" is not installed.`);
      return previewSource(context, record.source);
    },
    uninstall: (pluginId) => uninstallPlugin(context, pluginId),

    list: async () => (await store.readRegistry()).plugins,
    get: async (pluginId) =>
      (await store.readRegistry()).plugins.find((plugin) => plugin.id === pluginId) ?? null,
    revisionDir: (pluginId, revision) => paths.revision(pluginId, revision),
    async dataDir(pluginId) {
      const directory = paths.data(pluginId);
      await mkdir(directory, { recursive: true });
      return directory;
    },
    revisionFs: (pluginId, revision) => createNodeFs(paths.revision(pluginId, revision)),

    readState: () => store.readState(),
    setPluginEnabled: (pluginId, enabled) =>
      updateState((state) => {
        state.disabled = setMembership(state.disabled, pluginId, !enabled);
      }),
    setItemEnabled: (pluginId, itemKey, enabled) =>
      updateState((state) => {
        putList(state.items, pluginId, setMembership(state.items[pluginId], itemKey, !enabled));
      }),
    setServerApproved: (pluginId, server, approved) =>
      updateState((state) => {
        putList(
          state.approved,
          pluginId,
          setMembership(state.approved[pluginId], server, approved),
        );
      }),
    setConfig: (pluginId, configOptions, values) =>
      mutex.run(async () => {
        const state = await store.readState();
        await applyConfig(pluginId, configOptions, values, state, options.secrets);
        await store.writeState(state);
      }),
    readConfig: async (pluginId, configOptions) =>
      collectConfig(pluginId, configOptions, await store.readState(), options.secrets),

    retain: (runId, snapshot) =>
      mutex.run(async () => {
        const refs = await store.readRefs();
        refs.runs[runId] = snapshot.plugins.map(({ id, revision }) => ({ id, revision }));
        await store.writeRefs(refs);
      }),
    release: (runId) =>
      mutex.run(async () => {
        const refs = await store.readRefs();
        if (runId in refs.runs) {
          delete refs.runs[runId];
          await store.writeRefs(refs);
        }
        await runGarbageCollection(context);
      }),
  };
}
