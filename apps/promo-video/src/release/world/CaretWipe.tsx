import type { ReactNode } from 'react';
import { clamp01, easeInOut } from '../../motion/ease.ts';
import { WIDTH } from '../timeline.ts';
import './release.css';
import './transitions.css';

interface CaretWipeProps {
  t: number;
  /** When the caret sets off, and how long it takes to cross the frame. */
  at: number;
  duration: number;
  /** The layer the caret wipes away (omitted: nothing, so what is beneath shows). */
  outgoing?: ReactNode;
  /** The layer it reveals behind it (omitted: nothing, so what is beneath shows). */
  incoming?: ReactNode;
  /** Which way it travels (default `right`). */
  direction?: 'right' | 'left';
}

/** How far past each edge the caret starts and ends, so it enters and leaves whole. */
const OVERSHOOT = 80;

/** The caret's position across the frame at progress `p`, in px from the frame's left. */
function edgeAt(p: number, direction: 'right' | 'left'): number {
  const x = -OVERSHOOT + easeInOut(clamp01(p)) * (WIDTH + 2 * OVERSHOOT);
  return direction === 'right' ? x : WIDTH - x;
}

/**
 * A tall coral caret sweeps across the frame, wiping the outgoing layer away and revealing the
 * incoming one behind it; it stretches with its speed and trails a soft coral bloom. Before `at`
 * only the outgoing layer shows, after the sweep only the incoming one. Fills its parent (a frame).
 *
 * Across a cut, end the sweep on the cut and pass as `incoming` the next scene's opening backdrop
 * at its own first frame (a `DotField` or an empty `Stage`), which the next scene starts from.
 */
export function CaretWipe({
  t,
  at,
  duration,
  outgoing,
  incoming,
  direction = 'right',
}: CaretWipeProps) {
  const p = (t - at) / duration;
  const edge = edgeAt(p, direction);
  const speed = Math.abs(edgeAt(p + 1 / 120 / duration, direction) - edge) * 120;
  const sweeping = p > 0 && p < 1;
  const right = direction === 'right';
  // Clips in px from each side: the outgoing layer keeps the side ahead of the caret.
  const ahead = right ? `inset(0 0 0 ${edge}px)` : `inset(0 ${WIDTH - edge}px 0 0)`;
  const behind = right ? `inset(0 ${WIDTH - edge}px 0 0)` : `inset(0 0 0 ${edge}px)`;
  return (
    <div className="r08-wipe">
      {p < 1 && outgoing !== undefined ? (
        <div className="r08-wipe__layer" style={{ '--clip': sweeping ? ahead : 'none' }}>
          {outgoing}
        </div>
      ) : null}
      {p > 0 && incoming !== undefined ? (
        <div className="r08-wipe__layer" style={{ '--clip': sweeping ? behind : 'none' }}>
          {incoming}
        </div>
      ) : null}
      {sweeping ? (
        <div
          className="r08-wipe__caret"
          data-direction={direction}
          style={{ '--edge': edge, '--stretch': 1 + Math.min(2.4, speed / 2600) }}
        />
      ) : null}
    </div>
  );
}
