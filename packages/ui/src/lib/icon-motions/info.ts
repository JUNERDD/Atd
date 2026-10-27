import type { IconMotion } from '../icon-motion';
import { strokeTrace } from './stroke-trace';

/** Lucide 1.54.0: the dot makes a short arc, lands on its stem, then the enclosing ring responds. */
export const infoMotion: IconMotion = [
  {
    selector: 'path:last-child',
    duration: 760,
    keyframes: [
      { transform: 'translate(0, 0)', offset: 0 },
      { transform: 'translate(-1.3px, -2.5px)', offset: 0.2 },
      { transform: 'translate(1px, -3px)', offset: 0.35 },
      { transform: 'translate(0, 0.6px)', offset: 0.52 },
      { transform: 'translate(0, -0.4px)', offset: 0.64 },
      { transform: 'translate(0, 0)', offset: 0.76 },
      { transform: 'translate(0, 0)', offset: 1 },
    ],
  },
  {
    selector: 'path:nth-child(2)',
    origin: '50% 100%',
    duration: 760,
    keyframes: [
      { transform: 'scaleY(1)', offset: 0 },
      { transform: 'scaleY(1)', offset: 0.45 },
      { transform: 'scaleY(0.8)', offset: 0.54 },
      { transform: 'scaleY(1.1)', offset: 0.68 },
      { transform: 'scaleY(1)', offset: 0.82 },
      { transform: 'scaleY(1)', offset: 1 },
    ],
  },
  strokeTrace('circle', { start: 0.52, duration: 760 }),
];
