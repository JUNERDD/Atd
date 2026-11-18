import { WorkerPoolContext } from '@pierre/diffs/react';
import type { WorkerPoolManager } from '@pierre/diffs/worker';
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { awaitCodeHighlightPoolStart, getCodeHighlightPool } from './code-highlight-pool-singleton';

/** The pool finished starting its workers and none failed. */
function isReady(pool: WorkerPoolManager | undefined): boolean {
  return pool?.isInitialized() === true && pool.isWorkingPool();
}

/**
 * Moves the panel's code highlighting (`CodeBlock`, `DiffView`) onto a singleton pool of workers,
 * so opening a large tool body no longer stalls the page while Shiki tokenizes it: the body paints
 * its text plain, then highlighted once a worker answers, and code with a `cacheKey` paints
 * highlighted from the pool's cache when it mounts again. Using the singleton directly keeps the
 * pool and its cache alive across transcript unmounts without pulling `@pierre/diffs` into the
 * initial welcome bundle.
 */
export function CodeHighlightPool({ children }: { children: ReactNode }) {
  const [pool] = useState(getCodeHighlightPool);
  useEffect(() => {
    if (pool && !pool.isInitialized() && pool.isWorkingPool()) awaitCodeHighlightPoolStart(pool);
  }, [pool]);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!pool) return () => {};
      return pool.subscribeToStatChanges((stats) => {
        if (stats.managerState === 'initializing') awaitCodeHighlightPoolStart(pool);
        onChange();
      });
    },
    [pool],
  );
  const ready = useSyncExternalStore(subscribe, () => isReady(pool));
  if (!pool) return children;
  return <WorkerPoolContext value={ready ? pool : undefined}>{children}</WorkerPoolContext>;
}
