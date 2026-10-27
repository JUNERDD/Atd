import type { IconMotion } from '../icon-motion';

/** Lucide 1.54.0: a key downstroke sends a highlight around the command glyph's four loops. */
export const commandMotion: IconMotion = [
  {
    selector: 'path',
    origin: '50% 100%',
    duration: 720,
    keyframes: [
      { transform: 'translateY(0) scaleY(1)', offset: 0 },
      { transform: 'translateY(1.3px) scaleY(0.9)', offset: 0.18 },
      { transform: 'translateY(1.3px) scaleY(0.9)', offset: 0.3 },
      { transform: 'translateY(-0.4px) scaleY(1.03)', offset: 0.48 },
      { transform: 'translateY(0) scaleY(1)', offset: 0.6 },
      { transform: 'translateY(0) scaleY(1)', offset: 1 },
    ],
  },
  {
    selector: 'path',
    layer: 'overlay',
    duration: 720,
    easing: 'linear',
    keyframes: [
      { strokeDashoffset: 0, opacity: 0, offset: 0 },
      { strokeDashoffset: 0, opacity: 0, offset: 0.6 },
      { strokeDashoffset: -0.04, opacity: 1, offset: 0.68 },
      { strokeDashoffset: -0.22, opacity: 1, offset: 0.94 },
      { strokeDashoffset: -0.25, opacity: 0, offset: 1 },
    ].map((frame) => ({ ...frame, strokeDasharray: '0.08 0.17', strokeWidth: 3.4 })),
  },
];
