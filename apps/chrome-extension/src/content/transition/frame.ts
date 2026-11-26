import { GLOW_PALETTES, type GlowRgb } from '@atd/ui/lib/glow/palettes';
import { MASK_SLOTS } from './glsl.ts';

/** `ripple` at the takeover, `sweep` at done (WARP.md › Snapshot transitions). */
export type TransitionKind = 'ripple' | 'sweep';

/** How long each transition runs before its fade-out, in ms. */
export const DURATION_MS: Record<TransitionKind, number> = { ripple: 1100, sweep: 1350 };

/** A point in viewport CSS px from the top left. */
export interface ViewportPoint {
  x: number;
  y: number;
}

/**
 * What stays fixed through one transition: the frame's geometry and the uniforms the shader
 * reads every frame unchanged. The frame's coordinates are CSS px from its bottom left (GL's
 * orientation); its top left is the viewport's.
 */
export interface FrameSetup {
  kind: TransitionKind;
  /** The frame's size in device px (the texture's). */
  pixels: readonly [number, number];
  dpr: number;
  /** The frame's size in CSS px. */
  size: readonly [number, number];
  /** The HUD's centre when the transition started. */
  origin: readonly [number, number];
  /** How far the ring or band travels: past the farthest corner. */
  reach: number;
  /** The sweep's band depth (0 for the ripple). */
  band: number;
  darkness: number;
  tint: GlowRgb;
  glow: GlowRgb;
  /** Atd's surfaces where the capture shows them (`maskRects`). */
  frozen: Float32Array;
}

/** A mask slot nobody uses: a point this far outside the frame clears nothing. */
const PARKED = -1e6;

const mix = (a: GlowRgb, b: GlowRgb, t: number): GlowRgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * The working palette's cool tone: on a light page between the deep teal and the steel azure; on a
 * dark page the dark steel, given the light steel's chroma so the added light reads cool, not grey.
 */
const { light, dark } = GLOW_PALETTES.working;
const TINT = mix(light[0], light[1], 0.6);
const GLOW = mix(dark[1], light[1], 0.5);

/**
 * The setup for a frame of `pixels` device px at `dpr`, played out of `origin` (the HUD's centre,
 * viewport CSS px) over a page as dark as `darkness`, with Atd's surfaces at `frozen` in it.
 */
export function frameSetup(
  kind: TransitionKind,
  pixels: readonly [number, number],
  dpr: number,
  origin: ViewportPoint,
  darkness: number,
  frozen: readonly DOMRectReadOnly[],
): FrameSetup {
  const width = pixels[0] / dpr;
  const height = pixels[1] / dpr;
  const o: [number, number] = [origin.x, height - origin.y];
  // Both transitions travel out from the HUD's centre to the farthest corner.
  const corners: readonly (readonly [number, number])[] = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ];
  const far = Math.max(...corners.map(([x, y]) => Math.hypot(x - o[0], y - o[1])));
  return {
    kind,
    pixels,
    dpr,
    size: [width, height],
    origin: o,
    reach: kind === 'ripple' ? far + 2.4 * 150 : far,
    band: kind === 'sweep' ? Math.min(460, Math.max(220, 0.32 * far)) : 0,
    darkness: Math.min(1, Math.max(0, darkness)),
    tint: TINT,
    glow: GLOW,
    frozen: maskRects(frozen, height),
  };
}

/**
 * Viewport rects (CSS px from the top left) as the shader's mask slots: (min.x, min.y, max.x,
 * max.y) from the bottom left of a frame `frameHeight` CSS px tall. Beyond `MASK_SLOTS` rects
 * are dropped; unused slots are parked.
 */
export function maskRects(rects: readonly DOMRectReadOnly[], frameHeight: number): Float32Array {
  const slots = new Float32Array(MASK_SLOTS * 4).fill(PARKED);
  rects.slice(0, MASK_SLOTS).forEach((rect, index) => {
    if (!shows(rect)) return;
    slots.set(
      [rect.left, frameHeight - rect.bottom, rect.right, frameHeight - rect.top],
      index * 4,
    );
  });
  return slots;
}

/**
 * Atd's surfaces as the capture may show them: each rect as the request saw it joined with the
 * same surface (same index) as it is once the frame arrived, so one that moved or changed size
 * while Chrome captured is covered either way. An empty rect (a surface not shown) joins nothing.
 */
export function unionRects(
  before: readonly DOMRectReadOnly[],
  after: readonly DOMRectReadOnly[],
): DOMRectReadOnly[] {
  const count = Math.max(before.length, after.length);
  const result: DOMRectReadOnly[] = [];
  for (let index = 0; index < count; index++) {
    const a = shown(before[index]);
    const b = shown(after[index]);
    if (a === undefined || b === undefined) {
      const only = a ?? b;
      if (only !== undefined) result.push(only);
      continue;
    }
    const left = Math.min(a.left, b.left);
    const top = Math.min(a.top, b.top);
    result.push(
      new DOMRect(left, top, Math.max(a.right, b.right) - left, Math.max(a.bottom, b.bottom) - top),
    );
  }
  return result;
}

function shows(rect: DOMRectReadOnly): boolean {
  return rect.width > 0 && rect.height > 0;
}

function shown(rect: DOMRectReadOnly | undefined): DOMRectReadOnly | undefined {
  return rect !== undefined && shows(rect) ? rect : undefined;
}
