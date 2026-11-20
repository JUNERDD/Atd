import type { WorkerInitializationRenderOptions, WorkerPoolOptions } from '@pierre/diffs/react';
import { getOrCreateWorkerPoolSingleton, type WorkerPoolManager } from '@pierre/diffs/worker';
import { CODE_THEMES } from './code-theme';

/**
 * Two workers, and a cache of 16 highlighted files and 16 diffs (pierre keeps one per kind),
 * enough for the rows a reader reopens. Vite emits the package's worker as a same-origin ES module
 * (`worker.format` in `vite.config.ts`), since the page's CSP (`script-src 'self'`) refuses blob
 * and data workers; in development it serves it as `?worker_file&type=module`, which the Debug
 * shell's proxy forwards (`DevProxyRule`).
 */
const POOL_OPTIONS: WorkerPoolOptions = {
  workerFactory: () =>
    new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), { type: 'module' }),
  poolSize: 2,
  totalASTLRUCacheSize: 16,
};

/**
 * The panel's code theme (`CODE_THEMES`), which every body also names for the main thread, and
 * pierre's other defaults (`word-alt` line diffs), so a body looks the same on either path; a body
 * given the pool takes the pool's theme. No `langs`: a grammar loads when a file first needs it,
 * never all of them up front.
 */
const HIGHLIGHTER_OPTIONS: WorkerInitializationRenderOptions = { theme: CODE_THEMES };

/**
 * jsdom (the tests) has no `Worker`, and a pool started there fails with an unhandled rejection;
 * without workers the panel highlights on the main thread as before.
 */
const WORKERS_AVAILABLE = typeof Worker === 'function' && typeof window !== 'undefined';

/** Pools whose start `awaitCodeHighlightPoolStart` already awaits. */
const awaitedPools = new WeakSet<WorkerPoolManager>();

export function getCodeHighlightPool(): WorkerPoolManager | undefined {
  if (!WORKERS_AVAILABLE) return undefined;
  return getOrCreateWorkerPoolSingleton({
    poolOptions: POOL_OPTIONS,
    highlighterOptions: HIGHLIGHTER_OPTIONS,
  });
}

/**
 * Awaits a starting pool once, so a failed start is reported rather than left unhandled: pierre
 * awaits a start only for a body that holds the pool, and `CodeHighlightPool` hands it to none
 * before the start succeeds. Called while the pool starts, `initialize` returns that start; on a
 * pool that is not starting it would begin a new one, so it is called only for a pool reported as
 * starting.
 */
export function awaitCodeHighlightPoolStart(pool: WorkerPoolManager): void {
  if (awaitedPools.has(pool)) return;
  awaitedPools.add(pool);
  void pool.initialize().catch((error: unknown) => {
    console.error('The code highlight workers could not start:', error);
  });
}

/** Pre-warms the singleton code-highlight worker pool after the panel's first frame settles. */
export function warmCodeHighlightPool(): void {
  const pool = getCodeHighlightPool();
  if (pool && !pool.isInitialized() && pool.isWorkingPool()) awaitCodeHighlightPoolStart(pool);
}
