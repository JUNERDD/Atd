import type { IconMotion, IconMotionTrack } from '../icon-motion';

function clickRay(selector: string, translation: string, start: number): IconMotionTrack {
  return {
    selector,
    duration: 700,
    keyframes: [
      { transform: 'translate(0, 0)', opacity: 1, offset: 0 },
      { transform: 'translate(0, 0)', opacity: 0.15, offset: start },
      { transform: translation, opacity: 1, offset: start + 0.16 },
      { transform: translation, opacity: 0.4, offset: start + 0.3 },
      { transform: 'translate(0, 0)', opacity: 1, offset: 1 },
    ],
  };
}

/** Lucide 1.54.0: approach, click and release; the contact rays fan out in sequence. */
export const mousePointerClickMotion: IconMotion = [
  {
    selector: 'path:last-child',
    duration: 700,
    keyframes: [
      { transform: 'translate(0, 0)', offset: 0 },
      { transform: 'translate(1px, 1px)', offset: 0.18 },
      { transform: 'translate(-2px, -2px)', offset: 0.34 },
      { transform: 'translate(-2px, -2px)', offset: 0.44 },
      { transform: 'translate(0.5px, 0.5px)', offset: 0.72 },
      { transform: 'translate(0, 0)', offset: 1 },
    ],
  },
  clickRay('path:nth-child(4)', 'translate(-0.5px, -2.4px)', 0.3),
  clickRay('path:nth-child(1)', 'translate(1.8px, -1.8px)', 0.34),
  clickRay('path:nth-child(2)', 'translate(-2.4px, -0.6px)', 0.38),
  clickRay('path:nth-child(3)', 'translate(-1.8px, 1.8px)', 0.42),
];
