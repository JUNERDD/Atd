import type { IconMotion } from '../icon-motion';

/** Lucide 1.54.0: the body pulls from the fixed pins; the cable trails the reconnecting body. */
export const plugMotion: IconMotion = [
  {
    selector: 'path:nth-child(3)',
    origin: '50% 0%',
    duration: 720,
    keyframes: [
      { transform: 'translate(0, 0) rotate(0deg)', offset: 0 },
      { transform: 'translate(0.6px, 3px) rotate(-8deg)', offset: 0.27 },
      { transform: 'translate(0, 3px) rotate(0deg)', offset: 0.42 },
      { transform: 'translate(0, -0.6px) rotate(0deg)', offset: 0.62 },
      { transform: 'translate(0, 0.4px) rotate(0deg)', offset: 0.8 },
      { transform: 'translate(0, 0) rotate(0deg)', offset: 1 },
    ],
  },
  {
    selector: 'path:nth-child(1)',
    origin: '50% 0%',
    duration: 720,
    keyframes: [
      { transform: 'translate(0, 0) rotate(0deg)', offset: 0 },
      { transform: 'translate(1.8px, 3px) rotate(8deg)', offset: 0.27 },
      { transform: 'translate(0, 3px) rotate(-6deg)', offset: 0.42 },
      { transform: 'translate(0, -0.6px) rotate(5deg)', offset: 0.62 },
      { transform: 'translate(0, 0.4px) rotate(-2deg)', offset: 0.8 },
      { transform: 'translate(0, 0) rotate(0deg)', offset: 1 },
    ],
  },
  {
    selector: 'path:nth-child(2), path:nth-child(4)',
    duration: 720,
    keyframes: [
      { strokeWidth: 2, offset: 0 },
      { strokeWidth: 2, offset: 0.56 },
      { strokeWidth: 3.4, offset: 0.65 },
      { strokeWidth: 2, offset: 0.9 },
      { strokeWidth: 2, offset: 1 },
    ],
  },
];
