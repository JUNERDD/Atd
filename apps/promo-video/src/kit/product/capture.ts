import { springAt, springs, type Spring } from '../../motion/spring.ts';
import type { Box } from '../../ui/Move.tsx';

export interface BoxTarget {
  box: Box;
  /** When the box snaps to it, in seconds on the clock. */
  at: number;
}

/**
 * The box at `time` as it snaps from target to target: each change is its own spring from the
 * moment it happens, added to the ones before, so a snap that interrupts another stays smooth.
 */
export function boxAt(
  targets: readonly BoxTarget[],
  time: number,
  spring: Spring = springs.snappy,
): Box {
  const first = targets[0];
  if (!first) return { x: 0, y: 0, width: 0, height: 0 };
  const box = { ...first.box };
  for (let index = 1; index < targets.length; index++) {
    const from = targets[index - 1];
    const to = targets[index];
    if (!from || !to) continue;
    const k = springAt(time, to.at, spring);
    box.x += (to.box.x - from.box.x) * k;
    box.y += (to.box.y - from.box.y) * k;
    box.width += (to.box.width - from.box.width) * k;
    box.height += (to.box.height - from.box.height) * k;
  }
  return box;
}
