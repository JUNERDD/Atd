import type { IconMotion } from '../icon-motion';
import { strokeTrace } from './stroke-trace';

/** The head's vertical offset in px: still while the antenna receives, then crouch, hop, land. */
const hop = [
  { offset: 0, y: 0 },
  { offset: 0.3, y: 0 },
  { offset: 0.4, y: 0.8 },
  { offset: 0.54, y: -1.4 },
  { offset: 0.68, y: 0.3 },
  { offset: 0.78, y: 0 },
  { offset: 0.84, y: 0 },
  { offset: 0.92, y: 0 },
  { offset: 1, y: 0 },
];

/** Antenna sway (deg) and eye height (scale) per hop frame; the eyes blink once the head lands. */
const sway = [0, 0, 0, -12, 8, -3, 0, 0, 0];
const blink = [1, 1, 1, 1, 1, 1, 0.1, 1, 1];

/**
 * Lucide 1.61.0: a signal runs up the antenna, the head hops in answer with the antenna swaying
 * from its base, and the eyes blink after it lands.
 */
export const botMotion: IconMotion = [
  strokeTrace('path:nth-child(1)', { end: 0.34, duration: 820 }),
  {
    selector: 'rect, path:nth-child(3), path:nth-child(4)',
    duration: 820,
    keyframes: hop.map(({ offset, y }) => ({ transform: `translateY(${y}px)`, offset })),
  },
  {
    selector: 'path:nth-child(1)',
    origin: '100% 100%',
    duration: 820,
    keyframes: hop.map(({ offset, y }, index) => ({
      transform: `translateY(${y}px) rotate(${sway[index]}deg)`,
      offset,
    })),
  },
  {
    selector: 'path:nth-child(5), path:nth-child(6)',
    duration: 820,
    keyframes: hop.map(({ offset, y }, index) => ({
      transform: `translateY(${y}px) scaleY(${blink[index]})`,
      offset,
    })),
  },
];
