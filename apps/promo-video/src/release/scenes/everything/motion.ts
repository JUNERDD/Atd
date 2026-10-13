/**
 * The mosaic's motion as pure functions of the clock: the camera's mapping between world and frame,
 * which tiles are in frame, the completion glint's pass, each tile's converge flight into the
 * caret, the point's stretch into it, and the dot field's pulses and clock. DOM-free.
 */
import { clamp01, easeInOut, mix, ramp, smoothstep } from '../../../motion/ease.ts';
import type { CameraState } from '../../../kit/world/camera.ts';
import type { Pulse } from '../../world/dots.ts';
import { FINALE_ENTRY } from '../finale/beats.ts';
import { EVERYTHING_BEATS as B } from './beats.ts';
import { centerOf, DIGITS, TILES, type Rect } from './layout.ts';

const HALF = { x: 960, y: 540 } as const;
/** Where everything converges, in frame px: the finale's caret's center. */
export const TARGET = {
  x: FINALE_ENTRY.x + FINALE_ENTRY.width / 2,
  y: FINALE_ENTRY.y + FINALE_ENTRY.height / 2,
} as const;
/** The last frame of the section (the frame before 52.8 s), in section seconds. */
export const LAST_FRAME = (Math.round(B.end * 60) - 1) / 60;

export function toScreen(cam: CameraState, x: number, y: number) {
  return { x: (x - cam.x) * cam.zoom + HALF.x, y: (y - cam.y) * cam.zoom + HALF.y };
}

export function toWorld(cam: CameraState, x: number, y: number) {
  return { x: (x - HALF.x) / cam.zoom + cam.x, y: (y - HALF.y) / cam.zoom + cam.y };
}

/** Whether any of `rect` (world px) is in frame, with a margin for overshoot. */
export function inFrame(cam: CameraState, rect: Rect): boolean {
  const a = toScreen(cam, rect.x, rect.y);
  const b = toScreen(cam, rect.x + rect.width, rect.y + rect.height);
  return b.x > -60 && a.x < 1980 && b.y > -60 && a.y < 1140;
}

/** The glint's place across a tile, 0 → 1, while it passes; it crosses the digits left to right. */
export function glintAt(t: number, rect: Rect): number | undefined {
  const lead = ((rect.x - DIGITS.x) / DIGITS.width) * B.glintLength;
  const p = (t - B.glint - lead) / 0.22;
  return p > 0 && p < 1 ? p : undefined;
}

/** How lit the tiles' edges are: up as the pull back settles, down as they heat in the converge. */
export function litAt(t: number): number {
  return (
    smoothstep(B.pullback + 0.25, B.pullback + 0.75, t) *
    (1 - smoothstep(B.morph, B.converge + 0.2, t))
  );
}

/** The dots dim while "0.8" holds, so the digits read, and are full again for the last frame. */
export function dotsOpacity(t: number): number {
  return (
    1 -
    0.55 *
      (smoothstep(B.pullback + 0.2, B.pullback + 0.7, t) - smoothstep(B.converge, B.swallowed, t))
  );
}

/** The farthest tile from the caret, for timing the converge. */
const REACH = Math.max(
  ...TILES.map((tile) => {
    const c = centerOf(tile.rect);
    return Math.hypot(c.x - TARGET.x, c.y - TARGET.y);
  }),
);

export interface FlightState {
  dx: number;
  dy: number;
  scale: number;
  heat: number;
  opacity: number;
  /** Swallowed: draw nothing. */
  gone: boolean;
}

/**
 * A tile's converge: a breath in while the point stretches (a few percent smaller, leaning toward
 * the caret), then a fall that accelerates into it, nearest tiles first, the farthest landing at
 * `swallowed`, shrinking and heating to coral, fading in its last stretch.
 */
export function flightAt(t: number, rect: Rect, cam: CameraState): FlightState | undefined {
  if (t < B.morph) return undefined;
  const center = centerOf(rect);
  const target = toWorld(cam, TARGET.x, TARGET.y);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const breath = ramp(t, B.morph, B.converge - B.morph, easeInOut);
  const distance = Math.hypot(dx, dy);
  const fall = (B.swallowed - B.converge) * (0.5 + 0.5 * (distance / REACH));
  const p = clamp01((t - B.converge) / fall);
  const e = p ** 2.3;
  const lean = 0.03 * breath;
  return {
    dx: dx * (lean + (1 - lean) * e),
    dy: dy * (lean + (1 - lean) * e),
    scale: (1 - 0.05 * breath) * (1 - 0.92 * e),
    heat: smoothstep(0.05, 0.75, p),
    opacity: 1 - smoothstep(0.7, 1, p),
    gone: p >= 1,
  };
}

