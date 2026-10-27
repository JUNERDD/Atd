import type { IconMotion } from '../icon-motion';

/** Lucide 1.54.0: charge travels down the bolt, then drains in the same direction. */
export const zapMotion: IconMotion = [
  {
    selector: 'path',
    layer: 'overlay',
    duration: 640,
    easing: 'linear',
    keyframes: [
      { clipPath: 'inset(0 0 100% 0)', opacity: 0, offset: 0 },
      { clipPath: 'inset(0 0 80% 0)', opacity: 0.6, offset: 0.22 },
      { clipPath: 'inset(0 0 0% 0)', opacity: 1, offset: 0.48 },
      { clipPath: 'inset(0 0 0% 0)', opacity: 1, offset: 0.6 },
      { clipPath: 'inset(100% 0 0% 0)', opacity: 0, offset: 0.94 },
      { clipPath: 'inset(100% 0 0% 0)', opacity: 0, offset: 1 },
    ].map((frame) => ({ ...frame, fill: 'currentColor', stroke: 'none' })),
  },
];
