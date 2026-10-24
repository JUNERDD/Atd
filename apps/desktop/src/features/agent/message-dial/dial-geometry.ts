/** The dial's drawing height in px; the svg is as wide as the popover. */
export const DIAL_HEIGHT = 88;
/** Arc length between two neighbouring ticks, in px: a drag this far moves one message. */
export const TICK_SPACING = 30;
/** Where the arc's crown sits below the svg's top edge, leaving room for the notch above it. */
const ARC_TOP = 22;
/** The arc's inset from the svg's sides. */
const ARC_INSET = 4;
/** The gap between the arc and where the ticks start hanging inward. */
const TICK_GAP = 6;
/** Tick lengths: the shortest, and how much a long turn adds (a turn this tall or taller). */
const TICK_MIN = 9;
const TICK_RANGE = 15;
const TALL_TURN_PX = 560;
/** How much longer the selected tick is than its turn's height alone would make it. */
const SELECTED_EXTRA = 5;

export const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/**
 * A wide circle whose top runs along the svg: its radius, centre, the angle one tick spacing turns
 * through (`step`), and the half-angle the visible arc spans (`reach`).
 */
export type DialGeometry = {
  width: number;
  r: number;
  cx: number;
  cy: number;
  step: number;
  reach: number;
};

export function dialGeometry(width: number): DialGeometry {
  const r = Math.max(width * 1.05, 340);
  return {
    width,
    r,
    cx: width / 2,
    cy: ARC_TOP + r,
    step: TICK_SPACING / r,
    reach: Math.asin(Math.min(1, Math.max(0, width / 2 - ARC_INSET) / r)),
  };
}

/** The point at `radius` from the centre, `angle` radians clockwise from the top. */
function pointAt(geometry: DialGeometry, radius: number, angle: number): [number, number] {
  return [geometry.cx + radius * Math.sin(angle), geometry.cy - radius * Math.cos(angle)];
}

/** The visible arc as an svg path. */
export function arcPath(geometry: DialGeometry): string {
  const { r, reach } = geometry;
  const [x0, y0] = pointAt(geometry, r, -reach);
  const [x1, y1] = pointAt(geometry, r, reach);
  return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
}

/** The fixed notch over the crown: a small triangle pointing down at the selected tick. */
export function notchPath(geometry: DialGeometry): string {
  const { cx } = geometry;
  return `M ${cx - 5} 8 L ${cx + 5} 8 L ${cx} 15 Z`;
}

/** How long a turn's tick is: longer for a taller turn, clamped; an unmeasured turn's is shortest. */
export function tickLength(height: number | undefined): number {
  if (height === undefined) return TICK_MIN;
  return TICK_MIN + Math.round(TICK_RANGE * Math.min(1, height / TALL_TURN_PX));
}

export type Tick = { x1: number; y1: number; x2: number; y2: number; opacity: number };

/**
 * Where the tick of message `index` lies with the dial turned to `position`, or null when it has
 * turned past the visible arc. Ticks hang inward from the arc and fade toward its ends; the
 * selected one is longer and fully opaque.
 */
export function tickAt(
  geometry: DialGeometry,
  index: number,
  position: number,
  length: number,
  selected: boolean,
): Tick | null {
  const angle = (index - position) * geometry.step;
  if (Math.abs(angle) > geometry.reach) return null;
  const outer = geometry.r - TICK_GAP;
  const inner = outer - length - (selected ? SELECTED_EXTRA : 0);
  const [x1, y1] = pointAt(geometry, outer, angle);
  const [x2, y2] = pointAt(geometry, inner, angle);
  const fade = 1 - (Math.abs(angle) / geometry.reach) ** 2;
  return { x1, y1, x2, y2, opacity: selected ? 1 : 0.15 + 0.7 * fade };
}

/** The range of message indices whose ticks can lie on the visible arc at `position`. */
export function visibleRange(geometry: DialGeometry, position: number, count: number) {
  const span = geometry.reach / geometry.step;
  return {
    start: Math.max(0, Math.ceil(position - span)),
    end: Math.min(count - 1, Math.floor(position + span)),
  };
}

/** The dial position a click at svg x-coordinate `x` points at, from the current `position`. */
export function positionAtX(geometry: DialGeometry, position: number, x: number): number {
  return position + Math.asin(clamp((x - geometry.cx) / geometry.r, -1, 1)) / geometry.step;
}

/** Past either end the dial gives way with growing resistance, so a drag never runs off it. */
export function rubberBand(position: number, count: number): number {
  const give = (over: number) => (0.6 * over) / (1 + over);
  if (position < 0) return -give(-position);
  const last = count - 1;
  return position > last ? last + give(position - last) : position;
}
