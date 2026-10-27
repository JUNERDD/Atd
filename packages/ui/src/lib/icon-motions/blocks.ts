import type { IconMotion } from '../icon-motion';

/** Lucide 1.54.0: a loose tile lifts, turns and seats in the base to form a centered 2×2 grid. */
export const blocksMotion: IconMotion = [
  {
    selector: 'rect',
    duration: 800,
    hold: true,
    keyframes: [
      { transform: 'translate(0, 0) rotate(0deg)', offset: 0 },
      { transform: 'translate(1px, -1px) rotate(-14deg)', offset: 0.2 },
      { transform: 'translate(-2px, -1px) rotate(8deg)', offset: 0.42 },
      { transform: 'translate(-2.5px, 2.5px) rotate(0deg)', offset: 0.68 },
      { transform: 'translate(-1.8px, 1.8px) rotate(0deg)', offset: 0.84 },
      { transform: 'translate(-2px, 2px) rotate(0deg)', offset: 1 },
    ],
  },
  {
    selector: 'path',
    duration: 800,
    hold: true,
    keyframes: [
      { transform: 'translate(0, 0)', offset: 0 },
      { transform: 'translate(-0.5px, 0.5px)', offset: 0.2 },
      { transform: 'translate(2px, -2px)', offset: 0.42 },
      { transform: 'translate(2.3px, -1.7px)', offset: 0.68 },
      { transform: 'translate(1.9px, -2.1px)', offset: 0.84 },
      { transform: 'translate(2px, -2px)', offset: 1 },
    ],
  },
];
