import {
  errorMessage,
  type AddonArtifact,
  type AddonErrorCode,
  type AddonPhase,
} from '@atd/agent-contracts';
import type { Logger } from '../logging.js';
import { toAddonFailure } from './failure.js';
import { runInstall } from './install.js';
import {
  artifactChanged,
  DevLockWatcher,
  devLockWatchPath,
  loadAddonCatalog,
  sameAddonCatalog,
  type AddonCatalog,
} from './lock.js';
import type { AddonRecord } from './store.js';

/** Bounded exponential backoff delays for background retries of outdated add-ons. */
const RETRY_DELAYS_MS = [15_000, 60_000, 300_000] as const;

interface RetryEntry {
  attempts: number;
  timer: NodeJS.Timeout | null;
}

/**
 * Bounded exponential-backoff retry scheduler for background updates of already-installed
 * (`outdated`) add-ons that failed with a transient network error. Timers are `.unref()`ed so
 * they never keep the service process alive on shutdown.
 */
export class OutdatedRetryScheduler {
  private readonly entries = new Map<string, RetryEntry>();

  schedule(id: string, onRetry: () => void): number | null {
    const entry = this.entries.get(id) ?? { attempts: 0, timer: null };
    if (entry.attempts >= RETRY_DELAYS_MS.length) return null;
    if (entry.timer) clearTimeout(entry.timer);
    const delayMs = RETRY_DELAYS_MS[entry.attempts]!;
    entry.attempts += 1;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      onRetry();
    }, delayMs);
    entry.timer.unref();
    this.entries.set(id, entry);
    return delayMs;
  }

  clear(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.entries.delete(id);
  }

  clearAll(): void {
    for (const entry of this.entries.values()) if (entry.timer) clearTimeout(entry.timer);
    this.entries.clear();
  }
}

export interface AutoUpdateJob {
  phase: AddonPhase;
  background: boolean;
  readonly sha256?: string;
  received: number;
  readonly controller: AbortController;
  done: Promise<void>;
}

/** Narrow registry surface owned by `AddonAutoUpdater` (retry, reload, on-demand update). */
export interface AutoUpdateHost {
  dataDir: string;
  development: boolean;
  log: Logger;
  isStopping(): boolean;
  catalog(): AddonCatalog;
  setCatalog(next: AddonCatalog): void;
  activeIds(): Iterable<string>;
  hasActive(id: string): boolean;
  isCurrent(id: string): boolean;
  job(id: string): AutoUpdateJob | undefined;
  setJob(id: string, job: AutoUpdateJob): void;
  deleteJob(id: string): void;
  jobs(): Iterable<[string, AutoUpdateJob]>;
  clearError(id: string): void;
  recordInstallError(id: string, error: { code: AddonErrorCode; message: string }): void;
  activate(id: string, record: AddonRecord): Promise<void>;
  notifyChanged(): void;
}

/**
 * Coordinates background auto-updates, bounded network retries, on-demand awaiting, and live
 * `--development` lock reloads for `AddonRegistry`. Never installs an add-on that is not already
 * active in `state.json`.
 */
export class AddonAutoUpdater {
  private readonly retries = new OutdatedRetryScheduler();
  private readonly devWatcher: DevLockWatcher | null;
  private reloading: Promise<void> | null = null;
  private reloadPending = false;

  constructor(private readonly host: AutoUpdateHost) {
    const watchFile = host.development ? devLockWatchPath() : null;
    this.devWatcher = watchFile
      ? new DevLockWatcher(watchFile, host.log, () => this.requestReload())
      : null;
  }

  /** Starts the dev lock watcher (when applicable) and kicks off updates for outdated add-ons. */
  start(): void {
    if (this.host.isStopping()) return;
    this.devWatcher?.start();
    const { artifacts } = this.host.catalog();
    for (const id of this.host.activeIds())
      if (!this.host.isCurrent(id) && artifacts.has(id) && !this.host.job(id)) {
        this.host.log.info('Updating an outdated add-on.', { id });
        this.startInstall(id, true);
      }
  }

  /** Starts an install job (manual or background) for `id`'s currently pinned archive. */
  startInstall(id: string, background: boolean): void {
    const artifact: AddonArtifact | undefined = this.host.catalog().artifacts.get(id);
    if (!artifact) return;
    this.host.clearError(id);
    const controller = new AbortController();
    const job: AutoUpdateJob = {
      phase: 'downloading',
      background,
      sha256: artifact.sha256,
      received: 0,
      controller,
      done: Promise.resolve(),
    };
    this.host.setJob(id, job);
    job.done = runInstall({
      dataDir: this.host.dataDir,
      artifact,
      development: this.host.development,
      signal: controller.signal,
      phase: (phase) => {
        if (job.phase === phase) return;
        job.phase = phase;
        this.host.notifyChanged();
      },
      progress: (received) => (job.received = received),
      activate: (record) => this.host.activate(id, record),
    })
      .then(() => this.retries.clear(id))
      .catch((error: unknown) => {
        const failure = toAddonFailure(error, controller.signal);
        this.host.recordInstallError(id, failure.view());
        if (failure.code !== 'cancelled')
          this.host.log.warn('An add-on was not installed.', {
            id,
            code: failure.code,
            error: failure.message,
          });
        this.onInstallFailed(id, artifact.sha256, job.background, failure.code);
      })
      .finally(() => {
        this.host.deleteJob(id);
        this.host.notifyChanged();
      });
    this.host.notifyChanged();
  }

