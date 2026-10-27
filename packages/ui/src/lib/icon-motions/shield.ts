import type { IconMotion } from '../icon-motion';
import { strokeTrace } from './stroke-trace';

/** Lucide 1.54.0: raise the guard, trace its perimeter and let the interior illumination fade. */
export const shieldMotion: IconMotion = [
  {
    selector: 'path',
    origin: '50% 85%',
    duration: 760,
    keyframes: [
      { transform: 'translateY(0) rotate(0deg)', offset: 0 },
      { transform: 'translateY(-1px) rotate(-8deg)', offset: 0.2 },
      { transform: 'translateY(0) rotate(2deg)', offset: 0.4 },
      { transform: 'translateY(0) rotate(0deg)', offset: 0.55 },
      { transform: 'translateY(0) rotate(0deg)', offset: 1 },
    ],
  },
  strokeTrace('path', { start: 0.55, duration: 760 }),
  {
    selector: 'path',
    layer: 'overlay',
    duration: 760,
    keyframes: [
      { fillOpacity: 0, offset: 0 },
      { fillOpacity: 0, offset: 0.6 },
      { fillOpacity: 0.2, offset: 0.78 },
      { fillOpacity: 0, offset: 1 },
    ].map((frame) => ({ ...frame, fill: 'currentColor', stroke: 'none' })),
  },
];
