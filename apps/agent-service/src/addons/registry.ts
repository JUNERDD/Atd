import { readdir } from 'node:fs/promises';
import {
  COMPUTER_ADDONS,
  WPS_SELECTION_ADDON,
  errorMessage,
  type AddonErrorCode,
  type AddonView,
} from '@atd/agent-contracts';
import { ConflictError } from '../errors.js';
import { LedgerNotFound } from '../ledger.js';
import type { Logger } from '../logging.js';
import { AddonAutoUpdater, type AutoUpdateJob } from './auto-update.js';
import { AddonFailure } from './failure.js';
import { loadAddonCatalog, type AddonCatalog } from './lock.js';
import {
  addonsRoot,
  clearStaging,
  collectGarbage,
  loadAddonState,
  removeAddonDir,
  resolveInstalled,
  RETIRED_ADDONS,
  saveAddonState,
  type AddonRecord,
  type AddonState,
  type InstalledAddon,
} from './store.js';

export type AddonUseCheck = () => string | null;

interface StoredAddonError {
  code: AddonErrorCode;
  message: string;
  source: 'install' | 'remove';
}

/**
 * The service's add-ons (design §6–8): pinned archives (lock.ts), active installs (`state.json`),
 * per-id jobs, auto-update/retry/dev-lock coordination (auto-update.ts), and consumer removal
 * checks. Listeners hear every view change except download progress.
 */
export class AddonRegistry {
  private readonly jobs = new Map<string, AutoUpdateJob>();
  private readonly errors = new Map<string, StoredAddonError>();
  private readonly checks = new Map<string, AddonUseCheck[]>();
  private readonly listeners = new Set<() => void>();
  private readonly autoUpdater: AddonAutoUpdater;
  private writes = Promise.resolve();
  private stopping = false;

  private constructor(
    private readonly dataDir: string,
    private catalog: AddonCatalog,
    development: boolean,
    private readonly log: Logger,
    private state: AddonState,
    private readonly active: Map<string, InstalledAddon>,
  ) {
    this.autoUpdater = new AddonAutoUpdater({
      dataDir,
      development,
      log,
      isStopping: () => this.stopping,
      catalog: () => this.catalog,
      setCatalog: (next) => (this.catalog = next),
      activeIds: () => this.active.keys(),
      hasActive: (id) => this.active.has(id),
      isCurrent: (id) => this.installed(id) !== undefined,
      job: (id) => this.jobs.get(id),
      setJob: (id, job) => this.jobs.set(id, job),
      deleteJob: (id) => this.jobs.delete(id),
      jobs: () => this.jobs.entries(),
      clearError: (id) => void this.errors.delete(id),
      recordInstallError: (id, error) => this.errors.set(id, { ...error, source: 'install' }),
      activate: (id, record) => this.activate(id, record),
      notifyChanged: () => this.changed(),
    });
  }

  /** Loads lock + state, clears staging, drops missing/retired installs, and runs GC. */
  static async create(options: {
    dataDir: string;
    development: boolean;
    log: Logger;
  }): Promise<AddonRegistry> {
    const { dataDir, log } = options;
    const catalog = await loadAddonCatalog(options);
    await clearStaging(dataDir);
    const loaded = await loadAddonState(dataDir, log);
    const active = new Map<string, InstalledAddon>();
    const state: AddonState = { schemaVersion: 1, active: {} };
    for (const [id, record] of Object.entries(loaded.active)) {
      if (RETIRED_ADDONS.has(id)) {
        log.info('A retired add-on was removed.', { id });
        continue;
      }
      const installed = await resolveInstalled(dataDir, id, record);
      if (installed) {
        active.set(id, installed);
        state.active[id] = record;
      } else log.warn('An installed add-on is missing or changed; it counts as removed.', { id });
    }
    if (Object.keys(state.active).length !== Object.keys(loaded.active).length)
      await saveAddonState(dataDir, state);
    const dirs = await readdir(addonsRoot(dataDir), { withFileTypes: true }).catch(() => []);
    for (const dir of dirs)
      if (dir.isDirectory() && !dir.name.startsWith('.'))
        await (RETIRED_ADDONS.has(dir.name)
          ? removeAddonDir(dataDir, dir.name)
          : collectGarbage(dataDir, dir.name, state.active[dir.name]?.sha256));
    log.info('Add-ons loaded.', { lock: catalog.source, active: [...active.keys()] });
    return new AddonRegistry(dataDir, catalog, options.development, log, state, active);
  }

  ids(): string[] {
    const ids = new Set([...COMPUTER_ADDONS, WPS_SELECTION_ADDON, ...this.catalog.ids]);
    return [...ids].filter((id) => !RETIRED_ADDONS.has(id)).sort();
  }

  list(): AddonView[] {
    return this.ids().map((id) => this.view(id));
  }

  /** One add-on's view; an id this build does not know is a 404. */
  view(id: string): AddonView {
    if (!this.ids().includes(id)) throw new LedgerNotFound('Add-on', id);
    const artifact = this.catalog.artifacts.get(id);
    const job = this.jobs.get(id);
    const active = this.active.get(id);
    const current = this.installed(id);
    const error = this.errors.get(id);
    return {
      id,
      available: artifact !== undefined,
      ...(artifact ? { version: artifact.version, size: artifact.size } : {}),
      phase: job?.phase ?? 'idle',
      ...(job?.phase === 'downloading' && artifact
        ? { progress: { received: job.received, total: artifact.size } }
        : {}),
      ...(current
        ? {
            installed: {
              version: current.version,
              sha256: current.sha256,
              root: current.root,
              entries: current.entries,
            },
          }
        : {}),
      ...(active && !current ? { outdated: { version: active.version } } : {}),
      ...(error ? { error: { code: error.code, message: error.message } } : {}),
    };
  }

