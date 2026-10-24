import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { anchorAt, holdInView, type Anchor } from '../scroll-anchor';
import { firstInView, readableBand, revealRange } from './find-geometry';
import { clearHits, collectHits, paintHits, type FindHit } from './find-hits';

/** The matches of an open find and the one it is on (-1 with none). */
export interface FindMatches {
  hits: readonly FindHit[];
  current: number;
}

/**
 * How a search places the current match. `fresh` (a new query, the bar opened or focused again)
 * starts at the first match in view and reveals it; `keep` (the transcript changed under the bar)
 * stays on the same match without moving the view.
 */
type SearchMode = 'fresh' | 'keep';

const NONE: FindMatches = { hits: [], current: -1 };

/** The previous current match's place among `hits`, by its text position, else by its index. */
function keptIndex(before: FindMatches, hits: readonly FindHit[]): number {
  const previous = before.hits[before.current];
  if (!previous || hits.length === 0) return -1;
  const { startContainer, startOffset } = previous.range;
  const same = hits.findIndex(
    (hit) => hit.range.startContainer === startContainer && hit.range.startOffset === startOffset,
  );
  return same >= 0 ? same : Math.min(before.current, hits.length - 1);
}

/**
 * One open find over the transcript: the matches of `query` under `root`, painted as highlights,
 * and the current one, revealed below `bar`. While it is open the search runs again, at most once a
 * frame, whenever the transcript's content changes. The first query of a session mounts every turn
 * (`include(0)`) when the transcript shows only its latest, holding the reader's place while the
 * earlier turns mount above it, and searches once they have. Unmounting clears the highlights.
 */
export function useFindSession({
  query,
  root,
  viewportRef,
  barRef,
  turnCount,
  include,
}: {
  query: string;
  root: HTMLElement | null;
  viewportRef: RefObject<HTMLDivElement | null>;
  barRef: RefObject<HTMLElement | null>;
  turnCount: number;
  include: (index: number) => void;
}) {
  const [matches, setMatches] = useState(NONE);
  // The handlers below run from observers and frames, so they read the latest values from refs.
  const latest = useRef({ matches: NONE, query, turnCount, include });
  useLayoutEffect(() => {
    latest.current.query = query;
    latest.current.turnCount = turnCount;
    latest.current.include = include;
  });
  const included = useRef(false);
  /** The reader's place, held from the commit that mounts the earlier turns. */
  const placeToHold = useRef<Anchor | null>(null);
  const stopHold = useRef<() => void>(() => {});
  const stopReveal = useRef<() => void>(() => {});
  const frame = useRef(0);
  const pending = useRef<SearchMode | null>(null);

  const show = useCallback(
    (next: FindMatches, reveal: boolean) => {
      latest.current.matches = next;
      setMatches(next);
      paintHits(next.hits, next.current);
      const viewport = viewportRef.current;
      const hit = next.hits[next.current];
      if (!reveal || !viewport || !hit) return;
      stopReveal.current();
      stopReveal.current = revealRange(viewport, hit.range, barRef.current);
    },
    [barRef, viewportRef],
  );

  const search = useCallback(
    (mode: SearchMode) => {
      const viewport = viewportRef.current;
      if (!root || !viewport) return;
      const { query: needle, matches: before } = latest.current;
      const hits = needle ? collectHits(root, needle) : [];
      const kept = mode === 'keep' ? keptIndex(before, hits) : -1;
      const current =
        kept >= 0 ? kept : firstInView(viewport, hits, readableBand(viewport, barRef.current));
      show({ hits, current }, mode === 'fresh');
    },
    [root, viewportRef, barRef, show],
  );

  /** Searches on the next frame; a fresh search asked meanwhile wins over keeping the match. */
  const schedule = useCallback(
    (mode: SearchMode) => {
      if (pending.current !== 'fresh') pending.current = mode;
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const next = pending.current;
        pending.current = null;
        if (next) search(next);
      });
    },
    [search],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    const { turnCount: total, include: mountFrom } = latest.current;
    const mounted = root?.querySelectorAll('[data-turn-id]') ?? [];
    if (query && !included.current && root && viewport && mounted.length < total) {
      included.current = true;
      const leading = mounted[0];
      placeToHold.current = leading ? anchorAt(viewport, leading) : null;
      mountFrom(0);
      // The commit that mounts the turns lands before the next frame.
      schedule('fresh');
      return;
    }
    search('fresh');
  }, [query, root, viewportRef, search, schedule]);

  useEffect(() => {
    if (!root) return;
    const observer = new MutationObserver(() => {
      const viewport = viewportRef.current;
      const place = placeToHold.current;
      if (place && viewport) {
        // A microtask after the commit, before it paints: the view never shows the jump.
        placeToHold.current = null;
        stopHold.current = holdInView(viewport, place);
      }
      if (latest.current.query) schedule('keep');
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [root, viewportRef, schedule]);

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      pending.current = null;
      stopReveal.current();
      stopHold.current();
      clearHits();
    },
    [],
  );

  const step = useCallback(
    (direction: -1 | 1) => {
      const { hits, current } = latest.current.matches;
      if (hits.length === 0) return;
      show({ hits, current: (current + direction + hits.length) % hits.length }, true);
    },
    [show],
  );
  const pick = useCallback(
    (index: number) => show({ hits: latest.current.matches.hits, current: index }, true),
    [show],
  );
  const rerun = useCallback(() => search('fresh'), [search]);

  return { ...matches, step, pick, rerun };
}
