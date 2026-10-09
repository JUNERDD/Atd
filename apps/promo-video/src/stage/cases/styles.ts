import { clamp01, mix } from '../../motion/ease.ts';
import { springAt, springs, type Spring } from '../../motion/spring.ts';
import type { Motion } from '../../ui/Move.tsx';
import { arrive } from './case-time.ts';

/** Rises a short way into place as it fades in. */
export function appear(
  t: number,
  at: number,
  distance = 10,
  spring: Spring = springs.smooth,
): Motion {
  const p = springAt(t, at, spring);
  return { opacity: arrive(p, 2), y: mix(distance, 0, p) };
}

/** Pops into place from `origin`, overshooting a touch. */
export function pop(t: number, at: number, origin: string, from = 0.8): Motion {
  const p = springAt(t, at, springs.pop);
  return { opacity: arrive(p, 3), scale: mix(from, 1, p), origin, y: mix(6, 0, p) };
}

/** Reveals behind a soft moving edge, left to right or top to bottom, as `progress` goes 0 → 1. */
export function wipe(progress: number, direction: 'right' | 'down' = 'right', soft = 8): Motion {
  return {
    wipe: {
      edge: clamp01(progress) * (100 + soft) - soft,
      soft,
      direction: direction === 'right' ? 'to right' : 'to bottom',
    },
  };
}
