/**
 * Where the yours section's surfaces sit and how the camera frames them. Surfaces are laid out in
 * the Mac's points on a 1512 × 982 pt display (no wallpaper: they float on the dot field); the
 * camera frames a point of it at a zoom so that point lands on the shot's focus, right of the
 * statement column. Pure apart from the camera math it shares with the world kit.
 */
import type { CameraState, Shot } from '../../../kit/world/camera.ts';
import { FRAME_SCALE, type Point, type Rect } from '../../../kit/world/points.ts';
import { settingsColumn } from '../../../kit/product/settings/layout.ts';
import { COMMAND_ROW_PITCH } from '../../../kit/product/settings/CommandRow.tsx';
import type { Spring } from '../../../motion/spring.ts';

/** Where a shot's subject lands in the frame, in px: right of the statement column. */
export const FOCUS: Point = { x: 1310, y: 560 };

/** The cut's settle: each vignette opens a touch closer and eases back, quick and damped. */
export const SETTLE: Spring = { response: 0.62, damping: 0.9 };
/** The camera's slow push through a held moment. */
export const DRIFT: Spring = { response: 2.4, damping: 1 };
/** A reframe within a vignette (onto the dialog, down the menu). */
export const REFRAME: Spring = { response: 0.7, damping: 0.92 };

/** A shot that puts display point `point` on `focus` at `zoom`, moving from `at` on `spring`. */
export function frameOn(
  at: number,
  point: Point,
  zoom: number,
  spring?: Spring,
  focus: Point = FOCUS,
): Shot {
  return {
    at,
    x: point.x * FRAME_SCALE - (focus.x - 960) / zoom,
    y: point.y * FRAME_SCALE - (focus.y - 540) / zoom,
    zoom,
    ...(spring ? { spring } : {}),
  };
}

/** Where display point `point` is in the frame, in px, under camera `cam`. */
export function frameOf(point: Point, cam: CameraState): Point {
  return {
    x: (point.x * FRAME_SCALE - cam.x) * cam.zoom + 960,
    y: (point.y * FRAME_SCALE - cam.y) * cam.zoom + 540,
  };
}

/** Bar 13: the provider form's window, its footer just below the note, and the primary button. */
export const PLAN_BOX: Rect = { x: 300, y: 220, width: 820, height: 310 };
const planColumn = settingsColumn(PLAN_BOX);
/** The footer's buttons: 32 pt tall, 20 pt above the window's bottom edge, flush right. */
export const PLAN_FOOTER: Rect = {
  x: planColumn.x,
  y: PLAN_BOX.y + PLAN_BOX.height - 20 - 32,
  width: planColumn.width,
  height: 32,
};
/** Near the middle of "Continue with ChatGPT" in either language. */
export const PLAN_BUTTON: Point = {
  x: PLAN_FOOTER.x + PLAN_FOOTER.width - 92,
  y: PLAN_FOOTER.y + 16,
};
/** The dialog centres in the window. */
export const PLAN_DIALOG: Point = {
  x: PLAN_BOX.x + PLAN_BOX.width / 2,
  y: PLAN_BOX.y + PLAN_BOX.height / 2,
};

/** Bar 14: the command editor, wide enough for the run settings' three fields on one row. */
export const EFFORT_BOX: Rect = { x: 150, y: 110, width: 1040, height: 720 };
const effortColumn = settingsColumn(EFFORT_BOX);
/**
 * The page from the column's top, scrolled to Run settings: 16 pt, the group's hairline (1) and
 * its 24 pt of padding, the heading (title 24 + 2 + description 20), 16 pt: the field labels.
 */
export const EFFORT_FIELDS_TOP = 16 + 1 + 24 + 46 + 16;
const FIELD_GAP = 16;
/** Each field column's width. */
export const EFFORT_FIELD_WIDTH = (effortColumn.width - 2 * FIELD_GAP) / 3;
/** The Effort trigger (the middle column), in points. */
export const EFFORT_TRIGGER: Rect = {
  x: effortColumn.x + EFFORT_FIELD_WIDTH + FIELD_GAP,
  y: effortColumn.y + EFFORT_FIELDS_TOP + 20 + 8,
  width: EFFORT_FIELD_WIDTH,
  height: 32,
};

/** Bar 15: the task panel (500 × 680 pt). */
export const LIGHT_PANEL: Point = { x: 640, y: 140 };
/** The transcript's end, just above the composer: where the message and the answer land. */
export const LIGHT_FOCUS: Point = { x: LIGHT_PANEL.x + 250, y: LIGHT_PANEL.y + 430 };
/** The Send button, at the composer field's trailing end. */
export const LIGHT_SEND: Point = { x: LIGHT_PANEL.x + 466, y: LIGHT_PANEL.y + 610 };

/** Bar 16: the Commands overview, narrow enough that a row fits the frame whole. */
export const ORDER_BOX: Rect = { x: 260, y: 96, width: 880, height: 720 };
const orderColumn = settingsColumn(ORDER_BOX);
/** The description (20), 16, the toolbar (32), 16, the reorder hint (16), 16: then the rows. */
export const ORDER_ROWS_TOP = 20 + 16 + 32 + 16 + 16 + 16;
/** The row being moved, before the move, and the rows it passes. */
export const ORDER_FROM = 3;
/** A row's top-left in points, by its slot. */
export function orderRow(slot: number): Point {
  return { x: orderColumn.x, y: orderColumn.y + ORDER_ROWS_TOP + slot * COMMAND_ROW_PITCH };
}
/** Where the pointer presses the dragged row: on its name, clear of its controls. */
export const ORDER_GRIP: Point = { x: orderColumn.x + 210, y: orderRow(ORDER_FROM).y + 36 };
/** The middle of the rows, for framing. */
export const ORDER_FOCUS: Point = {
  x: orderColumn.x + orderColumn.width / 2,
  y: orderRow(2).y + 34,
};
