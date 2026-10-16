import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { anchorAt, holdInView, type Anchor } from './scroll-anchor';

/** Turns the transcript mounts at first, and how many more each load reveals. */
const TURN_BATCH = 20;
/** How far above the viewport the earliest shown turn may be when the next batch loads. */
const PRELOAD_PX = 600;

/**
 * The window of turns the transcript renders: the latest `TURN_BATCH`, extended by a batch each
 * time the reader scrolls within `PRELOAD_PX` of the earliest one, and started over for another
 * `resetKey` (another task's turns). The returned `sentinel` ref goes on the element just above the
 * first shown turn, `loadEarlier` loads a batch on request, and `include` extends the window to a
 * given turn at once.
 *
 * Turns revealed above the view would push it down, so a load holds the view on the turn that led
 * the list (`holdInView`): the commit puts that turn back where the reader left it, and the hold
 * keeps it there while the new turns settle until the reader takes over. A hold that already keeps
 * that turn or a later one in place (a message the rail revealed) carries on in its stead.
 */
export function useEarlierTurns(
  total: number,
  viewportRef: RefObject<HTMLDivElement | null>,
  resetKey: string,
) {
  const [loaded, setLoaded] = useState({ key: resetKey, count: TURN_BATCH });
  if (loaded.key !== resetKey) setLoaded({ key: resetKey, count: TURN_BATCH });
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  const anchor = useRef<Anchor | null>(null);
  const firstVisible = Math.max(0, total - loaded.count);

  const loadEarlier = useCallback(() => {
    const viewport = viewportRef.current;
    const leading = sentinel?.nextElementSibling;
    anchor.current = viewport && leading ? anchorAt(viewport, leading) : null;
    setLoaded((current) => ({ ...current, count: current.count + TURN_BATCH }));
  }, [sentinel, viewportRef]);

  /**
   * Mounts every turn from `index` on, with a batch above it so the next load stays out of reach
   * while the view travels there. Nothing is held: the caller places the view on the turn itself.
   */
  const include = useCallback(
    (index: number) => {
      anchor.current = null;
      setLoaded((current) => ({
        ...current,
        count: Math.max(current.count, total - index + TURN_BATCH),
      }));
    },
    [total],
  );

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const held = anchor.current;
    if (!viewport || !held?.element.isConnected) return;
    // A load requested meanwhile has already set its own anchor, which this one must not clear.
    return holdInView(viewport, held, () => {
      if (anchor.current === held) anchor.current = null;
    });
  }, [firstVisible, viewportRef]);

  // Observing again after every load reports the sentinel's state afresh: one still in range after
  // a short batch loads the next instead of waiting for the reader to leave the range and return.
  useEffect(() => {
    const root = viewportRef.current;
    if (!sentinel || !root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadEarlier();
      },
      { root, rootMargin: `${PRELOAD_PX}px 0px 0px 0px` },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, viewportRef, firstVisible, loadEarlier]);

  return { firstVisible, sentinel: setSentinel, loadEarlier, include };
}
