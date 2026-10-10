/**
 * How far a key is pressed at time `t`: it travels down quickly at `press`, holds, and springs back
 * up at `release` with a small overshoot above rest (negative travel), as a real cap does when its
 * switch returns. Pure, so any frame can be evaluated alone.
 */
import { ramp } from '../../motion/ease.ts';
import { springAt, type Spring } from '../../motion/spring.ts';

/** The cap's return: quick, with a little bounce. */
const RETURN: Spring = { response: 0.3, damping: 0.55 };
/** Seconds the cap takes to bottom out. */
const DOWN = 0.07;
/** How long a tap holds when no release is given. */
export const TAP_HOLD = 0.2;

/** Travel 0 (rest) → 1 (bottomed out); slightly negative while it overshoots on the way back. */
export function keyTravel(t: number, press: number, release = press + TAP_HOLD): number {
  const down = ramp(t, press, DOWN);
  if (t < release) return down;
  return ramp(release, press, DOWN) * (1 - springAt(t, release, RETURN));
}
