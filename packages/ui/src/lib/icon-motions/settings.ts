import type { IconMotion } from '../icon-motion';
import { strokeTrace } from './stroke-trace';

/** Lucide 1.54.0: the sixfold gear winds back, turns two teeth, then settles over its fixed hub. */
export const settingsMotion: IconMotion = [
  {
    selector: 'path',
    duration: 760,
    keyframes: [
      { transform: 'rotate(0deg)', offset: 0 },
      { transform: 'rotate(-12deg)', offset: 0.18 },
      { transform: 'rotate(132deg)', offset: 0.68 },
      { transform: 'rotate(116deg)', offset: 0.86 },
      { transform: 'rotate(120deg)', offset: 1 },
    ],
  },
  strokeTrace('circle', { start: 0.18, end: 0.84, duration: 760 }),
];
