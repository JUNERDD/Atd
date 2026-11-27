import { watch, type FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorMessage } from '@atd/agent-contracts';
import type { Logger } from '../logging.js';

/** The lock a build ships beside the service package (`addons.lock.json`, `AddonLock`). */
const LOCK_FILE = 'addons.lock.json';

/** The service package root: `src/addons` in the repo and `dist/addons` in a pack are two below it. */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The lock `pnpm --filter @atd/macos addons:pack` writes in a repo checkout. */
export const DEV_LOCK_FILE = path.join(PACKAGE_ROOT, '..', '..', 'tmp', 'addons', LOCK_FILE);

/** Debounce window for development lock file changes so atomic rewrites settle before reload. */
const DEV_LOCK_DEBOUNCE_MS = 200;

/**
 * The lock file path a `--development` service watches for live reloads: `AI_ADDONS_LOCK` when
 * set to an absolute path, else `<repo>/tmp/addons/addons.lock.json`.
 */
export function devLockWatchPath(): string | null {
  const override = process.env.AI_ADDONS_LOCK?.trim();
  if (override) return path.isAbsolute(override) ? override : null;
  return DEV_LOCK_FILE;
}

/**
 * Watches a development `addons.lock.json` path for live reloads during `pnpm dev`. When parent
 * directories (`tmp/` or `tmp/addons/`) do not yet exist at boot, watches the deepest existing
 * ancestor and re-arms downward as they are created or replaced. All watchers and timers are
 * non-persistent/unref'd and closed cleanly on `stop()`.
 */
export class DevLockWatcher {
  private watcher: FSWatcher | null = null;
  private watchedDir: string | null = null;
  private watchedKey: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private closed = false;
  private arming: Promise<void> | null = null;
  private rearmQueued = false;

  constructor(
    private readonly lockFile: string,
    private readonly log: Logger,
    private readonly onChange: () => void,
  ) {}

  start(): void {
    if (!this.closed && !this.watcher)
      void this.arm().then(() => {
        if (!this.closed) this.onChange();
      });
  }

  stop(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.closeWatcher();
  }

  private closeWatcher(): void {
    if (!this.watcher) return;
    try {
      this.watcher.close();
    } catch {
      // Ignore close errors during teardown or directory replacement.
    }
    this.watcher = null;
    this.watchedDir = null;
    this.watchedKey = null;
  }

  private scheduleChange(): void {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.closed) return;
      void this.arm().then(() => {
        if (!this.closed) this.onChange();
      });
    }, DEV_LOCK_DEBOUNCE_MS);
    this.timer.unref();
  }

  private expectedChild(dir: string): string {
    const targetDir = path.dirname(this.lockFile);
    if (dir === targetDir) return path.basename(this.lockFile);
    return path.relative(dir, targetDir).split(path.sep)[0] || path.basename(this.lockFile);
  }

  private arm(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.arming) {
      this.rearmQueued = true;
      return this.arming;
    }
    let done = false;
    const run = (async () => {
      try {
        do {
          this.rearmQueued = false;
          await this.armOnce();
        } while (this.rearmQueued && !this.closed);
      } finally {
        done = true;
        this.arming = null;
      }
    })();
    if (!done) this.arming = run;
    return run;
  }

  private async armOnce(): Promise<void> {
    try {
      const targetDir = path.dirname(this.lockFile);
      const target = await deepestExistingDir(targetDir);
      if (this.closed || !target) return;
      if (this.watcher && this.watchedDir === target.dir && this.watchedKey === target.key) return;
      this.closeWatcher();
      const expected = this.expectedChild(target.dir);
      const selfName = path.basename(target.dir);
      const next = watch(target.dir, { persistent: false }, (_event, filename) => {
        if (this.closed) return;
        const name = typeof filename === 'string' ? filename : null;
        if (name && name !== expected && name !== selfName) return;
        this.scheduleChange();
      });
      next.on('error', () => {
        if (this.closed) return;
        this.closeWatcher();
        this.scheduleChange();
      });
      next.unref();
      this.watcher = next;
      this.watchedDir = target.dir;
      this.watchedKey = target.key;
      if (target.dir !== targetDir) {
        const after = await deepestExistingDir(targetDir);
        if (after && (after.dir !== target.dir || after.key !== target.key))
          this.rearmQueued = true;
      }
    } catch (error) {
      if (!this.closed)
        this.log.warn('The development add-on lock watcher could not attach.', {
          lock: this.lockFile,
          error: errorMessage(error),
        });
    }
  }
}

async function deepestExistingDir(dir: string): Promise<{ dir: string; key: string } | null> {
  let current = path.resolve(dir);
  for (;;) {
    const info = await stat(current).catch(() => null);
    if (info?.isDirectory()) return { dir: current, key: `${info.dev}:${info.ino}` };
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
