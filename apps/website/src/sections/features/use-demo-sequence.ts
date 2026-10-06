import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { useInView } from '../../lib/use-in-view';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import { useRevealed } from '../../motion/use-revealed';

/** How a finished demo starts over. */
export interface DemoLoop {
  /** How long the finished demo holds before it clears, in ms. */
  hold: number;
  /** How long clearing takes before the first step plays again, in ms. */
  clear: number;
}

export interface DemoSequence {
  /** Steps played: 0 is the demo's empty start, the number of delays its finished state. */
  step: number;
  /** A finished, looping demo is clearing before it starts over. */
  clearing: boolean;
  /** The demo is on screen, so its loops may run. */
  live: boolean;
}

const unsubscribe = () => {};
const subscribe = () => unsubscribe;

/**
 * Whether the page plays entrances: the inline script marks the root before first paint when the
 * visitor allows motion. `false` on the server and while hydrating, so the prerendered markup holds.
 */
function useEntrances(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => document.documentElement.hasAttribute('data-motion'),
    () => false,
  );
}

/**
 * Plays a demo once its reveal group (`ref`) has arrived: step i + 1 follows step i after `delays[i]`
 * ms, from the empty start to the finished state; with `loop`, the finished demo holds, clears and
 * plays again. It advances only while on screen, so scrolled away it pauses where it is.
 *
 * The prerendered page shows the finished state, and so does reduced motion. With motion, the demo
 * shows its empty start from hydration on, while its tile is still hidden, and waits for its entrance.
 */
export function useDemoSequence(
  ref: RefObject<Element | null>,
  delays: readonly number[],
  loop?: DemoLoop,
): DemoSequence {
  const end = delays.length;
  const entrances = useEntrances();
  const reduced = useReducedMotion();
  const revealed = useRevealed(ref);
  const live = useInView(ref);
  const [step, setStep] = useState(0);
  const [clearing, setClearing] = useState(false);
  const playing = entrances && !reduced;

  // One timer at a time, for the next transition from wherever the demo is.
  useEffect(() => {
    if (!playing || !revealed || !live) return;
    let wait: number;
    let next: () => void;
    if (clearing) {
      wait = loop?.clear ?? 0;
      next = () => {
        setClearing(false);
        setStep(0);
      };
    } else if (step < end) {
      wait = delays[step] ?? 0;
      next = () => setStep(step + 1);
    } else if (loop) {
      wait = loop.hold;
      next = () => setClearing(true);
    } else {
      return;
    }
    const timer = window.setTimeout(next, wait);
    return () => window.clearTimeout(timer);
  }, [playing, revealed, live, step, clearing, end, delays, loop]);

  return playing ? { step, clearing, live } : { step: end, clearing: false, live };
}