  stop(): void {
    this.devWatcher?.stop();
    this.retries.clearAll();
  }

  clearRetry(id: string): void {
    this.retries.clear(id);
  }

  /** Ensures an already-installed (`outdated`) add-on finishes updating without cancelling on abort. */
  async ensureCurrent(id: string, signal?: AbortSignal): Promise<void> {
    while (this.reloading) await waitWithSignal(this.reloading, signal);
    if (this.host.isCurrent(id) || this.host.isStopping()) return;
    if (!this.host.hasActive(id) || !this.host.catalog().artifacts.has(id)) return;
    signal?.throwIfAborted();
    let job = this.host.job(id);
    if (job?.phase === 'removing') return;
    if (!job) {
      this.retries.clear(id);
      this.host.log.info('Updating an outdated add-on on demand.', { id });
      this.startInstall(id, true);
      job = this.host.job(id);
    }
    while (job && job.phase !== 'removing' && !this.host.isCurrent(id)) {
      await waitWithSignal(job.done, signal);
      while (this.reloading) await waitWithSignal(this.reloading, signal);
      const next = this.host.job(id);
      if (!next || next === job) break;
      job = next;
    }
  }

  /** Schedules bounded exponential backoff when a background update fails with a network error. */
  private onInstallFailed(
    id: string,
    sha256: string,
    background: boolean,
    code: AddonErrorCode,
  ): void {
    if (
      !background ||
      code !== 'network' ||
      this.host.isStopping() ||
      !this.host.hasActive(id) ||
      this.host.isCurrent(id) ||
      this.host.catalog().artifacts.get(id)?.sha256 !== sha256
    ) {
      if (code !== 'network') this.retries.clear(id);
      return;
    }
    const delayMs = this.retries.schedule(id, () => {
      if (
        this.host.isStopping() ||
        !this.host.hasActive(id) ||
        this.host.isCurrent(id) ||
        !this.host.catalog().artifacts.has(id) ||
        this.host.job(id)
      )
        return;
      this.host.log.info('Retrying outdated add-on update.', { id });
      this.startInstall(id, true);
    });
    if (delayMs !== null)
      this.host.log.info('Scheduled retry for outdated add-on.', { id, delayMs });
  }

  private requestReload(): void {
    if (this.host.isStopping()) return;
    this.reloadPending = true;
    if (this.reloading) return;
    let done = false;
    const loop = (async () => {
      try {
        while (this.reloadPending && !this.host.isStopping()) {
          this.reloadPending = false;
          await this.reloadCatalog();
        }
      } catch (error) {
        this.host.log.warn('Reloading the development add-on lock failed.', {
          error: errorMessage(error),
        });
      } finally {
        done = true;
        this.reloading = null;
      }
    })();
    if (!done) this.reloading = loop;
  }

  private async reloadCatalog(): Promise<void> {
    if (this.host.isStopping()) return;
    const prev = this.host.catalog();
    const next = await loadAddonCatalog({
      development: this.host.development,
      log: this.host.log,
    });
    if (this.host.isStopping() || sameAddonCatalog(prev, next)) return;
    this.host.setCatalog(next);
    this.retries.clearAll();
    const stale: Promise<void>[] = [];
    for (const [id, job] of this.host.jobs()) {
      if (job.phase === 'removing') continue;
      if (job.sha256 !== next.artifacts.get(id)?.sha256) {
        job.controller.abort();
        stale.push(job.done);
      }
    }
    if (stale.length) await Promise.all(stale);
    if (this.host.isStopping()) return;
    for (const id of new Set([...prev.artifacts.keys(), ...next.artifacts.keys()]))
      if (artifactChanged(prev.artifacts.get(id), next.artifacts.get(id))) this.host.clearError(id);
    this.host.log.info('Reloaded development add-on lock.', {
      lock: next.source,
      artifacts: next.artifacts.size,
    });
    this.host.notifyChanged();
    this.start();
  }
}

/** Awaits `promise`, rejecting early if `signal` aborts without cancelling `promise`. */
export async function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason ?? new Error('Aborted'));
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}
