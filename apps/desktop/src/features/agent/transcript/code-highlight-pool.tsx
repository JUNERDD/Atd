import {
  useWorkerPool,
  WorkerPoolContext,
  WorkerPoolContextProvider,
  type WorkerInitializationRenderOptions,
  type WorkerPoolOptions,
} from '@pierre/diffs/react';
import type { WorkerPoolManager } from '@pierre/diffs/worker';
import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from 'react';
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
const WORKERS_AVAILABLE = typeof Worker === 'function';

/** Pools whose start `awaitStart` already awaits. */
const awaitedPools = new WeakSet<WorkerPoolManager>();

/**
 * Awaits a starting pool once, so a failed start is reported rather than left unhandled: pierre
 * awaits a start only for a body that holds the pool, and `ReadyPool` hands it to none before the
 * start succeeds. Called while the pool starts, `initialize` returns that start; on a pool that is
 * not starting it would begin a new one, so it is called only for a pool reported as starting.
 */
function awaitStart(pool: WorkerPoolManager): void {
  if (awaitedPools.has(pool)) return;
  awaitedPools.add(pool);
  void pool.initialize().catch((error: unknown) => {
    console.error('The code highlight workers could not start:', error);
  });
}

/** The pool finished starting its workers and none failed. */
function isReady(pool: WorkerPoolManager | undefined): boolean {
  return pool?.isInitialized() === true && pool.isWorkingPool();
}

/**
 * Hands pierre's pool on once it is ready. A body given a pool that is still starting renders no
 * text until the pool's own highlighter has loaded, for as long as pierre's 10 s start timeout when
 * a worker never answers; a body given no pool highlights on the main thread. The pool reports its
 * state on subscription and after every change, which is also where a start is awaited.
 */
function ReadyPool({ children }: { children: ReactNode }) {
  const pool = useWorkerPool();
  // Pre-warm worker pool immediately on mount so bodies/diffs don't fall back to main-thread highlighting.
  useEffect(() => {
    if (pool && !pool.isInitialized() && pool.isWorkingPool()) awaitStart(pool);
  }, [pool]);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!pool) return () => {};
      return pool.subscribeToStatChanges((stats) => {
        if (stats.managerState === 'initializing') awaitStart(pool);
        onChange();
      });
    },
    [pool],
  );
  const ready = useSyncExternalStore(subscribe, () => isReady(pool));
  return <WorkerPoolContext value={ready ? pool : undefined}>{children}</WorkerPoolContext>;
}

/**
 * Moves the panel's code highlighting (`CodeBlock`, `DiffView`) onto a pool of workers, so opening
 * a large tool body no longer stalls the page while Shiki tokenizes it: the body paints its text
 * plain, then highlighted once a worker answers, and code with a `cacheKey` paints highlighted from
 * the pool's cache when it mounts again. It wraps the whole panel so the pool and its cache outlive
 * the transcript; pierre's provider owns the pool, a singleton it ends with its last provider.
 *
 * `File` and `FileDiff` take the pool once, when they mount, and get it only once it is ready
 * (`ReadyPool`): a body that mounts while the workers start, or after they failed to, highlights
 * on the main thread for its lifetime. Code that must paint highlighted at once opts out with
 * `disableWorkerPool`.
 */
export function CodeHighlightPool({ children }: { children: ReactNode }) {
  if (!WORKERS_AVAILABLE) return children;
  return (
    <WorkerPoolContextProvider poolOptions={POOL_OPTIONS} highlighterOptions={HIGHLIGHTER_OPTIONS}>
      <ReadyPool>{children}</ReadyPool>
    </WorkerPoolContextProvider>
  );
}
