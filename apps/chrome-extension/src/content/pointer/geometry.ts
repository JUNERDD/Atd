/**
 * Where the live pointer's pieces go, in viewport CSS px (y down). Mirrors
 * `apps/macos/Sources/AICore/Computer/Pointer/PointerGeometry.swift` and the geometry constants
 * of `apps/macos/Sources/AIShell/Computer/Pointer/PointerStyle.swift`; change both together.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

/** Targets up to this size count as controls: the arrow points at their centre. */
const CONTROL_SIZE = { width: 160, height: 72 };
/** How far into a large target (fields, text areas, lists) the arrow points. */
const LEADING_INSET = { width: 24, height: 20 };

/** `PointerStyle.arrowSize`: the arrow's body below and right of its tip. */
export const ARROW_SIZE = { width: 13, height: 20 };
/** `PointerStyle.ringOutset`: room between the target and its ring. */
export const RING_OUTSET = 3;

/** The point the arrow's tip touches: a control's centre, a large target's leading edge. */
export function anchorFor(target: Rect): Point {
  if (target.width <= CONTROL_SIZE.width && target.height <= CONTROL_SIZE.height) {
    return { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  }
  const x = target.x + Math.min(target.width / 2, LEADING_INSET.width);
  const y =
    target.height <= CONTROL_SIZE.height
      ? target.y + target.height / 2
      : target.y + Math.min(target.height / 2, LEADING_INSET.height);
  return { x, y };
}

/**
 * The label's top-left for an arrow whose tip is at `anchor`: beside the arrow's tail, moved to
 * the arrow's left or above it when it would leave the viewport, then kept on it.
 */
export function labelOrigin(
  anchor: Point,
  label: { width: number; height: number },
  viewport: { width: number; height: number },
): Point {
  let x = anchor.x + ARROW_SIZE.width + 2;
  let y = anchor.y + ARROW_SIZE.height * 0.8;
  if (x + label.width > viewport.width) x = anchor.x - 4 - label.width;
  if (y + label.height > viewport.height) y = anchor.y - 6 - label.height;
  x = Math.min(Math.max(x, 0), Math.max(0, viewport.width - label.width));
  y = Math.min(Math.max(y, 0), Math.max(0, viewport.height - label.height));
  return { x, y };
}

/** The input bar along a field's bottom edge (`PointerMark.layOut`). */
export function fieldBar(target: Rect): Rect {
  return {
    x: target.x + 4,
    y: target.y + target.height - 5,
    width: Math.max(target.width - 8, 2),
    height: 3,
  };
}

/**
 * `PointerStyle.scrollBar`: a short bar on the edge the scroll goes toward. It marks the
 * direction, not progress; a target smaller than 12 px gets none.
 */
export function scrollBar(direction: ScrollDirection, target: Rect): Rect | null {
  if (target.width < 12 || target.height < 12) return null;
  const horizontal = Math.min(28, target.width - 8);
  const vertical = Math.min(28, target.height - 8);
  const midX = target.x + target.width / 2;
  const midY = target.y + target.height / 2;
  switch (direction) {
    case 'up':
      return { x: midX - horizontal / 2, y: target.y + 2, width: horizontal, height: 3 };
    case 'down':
      return {
        x: midX - horizontal / 2,
        y: target.y + target.height - 5,
        width: horizontal,
        height: 3,
      };
    case 'left':
      return { x: target.x + 2, y: midY - vertical / 2, width: 3, height: vertical };
    case 'right':
      return { x: target.x + target.width - 5, y: midY - vertical / 2, width: 3, height: vertical };
  }
}

/** The target cut to the viewport (the shell cuts it to its display); null when nothing is left. */
export function cutToViewport(target: Rect, width: number, height: number): Rect | null {
  const x = Math.max(target.x, 0);
  const y = Math.max(target.y, 0);
  const right = Math.min(target.x + target.width, width);
  const bottom = Math.min(target.y + target.height, height);
  if (!(right > x && bottom > y)) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** `PointerFramePolicy.glideLimit`: longer moves jump instead of gliding (CSS px here). */
export const GLIDE_LIMIT = 480;

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
