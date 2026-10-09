import { useCurrentFrame } from 'remotion';
import { clamp01, easeIn, ramp } from '../../motion/ease.ts';
import { CASE_LENGTH, FPS } from '../../timeline.ts';

/** A case's layers mount this long before its start, and stay this long after its end, so moves overlap. */
export const CASE_LEAD = 0.6;
export const CASE_TAIL = 0.6;

/** Seconds since the case started; negative while it is still being set up. */
export function useCaseTime(): number {
  return useCurrentFrame() / FPS - CASE_LEAD;
}

/** 0 → 1 as a case's layers leave, starting just before the next case begins. */
export function leaving(t: number, lead = 0.32, length = 0.42): number {
  return ramp(t, CASE_LENGTH - lead, length, easeIn);
}

/** Opacity that arrives quickly once a spring starts, without waiting for it to settle. */
export function arrive(progress: number, speed = 2.6): number {
  return clamp01(progress * speed);
}
