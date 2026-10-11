/**
 * Where the writeback section's things sit. Surfaces are in the display's points (the Stage's
 * 1512 × 982 pt space); the words column is in frame px. Every product shot frames its subject in
 * the right three fifths of the frame, so the narrative words own the left column over bare
 * wallpaper: `frameAt` computes the camera point that puts a display point at a frame position.
 */
import type { Shot } from '../../../kit/world/camera.ts';
import { FRAME_SCALE, VISIBLE, type Point, type Rect } from '../../../kit/world/points.ts';
import { springs, type Spring } from '../../../motion/spring.ts';
import { HEIGHT, WIDTH } from '../../timeline.ts';

/** The note's window, right of centre so the left of every shot stays wallpaper. */
export const NOTE: Rect = { x: 640, y: 230, width: 520, height: 300 };
/** The note's body: the title, the meta line, the paragraph and the next paragraph. */
export const NOTE_TEXT = {
  left: NOTE.x + 30,
  width: NOTE.width - 60,
  title: NOTE.y + 52 + 18,
  meta: NOTE.y + 52 + 54,
  /** The paragraph's first line's top, its type and its line pitch. */
  top: NOTE.y + 52 + 92,
  size: 17,
  weight: 400,
  line: 27,
} as const;

/** The paragraph's middle on the display, where the shots aim. */
export const PARAGRAPH: Point = {
  x: NOTE_TEXT.left + NOTE_TEXT.width / 2,
  y: NOTE_TEXT.top + NOTE_TEXT.line * 1.5,
};

/**
 * The command island's home: the middle of its bottom edge 24 pt above the visible display's
 * bottom (the film's display crops the bottom; surfaces dock to what a shot shows, `points.ts`).
 */
export const ISLAND_ANCHOR: Point = { x: 756, y: VISIBLE.height - 24 };
/** The island's capsule middle, for its pulses and the camera. */
export const ISLAND_MIDDLE: Point = { x: ISLAND_ANCHOR.x, y: ISLAND_ANCHOR.y - 18 };

/** The selection toolbar's bottom edge sits 8 pt above the selection (`SelectionToolbarGeometry`). */
export const TOOLBAR_GAP = 8;
export const TOOLBAR_HEIGHT = 36;

/** One window for the destinations montage: a single paragraph, set larger for the macro shots. */
export const DEMO: Rect = { x: 640, y: 330, width: 520, height: 230 };
export const DEMO_TEXT = {
  left: DEMO.x + 40,
  width: DEMO.width - 80,
  lead: DEMO.y + 52 + 26,
  top: DEMO.y + 52 + 26 + 40,
  size: 20,
  weight: 400,
  line: 30,
} as const;

/** The montage's aim: the demo paragraph's first line, a little in from its start. */
export const DEMO_AIM: Point = { x: DEMO_TEXT.left + DEMO_TEXT.width / 2, y: DEMO_TEXT.top + 22 };

/** The narrative column, in frame px: the words' left edge and width. */
export const COLUMN = { left: 132, width: 600 } as const;

/**
 * The camera point (world frame px, as `Shot` wants) that puts display point `point` at frame
 * position `at` under `zoom`.
 */
export function frameAt(point: Point, zoom: number, at: Point): { x: number; y: number } {
  return {
    x: point.x * FRAME_SCALE - (at.x - WIDTH / 2) / zoom,
    y: point.y * FRAME_SCALE - (at.y - HEIGHT / 2) / zoom,
  };
}

/** Where the right three fifths' subject sits in the frame. */
const SUBJECT_X = 1320;

/** A shot that frames `point` at (`SUBJECT_X`, `y`) at `zoom`, from `at` on `spring`. */
function shot(at: number, point: Point, zoom: number, y: number, spring: Spring): Shot {
  return { at, zoom, spring, ...frameAt(point, zoom, { x: SUBJECT_X, y }) };
}

/** The return up is quicker than the dive: the answer is racing back to the note. */
const RETURN: Spring = { response: 0.62, damping: 0.92 };
const DIVE: Spring = { response: 0.8, damping: 0.9 };

/**
 * The round trip's one camera: from rest it settles on the paragraph, dives with the click to the
 * island, races back up as the answer types, and pulls back to hold note and island together.
 */
export function roundTripShots(beat: {
  push: number;
  cameraDown: number;
  cameraUp: number;
  cameraWide: number;
}): Shot[] {
  return [
    { at: 0, x: WIDTH / 2, y: HEIGHT / 2, zoom: 1 },
    shot(beat.push, PARAGRAPH, 1.7, 520, springs.camera),
    shot(beat.cameraDown, ISLAND_MIDDLE, 2, 690, DIVE),
    shot(beat.cameraUp, PARAGRAPH, 1.72, 560, RETURN),
    shot(beat.cameraWide, { x: PARAGRAPH.x, y: 545 }, 1.25, 540, springs.camera),
  ];
}

/** Each montage demo's framing: varied zooms so the hard cuts read, the fallback wide enough for its card. */
export const DEMO_SHOTS = {
  replaceSelection: { zoom: 1.62, y: 470 },
  insertAfterSelection: { zoom: 1.52, y: 500 },
  insertAtCursor: { zoom: 1.68, y: 450 },
  unwritten: { zoom: 1.45, y: 328 },
} as const;

/** A montage demo's camera: framed at its hit, drifting in 4% over its half bar. */
export function demoShots(at: number, zoom: number, y: number): Shot[] {
  const drift: Spring = { response: 2.6, damping: 1 };
  return [shot(at, DEMO_AIM, zoom, y, drift), shot(at, DEMO_AIM, zoom * 1.04, y, drift)];
}
