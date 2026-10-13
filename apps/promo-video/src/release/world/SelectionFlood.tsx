import type { ReactNode } from 'react';
import type { Rect } from '../../kit/world/points.ts';
import { clamp01, easeInOut, easeOut, mix, smoothstep } from '../../motion/ease.ts';
import { HEIGHT, WIDTH } from '../timeline.ts';
import './release.css';
import './transitions.css';

interface SelectionFloodProps {
  t: number;
  /** When the selection starts to grow, and how long it takes to fill the frame. */
  at: number;
  duration: number;
  /** Where it starts, in frame px: the selected word or line's box. */
  from: Rect;
  /** The layer it becomes, revealed under the coral as it clears (omitted: it stays coral). */
  incoming?: ReactNode;
  /** How long the coral takes to clear once the frame is full, in seconds (default 0.35). */
  release?: number;
}

/** How far past the frame's edges the full selection reaches, so its corners never show. */
const BLEED = 24;

/**
 * The coral selection floods the frame: from a selected word it extends along the line, then down
 * and up the lines, the way a drag selection grows to select everything, its wash over what it
 * selects thickening to solid coral. Once the frame is full it becomes the next layer: with
 * `incoming`, the coral clears to reveal it; without, it holds solid coral for the next scene to
 * start from. Fills its parent (a frame) and sits over the outgoing layer.
 */
export function SelectionFlood({
  t,
  at,
  duration,
  from,
  incoming,
  release = 0.35,
}: SelectionFloodProps) {
  if (t < at) return null;
  const across = easeInOut(clamp01((t - at) / (duration * 0.62)));
  const down = easeInOut(clamp01((t - at - duration * 0.3) / (duration * 0.7)));
  const left = mix(from.x, -BLEED, across);
  const right = mix(from.x + from.width, WIDTH + BLEED, across);
  const top = mix(from.y, -BLEED, down);
  const bottom = mix(from.y + from.height, HEIGHT + BLEED, down);
  const solid = smoothstep(0.15, 0.95, down);
  const full = t >= at + duration;
  const clear = incoming === undefined ? 0 : easeOut(clamp01((t - at - duration) / release));
  return (
    <div
      className="r08-flood"
      style={{
        '--fx': left,
        '--fy': top,
        '--fw': right - left,
        '--fh': bottom - top,
        '--solid': solid * (1 - clear),
        '--wash': (1 - solid) * (1 - clear),
        '--radius': mix(from.height * 0.08, 0, down),
      }}
    >
      {full && incoming !== undefined ? (
        <div className="r08-flood__incoming">{incoming}</div>
      ) : null}
      <div className="r08-flood__selection" />
    </div>
  );
}
