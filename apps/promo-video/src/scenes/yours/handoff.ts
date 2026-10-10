/**
 * The hand-off from Yours to the Finale across the cut: a whip pan and the light behind it. The
 * camera accelerates out of Yours and decelerates into the Finale on mirrored power curves, so its
 * speed peaks exactly on the cut and matches on both sides, and the cut hides inside the motion
 * blur. The backdrop rides its own camera at a fraction of the distance, with the same mood on
 * both sides, so it runs on unbroken.
 */
import type { CameraState } from '../../kit/world/camera.ts';
import type { MoodWeights } from '../../kit/world/light-field.ts';
import { clamp01 } from '../../motion/ease.ts';

/** Seconds on each side of the cut. */
export const WHIP_TIME = 0.4;
/** How far the camera travels on each side of the cut, in world px. */
export const WHIP_DISTANCE = 1700;
const POWER = 2.4;

export interface WhipOffset {
  /** Offset of the camera along x, in world px. */
  x: number;
  /** Its velocity, in world px per second. */
  vx: number;
}

/** Leaving: 0 until `start`, then accelerating to `distance` at `start + WHIP_TIME`. */
export function whipOut(t: number, start: number, distance = WHIP_DISTANCE): WhipOffset {
  const p = clamp01((t - start) / WHIP_TIME);
  return {
    x: distance * p ** POWER,
    vx: p > 0 && p < 1 ? (distance * POWER * p ** (POWER - 1)) / WHIP_TIME : 0,
  };
}

/** Arriving: `-distance` at 0, decelerating to rest at `WHIP_TIME`. */
export function whipIn(t: number, distance = WHIP_DISTANCE): WhipOffset {
  const q = 1 - clamp01(t / WHIP_TIME);
  return {
    x: -distance * q ** POWER,
    vx: q > 0 ? (distance * POWER * q ** (POWER - 1)) / WHIP_TIME : 0,
  };
}

/** The backdrop's camera zooms past the light's edges so the whip can carry it. */
const LIGHT_ZOOM = 1.3;
/** The backdrop moves this share of the whip: it is far behind the marks. */
export const LIGHT_PARALLAX = 0.085;
/**
 * Where the backdrop's camera starts in Yours; the whip carries it one parallax distance per side,
 * ending in the Finale still inside the light's box (at zoom 1.3 its center may span 738–1182).
 */
export const LIGHT_X = 750;
/** The light on both sides of the cut. */
export const HANDOFF_MOOD: MoodWeights = { night: 0.75, dawn: 0.25 };
export const HANDOFF_INTENSITY = 0.9;

/** The backdrop's camera at `x` (world px), moving at `vx`. */
export function lightCamera(x: number, vx: number): CameraState {
  return { x, y: 540, zoom: LIGHT_ZOOM, rotateX: 0, rotateY: 0, blur: 0, vx, vy: 0, vzoom: 0 };
}