  /** The active install of an add-on, only when it is exactly the archive this build pins. */
  installed(id: string): InstalledAddon | undefined {
    const active = this.active.get(id);
    return active && active.sha256 === this.catalog.artifacts.get(id)?.sha256 ? active : undefined;
  }

  isOutdated(id: string): boolean {
    return this.active.has(id) && this.installed(id) === undefined;
  }

  /** Last install/update failure for `id`, excluding cancellations and removal errors. */
  lastUpdateError(id: string): { code: AddonErrorCode; message: string } | undefined {
    const error = this.errors.get(id);
    if (!error || error.source !== 'install' || error.code === 'cancelled') return undefined;
    return { code: error.code, message: error.message };
  }

  /** Ensures an already-installed (`outdated`) add-on matches the lock; never installs new ones. */
  async ensureInstalled(id: string, signal?: AbortSignal): Promise<InstalledAddon | undefined> {
    await this.autoUpdater.ensureCurrent(id, signal);
    return this.installed(id);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  useBy(ids: readonly string[], check: AddonUseCheck): void {
    for (const id of ids) this.checks.set(id, [...(this.checks.get(id) ?? []), check]);
  }

  install(id: string): AddonView {
    this.view(id);
    this.autoUpdater.clearRetry(id);
    const running = this.jobs.get(id);
    if (running) {
      if (running.phase !== 'removing') running.background = false;
      return this.view(id);
    }
    if (this.installed(id)) return this.view(id);
    if (this.stopping) throw new ConflictError('The service is shutting down.');
    if (!this.catalog.artifacts.has(id))
      this.refuse(
        id,
        'unavailable',
        'This build does not offer this add-on for this Mac.',
        'install',
      );
    this.autoUpdater.startInstall(id, false);
    return this.view(id);
  }

  async cancel(id: string): Promise<AddonView> {
    this.view(id);
    this.autoUpdater.clearRetry(id);
    const job = this.jobs.get(id);
    if (job && job.phase !== 'removing') {
      job.controller.abort();
      await job.done;
    }
    return this.view(id);
  }

  async remove(id: string): Promise<AddonView> {
    this.view(id);
    this.autoUpdater.clearRetry(id);
    if (this.stopping) throw new ConflictError('The service is shutting down.');
    for (;;) {
      const running = this.jobs.get(id);
      if (!running) break;
      if (!running.background || running.phase === 'removing')
        throw new ConflictError('The add-on is being installed; cancel it first.');
      this.assertUnused(id);
      running.controller.abort();
      await running.done;
      this.autoUpdater.clearRetry(id);
      if (this.stopping) throw new ConflictError('The service is shutting down.');
    }
    this.clearError(id);
    if (!this.active.has(id)) return this.view(id);
    this.assertUnused(id);
    let finish!: () => void;
    const job: AutoUpdateJob = {
      phase: 'removing',
      background: false,
      received: 0,
      controller: new AbortController(),
      done: new Promise((resolve) => (finish = resolve)),
    };
    this.jobs.set(id, job);
    this.changed();
    try {
      await this.commit((active) => delete active[id]);
      this.active.delete(id);
      this.changed();
      await collectGarbage(this.dataDir, id, undefined);
    } catch (error) {
      const message = `The add-on was not removed completely: ${errorMessage(error)}`;
      this.errors.set(id, { ...new AddonFailure('disk', message).view(), source: 'remove' });
      this.log.warn('An add-on was not removed completely.', { id, error: errorMessage(error) });
    } finally {
      this.jobs.delete(id);
      finish();
      this.changed();
    }
    return this.view(id);
  }

  start(): void {
    this.autoUpdater.start();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.autoUpdater.stop();
    for (const job of this.jobs.values()) if (job.phase !== 'removing') job.controller.abort();
    await Promise.all([...this.jobs.values()].map((job) => job.done));
    await this.writes;
  }

  private async activate(id: string, record: AddonRecord): Promise<void> {
    const installed = await resolveInstalled(this.dataDir, id, record);
    if (!installed)
      throw new AddonFailure('internal', 'The unpacked add-on could not be read back.');
    await this.commit((active) => (active[id] = record));
    this.active.set(id, installed);
    this.changed();
    this.log.info('An add-on was installed.', { id, version: record.version });
    await collectGarbage(this.dataDir, id, record.sha256).catch((error: unknown) =>
      this.log.warn('An older add-on version was not deleted.', { id, error: errorMessage(error) }),
    );
  }

  private commit(change: (active: AddonState['active']) => void): Promise<void> {
    const write = this.writes.then(async () => {
      const next: AddonState = { schemaVersion: 1, active: { ...this.state.active } };
      change(next.active);
      await saveAddonState(this.dataDir, next);
      this.state = next;
    });
    this.writes = write.catch(() => undefined);
    return write;
  }

  private assertUnused(id: string): void {
    for (const check of this.checks.get(id) ?? []) {
      const reason = check();
      if (reason) this.refuse(id, 'inUse', reason, 'remove');
    }
  }

  private refuse(
    id: string,
    code: AddonErrorCode,
    message: string,
    source: 'install' | 'remove',
  ): never {
    this.errors.set(id, { ...new AddonFailure(code, message).view(), source });
    this.changed();
    throw new ConflictError(message);
  }

  private clearError(id: string): void {
    if (this.errors.delete(id)) this.changed();
  }

  private changed(): void {
    for (const listener of this.listeners)
      try {
        listener();
      } catch (error) {
        this.log.warn('An add-on change listener failed.', { error: errorMessage(error) });
      }
  }
}
