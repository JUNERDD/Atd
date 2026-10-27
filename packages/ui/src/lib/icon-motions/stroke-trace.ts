import type { IconMotionTrack } from '../icon-motion';

/** A moving highlight over the intact glyph. Offsets describe its window within the gesture. */
export function strokeTrace(
  selector: string,
  { start = 0, end = 1, duration = 720 } = {},
): IconMotionTrack {
  const span = end - start;
  return {
    selector,
    layer: 'overlay',
    duration,
    easing: 'linear',
    keyframes: [
      { strokeDashoffset: 1.16, opacity: 0, offset: 0 },
      { strokeDashoffset: 1.16, opacity: 0, offset: start },
      { strokeDashoffset: 1, opacity: 1, offset: start + span * 0.12 },
      { strokeDashoffset: 0, opacity: 1, offset: start + span * 0.82 },
      { strokeDashoffset: -0.16, opacity: 0, offset: end },
      { strokeDashoffset: -0.16, opacity: 0, offset: 1 },
    ].map((frame) => ({ ...frame, strokeDasharray: '0.16 0.84', strokeWidth: 3.4 })),
  };
}
