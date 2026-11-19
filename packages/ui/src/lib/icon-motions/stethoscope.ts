import type { IconMotion } from '../icon-motion';
import { strokeTrace } from './stroke-trace';

/** Lucide 1.61.0: a trace travels from the earpieces through the tubing to the chest piece, which pulses once. */
export const stethoscopeMotion: IconMotion = [
  strokeTrace('path:nth-child(3)', { end: 0.44, duration: 800 }),
  strokeTrace('path:nth-child(4)', { start: 0.34, end: 0.78, duration: 800 }),
  strokeTrace('circle', { start: 0.66, duration: 800 }),
  {
    selector: 'circle',
    origin: '50% 50%',
    duration: 800,
    keyframes: [
      { transform: 'scale(1)', offset: 0 },
      { transform: 'scale(1)', offset: 0.62 },
      { transform: 'scale(1.18)', offset: 0.78 },
      { transform: 'scale(0.95)', offset: 0.9 },
      { transform: 'scale(1)', offset: 1 },
    ],
  },
];
