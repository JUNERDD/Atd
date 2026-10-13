/**
 * Each vignette's camera, as data: it cuts in a touch close and settles back, drifts slowly
 * through the held moment, and reframes when the subject moves (the dialog, the menu, the drag).
 * Shared by the shots and by the scene, which ripples the dot field from where presses land.
 */
import type { Lang } from '../../../copy.ts';
import { selectMenuHeight } from '../../../kit/product/settings/select-layout.ts';
import { effortItems } from '../../../kit/product/settings/settings-strings.ts';
import { cameraAt, type CameraState } from '../../../kit/world/camera.ts';
import { YOURS_BEATS as B } from './beats.ts';
import {
  DRIFT,
  EFFORT_TRIGGER,
  frameOn,
  LIGHT_FOCUS,
  ORDER_FOCUS,
  PLAN_BUTTON,
  PLAN_DIALOG,
  REFRAME,
  SETTLE,
} from './layout.ts';

/** The button sits a little low in the frame, so the reframe onto the dialog rises to meet it. */
const LOW = { x: 1400, y: 620 };
/** The dialog sits right of the statement column, clear of its longest line. */
const DIALOG_FOCUS = { x: 1390, y: 540 };

/** Bar 13: close on "Continue with ChatGPT", then back onto the dialog as it opens. */
export function planCamera(t: number): CameraState {
  return cameraAt(t, [
    frameOn(B.plan.in, PLAN_BUTTON, 2.25, undefined, LOW),
    frameOn(B.plan.in, PLAN_BUTTON, 2.0, SETTLE, LOW),
    frameOn(B.plan.in + 0.3, PLAN_BUTTON, 2.1, DRIFT, LOW),
    frameOn(B.plan.dialog - 0.1, PLAN_DIALOG, 1.42, REFRAME, DIALOG_FOCUS),
  ]);
}

/** The Effort trigger's middle, in points. */
export const EFFORT_TRIGGER_MIDDLE = {
  x: EFFORT_TRIGGER.x + EFFORT_TRIGGER.width / 2,
  y: EFFORT_TRIGGER.y + EFFORT_TRIGGER.height / 2,
};

/** Bar 14: close on the Effort trigger, then down a little to hold the open menu whole. */
export function effortCamera(t: number, lang: Lang): CameraState {
  const menu = selectMenuHeight(effortItems(lang));
  const held = {
    x: EFFORT_TRIGGER_MIDDLE.x,
    y: EFFORT_TRIGGER.y + (EFFORT_TRIGGER.height + 4 + menu) / 2,
  };
  return cameraAt(t, [
    frameOn(B.effort.in, EFFORT_TRIGGER_MIDDLE, 2.3),
    frameOn(B.effort.in, EFFORT_TRIGGER_MIDDLE, 2.08, SETTLE),
    frameOn(B.effort.open - 0.05, held, 1.82, REFRAME),
    frameOn(
      B.effort.pick,
      { x: EFFORT_TRIGGER_MIDDLE.x, y: EFFORT_TRIGGER_MIDDLE.y + 70 },
      2.05,
      REFRAME,
    ),
  ]);
}

/** The panel is narrow and tall: it sits a little right of the usual focus. */
const PANEL_FOCUS = { x: 1390, y: 540 };
/** Bar 16's rows are wide: they sit right of the usual focus too, a little further back. */
const ROWS_FOCUS = { x: 1385, y: 560 };

/** Bar 15: on the transcript's end above the composer, pushing in slowly. */
export function lightCamera(t: number): CameraState {
  return cameraAt(t, [
    frameOn(B.light.in, LIGHT_FOCUS, 1.75, undefined, PANEL_FOCUS),
    frameOn(B.light.in, LIGHT_FOCUS, 1.56, SETTLE, PANEL_FOCUS),
    frameOn(B.light.in + 0.3, LIGHT_FOCUS, 1.66, DRIFT, PANEL_FOCUS),
  ]);
}

/** Bar 16: the rows, easing up a touch with the drag. */
export function orderCamera(t: number): CameraState {
  const raised = { x: ORDER_FOCUS.x, y: ORDER_FOCUS.y - 34 };
  return cameraAt(t, [
    frameOn(B.order.in, ORDER_FOCUS, 1.54, undefined, ROWS_FOCUS),
    frameOn(B.order.in, ORDER_FOCUS, 1.38, SETTLE, ROWS_FOCUS),
    frameOn(B.order.in + 0.3, ORDER_FOCUS, 1.41, DRIFT, ROWS_FOCUS),
    frameOn(B.order.drag, raised, 1.45, REFRAME, ROWS_FOCUS),
  ]);
}
