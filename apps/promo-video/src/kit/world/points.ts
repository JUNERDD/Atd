/**
 * The Mac's coordinate space. Everything inside the Mac is laid out in points on a 1512 × 982 pt
 * display (a 14-inch MacBook Pro's default resolution), and the `Desktop` scales that display once,
 * by FRAME_SCALE, to fill the frame's width.
 *
 * At that scale the display is 1247 px tall, 167 px more than the frame, so the bottom 131.5 pt are
 * cropped: the top stays anchored, because the menu bar is the Mac's signature and nothing in the
 * film lives in a Dock. VISIBLE is the part of the display a full-frame shot shows; dock surfaces to
 * its edges (see `dock`) rather than to the display's, or their bottom will be out of frame.
 */
import { HEIGHT, WIDTH } from '../../timeline.ts';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The display, in points. */
export const DISPLAY = { width: 1512, height: 982 } as const;

/** Frame pixels per point: 1920 / 1512 ≈ 1.27. */
export const FRAME_SCALE = WIDTH / DISPLAY.width;

/** The part of the display a full-frame, unzoomed shot shows, in points (top-anchored). */
export const VISIBLE: Rect = { x: 0, y: 0, width: DISPLAY.width, height: HEIGHT / FRAME_SCALE };

/** The menu bar's height, in points. */
export const MENU_BAR_HEIGHT = 30;

/** A point on the display, in frame pixels (for the camera, captions or overlays). */
export function toFrame(point: Point): Point {
  return { x: point.x * FRAME_SCALE, y: point.y * FRAME_SCALE };
}

/** A box on the display, in frame pixels. */
export function toFrameRect(rect: Rect): Rect {
  return {
    x: rect.x * FRAME_SCALE,
    y: rect.y * FRAME_SCALE,
    width: rect.width * FRAME_SCALE,
    height: rect.height * FRAME_SCALE,
  };
}

/** A frame pixel position, back in display points. */
export function toPoints(point: Point): Point {
  return { x: point.x / FRAME_SCALE, y: point.y / FRAME_SCALE };
}

/** The center of a box. */
export function centerOf(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * A box of `size` docked to a corner of the visible display with `margin` points around it; the
 * top edge sits below the menu bar. The Atd panel is `dock({ width: 500, height: 680 }, 'bottom-right')`.
 */
export function dock(
  size: { width: number; height: number },
  corner: Corner,
  margin = 16,
  area: Rect = VISIBLE,
): Rect {
  const left = corner === 'top-left' || corner === 'bottom-left';
  const top = corner === 'top-left' || corner === 'top-right';
  return {
    x: left ? area.x + margin : area.x + area.width - margin - size.width,
    y: top
      ? Math.max(area.y, MENU_BAR_HEIGHT) + margin
      : area.y + area.height - margin - size.height,
    width: size.width,
    height: size.height,
  };
}
