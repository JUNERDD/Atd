import { useCallback, useEffect, useState } from 'react';

/** How far below the scroll viewport the end of the rendered items may be when a batch mounts. */
const PRELOAD_PX = 400;
/** The element a `ScrollArea` scrolls in, which is the observer's root. */
const SCROLL_VIEWPORT = '[data-slot=scroll-area-viewport]';

/**
 * The window of a long list that a page renders: the first `batch` items, extended by a batch each
 * time the end of what is rendered comes within `PRELOAD_PX` of the scroll viewport. Put the
 * returned `sentinel` ref on an element right after the rendered items, and only while `count`
 * is below `total`. The window starts over when `resetKey` changes (a new query).
 *
 * The scroll viewport is the sentinel's closest `ScrollArea` viewport, because the lists that use
 * this sit in a `ScrollArea` they do not own (a command list, a settings page); with none, the
 * window of the page is the root. Observing again after every growth reports the sentinel's state
 * afresh, so one still in range after a short batch loads the next instead of waiting for the
 * reader to scroll away and back. Without `IntersectionObserver` the first batch is all there is.
 */
export function useRevealMore(total: number, batch: number, resetKey: string) {
  const [revealed, setRevealed] = useState({ resetKey, count: batch });
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  const count = revealed.resetKey === resetKey ? revealed.count : batch;

  const revealMore = useCallback(
    () =>
      setRevealed((current) => ({
        resetKey,
        count: (current.resetKey === resetKey ? current.count : batch) + batch,
      })),
    [resetKey, batch],
  );

  useEffect(() => {
    if (!sentinel || count >= total || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) revealMore();
      },
      { root: sentinel.closest(SCROLL_VIEWPORT), rootMargin: `0px 0px ${PRELOAD_PX}px 0px` },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, count, total, revealMore]);

  return { count: Math.min(count, total), sentinel: setSentinel };
}
