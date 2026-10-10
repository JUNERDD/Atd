/**
 * The film's 2.5D camera as data. A shot names the world point at the frame's center (in frame
 * pixels of the world container: 960, 540 is its middle), a zoom, an optional tilt and a depth
 * blur. `cameraAt` springs from each shot to the next, purely: every transition adds its change on
 * its own spring, so overlapping moves blend the way an interrupted spring would.
 *
 * Time model: a shot's `at` is when the camera STARTS moving to it (seconds, on the caller's
 * clock); the first shot is where the camera rests before that. The default spring is `camera`
 * (≈ 1.2 s to settle); pass a faster one for a whip.
 */
import { springAt, springs, springVelocity, type Spring } from '../../motion/spring.ts';
import { HEIGHT, WIDTH } from '../../timeline.ts';
import { DISPLAY, FRAME_SCALE, type Point } from './points.ts';

export interface Shot {
  at: number;
  /** The world point at the frame's center, in frame pixels. */
  x: number;
  y: number;
  zoom: number;
  /** Tilt about the focus, in degrees (positive rotateX leans the top away); omitted is level. */
  rotateX?: number;
  rotateY?: number;
  /** Depth-of-field blur, in frame pixels; omitted is sharp. */
  blur?: number;
  /** The spring this move uses (default `springs.camera`). */
  spring?: Spring;
}

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  rotateX: number;
  rotateY: number;
  blur: number;
  /** Rates of change per second: world px for x and y, zoom units for zoom. */
  vx: number;
  vy: number;
  vzoom: number;
}

const KEYS = ['x', 'y', 'zoom', 'rotateX', 'rotateY', 'blur'] as const;
type Key = (typeof KEYS)[number];

function valueOf(shot: Shot, key: Key): number {
  return shot[key] ?? 0;
}

/** The most motion blur a frame gets, in px: past this a whip reads as a smear, not motion. */
const MAX_BLUR = 16;

/** The camera at rest: the world container exactly fills the frame. */
export const REST_SHOT: Shot = { at: 0, x: WIDTH / 2, y: HEIGHT / 2, zoom: 1 };

/** The camera at time `t`, with its velocity. Shots may be in any order. */
export function cameraAt(t: number, shots: readonly Shot[]): CameraState {
  const ordered = [...shots].sort((a, b) => a.at - b.at);
  const first = ordered[0] ?? REST_SHOT;
  const state = {
    x: first.x,
    y: first.y,
    zoom: first.zoom,
    rotateX: first.rotateX ?? 0,
    rotateY: first.rotateY ?? 0,
    blur: first.blur ?? 0,
  };
  const velocity = { x: 0, y: 0, zoom: 0 };
  for (let index = 1; index < ordered.length; index++) {
    const from = ordered[index - 1];
    const to = ordered[index];
    if (!from || !to) continue;
    const spring = to.spring ?? springs.camera;
    const progress = springAt(t, to.at, spring);
    const rate = springVelocity(t, to.at, spring);
    for (const key of KEYS) {
      state[key] += (valueOf(to, key) - valueOf(from, key)) * progress;
    }
    velocity.x += (to.x - from.x) * rate;
    velocity.y += (to.y - from.y) * rate;
    velocity.zoom += (to.zoom - from.zoom) * rate;
  }
  return { ...state, vx: velocity.x, vy: velocity.y, vzoom: velocity.zoom };
}

/**
 * A shot centered on a point of the Mac's display (in points), for a world that holds `Desktop` at
 * its origin unzoomed. `zoom` is relative to the full-frame desktop. At zoom 1 and above the
 * point is nudged so the frame never shows past the display's edges (pass `contain: false` to
 * frame freely, e.g. to pull back and see the display as an object).
 */
export function shotOnDisplay(
  at: number,
  point: Point,
  zoom: number,
  extra: Partial<Shot> & { contain?: boolean } = {},
): Shot {
  const { contain = true, ...rest } = extra;
  let x = point.x * FRAME_SCALE;
  let y = point.y * FRAME_SCALE;
  if (contain && zoom >= 1) {
    const halfWidth = WIDTH / 2 / zoom;
    const halfHeight = HEIGHT / 2 / zoom;
    x = Math.min(Math.max(x, halfWidth), DISPLAY.width * FRAME_SCALE - halfWidth);
    y = Math.min(Math.max(y, halfHeight), DISPLAY.height * FRAME_SCALE - halfHeight);
  }
  return { ...rest, at, x, y, zoom };
}

/**
 * The motion blur a frame of this camera would show, in frame pixels along each axis: the
 * distance the image travels during a 1/120 s exposure, as a Gaussian's deviation, with the zoom's
 * radial streak folded in on both axes.
 */
export function cameraBlur(state: CameraState): { x: number; y: number } {
  const shutter = 1 / 120;
  // A box exposure of length L blurs like a Gaussian of deviation ≈ 0.29 L. A zoom streaks
  // radially, nothing at the center and most at the edges: fold in an average radius.
  const box = 0.29;
  const zoomStreak = (Math.abs(state.vzoom) / Math.max(0.05, state.zoom)) * 380 * shutter;
  const cap = (value: number) => Math.min(MAX_BLUR, value);
  return {
    x: cap((Math.abs(state.vx) * state.zoom * shutter + zoomStreak) * box),
    y: cap((Math.abs(state.vy) * state.zoom * shutter + zoomStreak) * box),
  };
}
