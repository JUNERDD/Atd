import type { IconMotion } from '../icon-motion';
import { strokeTrace } from './stroke-trace';

/** Lucide 1.54.0: an impulse runs up the stem, through the fork and out into both lobes. */
export const brainMotion: IconMotion = [
  strokeTrace('path:nth-child(1)', { end: 0.36, duration: 820 }),
  strokeTrace('path:nth-child(2)', { start: 0.16, end: 0.52, duration: 820 }),
  strokeTrace('path:nth-child(3)', { start: 0.28, end: 0.64, duration: 820 }),
  strokeTrace('path:nth-child(4), path:nth-child(8)', {
    start: 0.4,
    end: 0.78,
    duration: 820,
  }),
  strokeTrace('path:nth-child(5), path:nth-child(7)', {
    start: 0.52,
    end: 0.9,
    duration: 820,
  }),
  strokeTrace('path:nth-child(6)', {
    start: 0.64,
    duration: 820,
  }),
];
