import type { IconMotion } from '../icon-motion';

/** Lucide 1.54.0: the frame unfolds, then its divider and toolbar slots settle into place. */
export const appWindowMotion: IconMotion = [
  {
    selector: 'rect',
    origin: '50% 0%',
    duration: 760,
    keyframes: [
      { transform: 'scaleY(1)', offset: 0 },
      { transform: 'scaleY(0.3)', offset: 0.18 },
      { transform: 'scaleY(1.08)', offset: 0.56 },
      { transform: 'scaleY(0.97)', offset: 0.78 },
      { transform: 'scaleY(1)', offset: 1 },
    ],
  },
  {
    selector: 'path:nth-child(3)',
    origin: '0% 50%',
    duration: 760,
    keyframes: [
      { transform: 'scaleX(1)', opacity: 1, offset: 0 },
      { transform: 'scaleX(0)', opacity: 0, offset: 0.18 },
      { transform: 'scaleX(0)', opacity: 0, offset: 0.35 },
      { transform: 'scaleX(1.04)', opacity: 1, offset: 0.7 },
      { transform: 'scaleX(1)', opacity: 1, offset: 1 },
    ],
  },
  ...['path:nth-child(2)', 'path:nth-child(4)'].map((selector, index) => ({
    selector,
    origin: '50% 0%',
    duration: 760,
    keyframes: [
      { transform: 'scaleY(1)', opacity: 1, offset: 0 },
      { transform: 'scaleY(0)', opacity: 0, offset: 0.18 },
      { transform: 'scaleY(0)', opacity: 0, offset: 0.4 + index * 0.08 },
      { transform: 'scaleY(1.12)', opacity: 1, offset: 0.72 + index * 0.08 },
      { transform: 'scaleY(1)', opacity: 1, offset: 1 },
    ],
  })),
];