/**
 * The point's rect in frame px while it rises and stretches into the caret: from its tile as the
 * camera shows it to the finale's caret, the radius narrowing to the caret's round ends.
 */
export function morphAt(t: number, from: Rect) {
  const p = ramp(t, B.morph, B.morphLength, easeInOut);
  const to = FINALE_ENTRY;
  const width = mix(from.width, to.width, p);
  const height = mix(from.height, to.height, p);
  return {
    x: mix(from.x + from.width / 2, to.x + to.width / 2, p) - width / 2,
    y: mix(from.y + from.height / 2, to.y + to.height / 2, p) - height / 2,
    width,
    height,
    radius: mix(14 * (from.width / 108), to.width / 2, p),
  };
}

/**
 * The caret's bloom while the tiles pour in: a surge with each wave that settles back to the
 * caret's resting 0.6 by `swallowed`, so the last frame is the finale's caret exactly.
 */
export function caretGlow(t: number): number {
  if (t >= B.swallowed) return 0.6;
  const pour =
    smoothstep(B.converge, B.converge + 0.3, t) *
    (1 - smoothstep(B.swallowed - 0.2, B.swallowed, t));
  return 0.6 + 1.1 * pour;
}

export interface FieldView {
  x: number;
  y: number;
  zoom: number;
}

const REST_VIEW: FieldView = { x: 960, y: 540, zoom: 1 };
/** How much of the camera's push the dot field takes: it sits behind the tiles, so it moves less. */
const DEPTH = 0.5;

/**
 * The dot field's view: the camera's, with half its push and travel (parallax, and dots that stay
 * fine in close-ups), settling exactly onto the rest view for the last frames.
 */
export function fieldViewAt(t: number, cam: CameraState): FieldView {
  if (t >= B.swallowed) return REST_VIEW;
  const settle = smoothstep(B.converge, B.swallowed, t);
  const zoom = 1 + (cam.zoom - 1) * DEPTH;
  return {
    x: mix(960 + (cam.x - 960) * DEPTH, 960, settle),
    y: mix(540 + (cam.y - 540) * DEPTH, 540, settle),
    zoom: mix(zoom, 1, settle),
  };
}

/** A world point (tile space) in the dot field's own space, through where the frame shows it. */
function toField(cam: CameraState, view: FieldView, x: number, y: number) {
  const screen = toScreen(cam, x, y);
  return { x: (screen.x - 960) / view.zoom + view.x, y: (screen.y - 540) / view.zoom + view.y };
}

/**
 * The dot field's clock and twinkle. The field must read `t = 0` on the first frame and again on
 * the last (both neighbours start from the bare field at 0), so the glints fade out while the lead
 * plays, the clock jumps while nothing glints, and they fade back in to land on 0 exactly.
 */
export function fieldClock(t: number): { t: number; twinkle: number; offset: number } {
  const twinkle = 0.5 * (1 - smoothstep(0.6, 1.8, t)) + 0.5 * smoothstep(11.2, B.swallowed, t);
  const offset = t < 6 ? 0 : LAST_FRAME;
  return { t: t - offset, twinkle, offset };
}

/**
 * The ripples under the mosaic, placed where the frame shows their tiles: soft ones on the lead's beats, one under every tile
 * as it lands (heavier for heroes), a coral one when the point lands. They fade out entirely before
 * the last frame, which must show the bare field.
 */
export function fieldPulses(t: number, cam: CameraState, view: FieldView): Pulse[] {
  if (t >= B.swallowed) return [];
  const fade = 1 - smoothstep(B.converge, B.swallowed, t);
  const { offset } = fieldClock(t);
  const out: Pulse[] = [
    { x: 960, y: 540, at: B.lead[1], strength: 0.35 * fade, speed: 700 },
    { x: 960, y: 540, at: B.lead[3], strength: 0.3 * fade, speed: 700 },
  ];
  for (const tile of TILES) {
    const c = centerOf(tile.rect);
    const hero = tile.word !== undefined;
    const point = tile.kind === 'point';
    out.push({
      ...c,
      at: tile.arrive,
      strength: (point ? 1.15 : hero ? 0.8 : 0.45) * fade,
      speed: point ? 900 : 620,
      tint: point ? 'coral' : 'white',
    });
  }
  out.push({ x: 960, y: 528, at: B.pullback, strength: 0.7 * fade, speed: 1000 });
  return out
    .filter((pulse) => t >= pulse.at - 0.01 && t - pulse.at < 2.3)
    .map((pulse) => ({ ...pulse, ...toField(cam, view, pulse.x, pulse.y), at: pulse.at - offset }));
}
