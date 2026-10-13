/**
 * Where the choose section's pieces sit. The frame (px): a left column for the words and the
 * macro keys, and on the right a rounded window onto the Mac (the Stage seen through its own
 * camera). The display (points): a note centred above the command island's home, its heading and
 * two lines, so the island, the toolbar and its menus all fall inside that window.
 */
import type { Lang } from '../../../copy.ts';
import { cameraAt, type CameraState, type Shot } from '../../../kit/world/camera.ts';
import { DISPLAY, FRAME_SCALE, type Point, type Rect } from '../../../kit/world/points.ts';
import { springs, type Spring } from '../../../motion/spring.ts';
import { CHOOSE_BEATS as B } from './beats.ts';
import { insertBox, line2Box } from './note-layout.ts';
import { pointerPlan } from './pointer.ts';

/** The window onto the Mac, in frame px, and its centre. */
export const SCREEN: Rect = { x: 744, y: 96, width: 1080, height: 888 };
export const SCREEN_CENTER: Point = {
  x: SCREEN.x + SCREEN.width / 2,
  y: SCREEN.y + SCREEN.height / 2,
};

/** The left column: the words' block and the keys' slot centre, in frame px. */
export const COLUMN = { x: 112, width: 590 };
export const KEYS_AT: Point = { x: COLUMN.x + COLUMN.width / 2, y: 790 };

/** The display's bottom edge in points: every shot stands on it, so the window reads as the
 * lower part of the Mac's screen with the island 24 pt above its edge. */
const BOTTOM = DISPLAY.height;

/**
 * A shot that puts display x `x` at the window's centre at `zoom` (relative to the full-frame
 * display), its bottom edge on the display's, for the window's own camera.
 */
function aim(at: number, x: number, zoom: number, spring?: Spring): Shot {
  const halfHeight = SCREEN.height / 2 / (zoom * FRAME_SCALE);
  return {
    at,
    x: x * FRAME_SCALE - (SCREEN_CENTER.x - 960) / zoom,
    y: (BOTTOM - halfHeight) * FRAME_SCALE - (SCREEN_CENTER.y - 540) / zoom,
    zoom,
    ...(spring ? { spring } : {}),
  };
}

/** A slower, smoother glide than the default camera, for the small reframes inside the window. */
const GLIDE: Spring = { response: 0.9, damping: 0.96 };

/**
 * The window's camera: the note and the island; a slow push while the hold charges and the card
 * opens; back for the write; wider and still while the toolbar, its menu and the When-done
 * submenu are up (no pan, so nothing smears); then in on the inserted text and the island.
 */
export function screenShots(lang: Lang): Shot[] {
  const plan = pointerPlan(lang);
  const menus = (plan.capsule.x + plan.submenu.x + plan.submenu.width) / 2;
  const line = line2Box(lang);
  const insert = insertBox(lang);
  const insertMid = (line.x + insert.x + insert.width) / 2;
  return [
    aim(0, 756, 1.35),
    aim(B.holdMod, 756, 1.45, GLIDE),
    aim(B.holdRun - 0.3, 756, 1.38, GLIDE),
    aim(B.pointerIn, menus, 1.17, springs.camera),
    aim(B.pickClick + 0.15, 756, 1.36, GLIDE),
    aim(B.whereWrite + 0.15, insertMid, 1.62, springs.camera),
  ];
}

/** The window camera at `t`. */
export function screenCamera(lang: Lang, t: number): CameraState {
  return cameraAt(t, screenShots(lang));
}

/** A display point as it lands in the frame at `t`, through the window's camera. */
export function toFrameAt(lang: Lang, t: number, point: Point): Point {
  const camera = screenCamera(lang, t);
  return {
    x: (point.x * FRAME_SCALE - camera.x) * camera.zoom + 960,
    y: (point.y * FRAME_SCALE - camera.y) * camera.zoom + 540,
  };
}

/** A display rect in the frame at `t`. */
export function toFrameRectAt(lang: Lang, t: number, rect: Rect): Rect {
  const a = toFrameAt(lang, t, rect);
  const b = toFrameAt(lang, t, { x: rect.x + rect.width, y: rect.y + rect.height });
  return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
}
