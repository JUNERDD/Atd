import { readdir } from 'node:fs/promises';
import {
  COMPUTER_ADDONS,
  errorMessage,
  type AddonErrorCode,
  type AddonPhase,
  type AddonView,
} from '@atd/agent-contracts';
import { ConflictError } from '../errors.js';
import { LedgerNotFound } from '../ledger.js';
import type { Logger } from '../logging.js';
import { AddonFailure, toAddonFailure } from './failure.js';
import { runInstall } from './install.js';
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

/**
 * Why a consumer cannot let an add-on go right now (a sentence for the person removing it), or
 * null when it may be removed.
 */
export type AddonUseCheck = () => string | null;

/** What runs for one add-on: an install (cancellable) or a removal. */
interface Job {
  phase: AddonPhase;
  received: number;
  controller: AbortController;
  done: Promise<void>;
}

/**
 * The service's add-ons (design §6–8): the archives this build pins (lock.ts), the active
 * installs (`state.json`, store.ts) and what is running for each id, one job per id at a time.
 * It answers the views routes and the shell read, the install facts service features gate on
 * (`installed`), and refuses a removal while a registered consumer still uses the add-on.
 * Listeners hear every change a view shows except download progress, which views poll.
 */
export class AddonRegistry {
  private readonly jobs = new Map<string, Job>();
  private readonly errors = new Map<string, { code: AddonErrorCode; message: string }>();
  private readonly checks = new Map<string, AddonUseCheck[]>();
  private readonly listeners = new Set<() => void>();
  /** State writes, serialized so each starts from the state the previous one committed. */
  private writes = Promise.resolve();
  /** Set once shutdown begins; no install or removal starts after it. */
  private stopping = false;

  private constructor(
    private readonly dataDir: string,
    private readonly catalog: AddonCatalog,
    private readonly development: boolean,
    private readonly log: Logger,
    private state: AddonState,
    private readonly active: Map<string, InstalledAddon>,
  ) {}

  /**
   * Loads the lock and the install state. Staging left by an earlier process is removed, a
   * recorded install whose directory is gone or changed is dropped, an install of a retired
   * add-on (`RETIRED_ADDONS`) is dropped and its directory deleted, and every install directory no
   * record names is deleted.
   */
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

  /** Every add-on this build knows: the lock's ids and the computer engines, none retired. */
  ids(): string[] {
    const ids = new Set([...COMPUTER_ADDONS, ...this.catalog.ids]);
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
      ...(error ? { error } : {}),
    };
  }

  /** The active install of an add-on, only when it is exactly the archive this build pins. */
  installed(id: string): InstalledAddon | undefined {
    const active = this.active.get(id);
    return active && active.sha256 === this.catalog.artifacts.get(id)?.sha256 ? active : undefined;
  }

  /** Calls `listener` after every change a view shows, progress excepted; returns the remover. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Registers a consumer's check, asked before any of `ids` is removed. */
  useBy(ids: readonly string[], check: AddonUseCheck): void {
    for (const id of ids) this.checks.set(id, [...(this.checks.get(id) ?? []), check]);
  }

  /**
   * Starts installing the pinned archive, or joins the job running, and answers at once. An add-on
   * this build ships no archive for answers 409, and its view keeps that refusal as `error`.
   */
  install(id: string): AddonView {
    this.view(id);
    if (this.jobs.has(id) || this.installed(id)) return this.view(id);
    if (this.stopping) throw new ConflictError('The service is shutting down.');
    if (!this.catalog.artifacts.has(id))
      this.refuse(id, 'unavailable', 'This build does not offer this add-on for this Mac.');
    this.startInstall(id);
    return this.view(id);
  }

  /** Cancels a running install and answers once it has stopped; the active install stays. */
  async cancel(id: string): Promise<AddonView> {
    this.view(id);
    const job = this.jobs.get(id);
    if (job && job.phase !== 'removing') {
      job.controller.abort();
      await job.done;
    }
    return this.view(id);
  }

  /**
   * Removes the add-on: refused (409) while it installs or a consumer reports it in use, the
   * refusal kept as the view's `error` when it is `inUse`. The state record goes first and is
   * announced, so consumers stop using the files before their directory is deleted.
   */
  async remove(id: string): Promise<AddonView> {
    this.view(id);
    if (this.jobs.has(id))
      throw new ConflictError('The add-on is being installed; cancel it first.');
    if (this.stopping) throw new ConflictError('The service is shutting down.');
    this.clearError(id);
    if (!this.active.has(id)) return this.view(id);
    for (const check of this.checks.get(id) ?? []) {
      const reason = check();
      if (reason) this.refuse(id, 'inUse', reason);
    }
    let finish!: () => void;
    const job: Job = {
      phase: 'removing',
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
      this.errors.set(id, new AddonFailure('disk', message).view());
      this.log.warn('An add-on was not removed completely.', { id, error: errorMessage(error) });
    } finally {
      this.jobs.delete(id);
      finish();
      this.changed();
    }
    return this.view(id);
  }

  /** Replaces, in the background, every outdated install this build ships an archive for. */
  start(): void {
    for (const id of this.active.keys())
      if (!this.installed(id) && this.catalog.artifacts.has(id) && !this.jobs.has(id)) {
        this.log.info('Updating an outdated add-on.', { id });
        this.startInstall(id);
      }
  }

  /** Cancels every running install and waits for every job to end (service shutdown). */
  async stop(): Promise<void> {
    this.stopping = true;
    for (const job of this.jobs.values()) if (job.phase !== 'removing') job.controller.abort();
    await Promise.all([...this.jobs.values()].map((job) => job.done));
    await this.writes;
  }

  private startInstall(id: string): void {
    const artifact = this.catalog.artifacts.get(id);
    if (!artifact) return;
    this.clearError(id);
    const controller = new AbortController();
    const job: Job = { phase: 'downloading', received: 0, controller, done: Promise.resolve() };
    this.jobs.set(id, job);
    job.done = runInstall({
      dataDir: this.dataDir,
      artifact,
      development: this.development,
      signal: controller.signal,
      phase: (phase) => {
        if (job.phase === phase) return;
        job.phase = phase;
        this.changed();
      },
      progress: (received) => (job.received = received),
      activate: (record) => this.activate(id, record),
    })
      .catch((error: unknown) => {
        const failure = toAddonFailure(error, controller.signal);
        this.errors.set(id, failure.view());
        if (failure.code !== 'cancelled')
          this.log.warn('An add-on was not installed.', {
            id,
            code: failure.code,
            error: failure.message,
          });
      })
      .finally(() => {
        this.jobs.delete(id);
        this.changed();
      });
    this.changed();
  }

  /** The commit point of an install: the verified directory becomes the active install. */
  private async activate(id: string, record: AddonRecord): Promise<void> {
    const installed = await resolveInstalled(this.dataDir, id, record);
    if (!installed)
      throw new AddonFailure('internal', 'The unpacked add-on could not be read back.');
    await this.commit((active) => (active[id] = record));
    this.active.set(id, installed);
    this.changed();
    this.log.info('An add-on was installed.', { id, version: record.version });
    // Older versions go once the new one is active; a process still running one keeps its files.
    await collectGarbage(this.dataDir, id, record.sha256).catch((error: unknown) =>
      this.log.warn('An older add-on version was not deleted.', { id, error: errorMessage(error) }),
    );
  }

  /** Applies one change to the persisted state, after the writes before it. */
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

  /** Records a refusal in the view, announces it and answers the route's 409. */
  private refuse(id: string, code: AddonErrorCode, message: string): never {
    this.errors.set(id, new AddonFailure(code, message).view());
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
