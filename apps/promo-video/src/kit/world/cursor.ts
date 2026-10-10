/**
 * The pointer's choreography as data: a list of keyframes, each a place the cursor reaches at a
 * time, optionally clicking there, pressing to drag, or changing shape. `cursorAt` evaluates it at
 * any time, purely, with the velocity motion blur needs.
 *
 * Time model: a key's `at` is when the cursor ARRIVES. It leaves the previous key `travel` seconds
 * before that (default: from the distance, 0.3–0.85 s, never earlier than the previous key), on a
 * slightly arcing path with a small overshoot that settles by `at`. Clicks happen on arrival.
 */
import { Easing } from 'remotion';
import { clamp01, hash01, mix, ramp } from '../../motion/ease.ts';

export type CursorKind = 'arrow' | 'hand';

export interface CursorKey {
  /** Seconds (on the caller's clock) at which the cursor arrives here. */
  at: number;
  /** Position, in the units of the layer the cursor is drawn in (points inside `Desktop`). */
  x: number;
  y: number;
  /** `true` clicks on arrival; `'down'` presses and holds (to drag) until a later `'up'`. */
  press?: true | 'down' | 'up';
  /** The shape from arrival on (default `arrow`); it changes just before the cursor arrives. */
  kind?: CursorKind;
  /** Seconds the move here takes; default from the distance. */
  travel?: number;
}

export interface CursorState {
  x: number;
  y: number;
  kind: CursorKind;
  /** 0 (up) → 1 (pressed). */
  pressed: number;
  /** The pointer's scale: 1, dipping to 0.9 while pressed. */
  scale: number;
  /** Velocity in units per second, and its magnitude: for motion blur. */
  vx: number;
  vy: number;
  speed: number;
}

/** A quick start, a long settle and about 3% of overshoot before it comes to rest. */
const moveEase = Easing.bezier(0.3, 0, 0.12, 1.1);

function travelOf(from: CursorKey, to: CursorKey): number {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const natural = to.travel ?? Math.min(0.85, Math.max(0.3, 0.26 + distance / 1500));
  return Math.min(natural, Math.max(0.0001, to.at - from.at));
}

function sorted(keys: readonly CursorKey[]): CursorKey[] {
  return [...keys].sort((a, b) => a.at - b.at);
}

function positionAt(t: number, keys: readonly CursorKey[]): { x: number; y: number } {
  const first = keys[0];
  if (!first) return { x: 0, y: 0 };
  let position = { x: first.x, y: first.y };
  for (let index = 1; index < keys.length; index++) {
    const from = keys[index - 1];
    const to = keys[index];
    if (!from || !to) continue;
    const start = to.at - travelOf(from, to);
    if (t <= start) break;
    const p = clamp01((t - start) / (to.at - start));
    const e = moveEase(p);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    // A hand never moves a mouse in a straight line: bow the path a little to one side.
    const bow = Math.sin(Math.PI * p) * 0.07 * (hash01(index * 7 + 3) < 0.5 ? -1 : 1);
    position = { x: from.x + dx * e - dy * bow, y: from.y + dy * e + dx * bow };
  }
  return position;
}

function pressedAt(t: number, keys: readonly CursorKey[]): number {
  let pressed = 0;
  let holdFrom: number | null = null;
  for (const key of keys) {
    if (key.press === true) {
      const down = ramp(t, key.at - 0.03, 0.06);
      const up = ramp(t, key.at + 0.1, 0.14);
      pressed = Math.max(pressed, down * (1 - up));
    } else if (key.press === 'down') {
      holdFrom = key.at;
    } else if (key.press === 'up' && holdFrom !== null) {
      pressed = Math.max(pressed, ramp(t, holdFrom - 0.03, 0.06) * (1 - ramp(t, key.at, 0.14)));
      holdFrom = null;
    }
  }
  if (holdFrom !== null) pressed = Math.max(pressed, ramp(t, holdFrom - 0.03, 0.06));
  return pressed;
}

function kindAt(t: number, keys: readonly CursorKey[]): CursorKind {
  let kind: CursorKind = keys[0]?.kind ?? 'arrow';
  for (let index = 1; index < keys.length; index++) {
    const from = keys[index - 1];
    const to = keys[index];
    if (!from || !to) continue;
    const travel = travelOf(from, to);
    // The shape changes as the pointer comes over its target, a moment before it stops.
    if (t >= to.at - travel * 0.15) kind = to.kind ?? 'arrow';
  }
  return kind;
}

/** The cursor at time `t`: position, shape, press and velocity. Keys may be in any order. */
export function cursorAt(t: number, keys: readonly CursorKey[]): CursorState {
  const ordered = sorted(keys);
  const here = positionAt(t, ordered);
  const dt = 1 / 240;
  const before = positionAt(t - dt, ordered);
  const after = positionAt(t + dt, ordered);
  const vx = (after.x - before.x) / (2 * dt);
  const vy = (after.y - before.y) / (2 * dt);
  const pressed = pressedAt(t, ordered);
  return {
    x: here.x,
    y: here.y,
    kind: kindAt(t, ordered),
    pressed,
    scale: mix(1, 0.9, pressed),
    vx,
    vy,
    speed: Math.hypot(vx, vy),
  };
}
