/**
 * The Anything section's staging, in its own seconds (CHOREO.anything) and the Mac's points: where
 * the panel, the habit tracker's window and its pin sit, where the pointer clicks, and how the
 * camera frames each moment. The beats themselves come from the timeline; this file only places
 * things around them.
 */
import { springs } from '../../motion/spring.ts';
import type { CursorKey } from '../../kit/world/cursor.ts';
import { REST_SHOT, shotOnDisplay, type Shot } from '../../kit/world/camera.ts';
import { dock, type Rect } from '../../kit/world/points.ts';
import { CHAPTER_TITLE, CHOREO } from '../../timeline.ts';

export const WORK = CHOREO.anything.work;
export const APP = CHOREO.anything.app;
export const TOOLS = CHOREO.anything.tools;

/** When the camera flies through the chapter word into the panel. */
export const FLY = CHAPTER_TITLE.out;

/** The section's length: it ends on a hard cut into Anytime. */
export const END = 18;

/** The Atd panel, docked bottom-right as the app docks it. */
export const PANEL: Rect = dock({ width: 500, height: 680 }, 'bottom-right');

/** The habit tracker's window once it has sprung out of the panel. */
export const WINDOW: Rect = { x: 360, y: 196, width: 440, height: 264 };

/** Where the app lands as a small pin on the wallpaper (170 × 170 pt). */
export const PIN: Rect = { x: 72, y: 70, width: 170, height: 170 };

/** The app card in the panel's transcript, where the window springs from and the drag begins. */
export const CARD = { x: 1150, y: 636 };

/** The Open button on that card. */
const OPEN = { x: 1070, y: 674 };
/** Today's column (Thursday) in the window's grid, and its first habit row. */
const TODAY_X = WINDOW.x + 267;
const ROW_Y = WINDOW.y + 169;
const ROW_STEP = 32;

/** "Allow once" on the approval card. */
const ALLOW = { x: 1122, y: 631 };

/** The subagents finish, one after the other, while the answer is being written. */
export const SUBAGENTS_DONE = [6.45, 6.7];

/** The popovers close: the subagents view gives way to the tool cards, the approval to the run. */
export const SUBAGENTS_CLOSE = 4.6;
export const APPROVAL_CLOSE = WORK.allow + 0.14;

/** The pointer, hidden while the user types (as macOS hides it), out for each click and drag. */
export const CURSOR: CursorKey[] = [
  { at: 5, x: 1380, y: 880 },
  { at: WORK.allow, x: ALLOW.x, y: ALLOW.y, press: true, travel: 0.62 },
  { at: WORK.allow + 0.7, x: 1400, y: 560 },
  { at: APP.open - 0.9, x: 1250, y: 860 },
  { at: APP.open - 0.05, x: OPEN.x, y: OPEN.y, press: true, travel: 0.55 },
  ...APP.use.map((at, row) => ({
    at,
    x: TODAY_X,
    y: ROW_Y + row * ROW_STEP,
    press: true as const,
    travel: row === 0 ? 0.45 : 0.3,
  })),
  { at: APP.pin, x: CARD.x, y: CARD.y, press: 'down', travel: 0.36 },
  {
    at: APP.pinned,
    x: PIN.x + PIN.width / 2,
    y: PIN.y + PIN.height / 2,
    press: 'up',
    travel: 0.72,
  },
  { at: APP.pinned + 0.5, x: 330, y: 330 },
];

/** How visible the pointer is: out for the approval, then for the app, hidden as Tools begins. */
export function cursorOpacity(t: number): number {
  const fade = (from: number, to: number) => Math.min(1, Math.max(0, (t - from) / (to - from)));
  return (
    fade(5.35, 5.6) * (1 - fade(7.1, 7.35)) +
    fade(APP.open - 0.75, APP.open - 0.55) * (1 - fade(TOOLS.start - 0.1, TOOLS.start + 0.15))
  );
}

/**
 * A slow drift on top of the shots, so a held frame still breathes like a handheld camera on a
 * slider: frame px, a few at most.
 */
export function drift(t: number): { x: number; y: number } {
  return { x: 5 * Math.sin(t * 0.61 + 0.4), y: 3.5 * Math.sin(t * 0.47 + 1.9) };
}

/** The panel framed close: the composer, the popover over it, and the newest transcript. */
const COMPOSER = { x: 1092, y: 614 };

/**
 * The camera. It flies in through the chapter word to a macro of the panel (its interface at
 * about 2× on screen), drifts up with the transcript, pushes toward the approval, pulls back for
 * the answer, closes in again for the second request, pulls back to the desktop when the app
 * opens, then pushes into the panel, defocused, behind the cards the agent makes.
 */
export const SHOTS: Shot[] = [
  shotOnDisplay(0, { x: 1168, y: 700 }, 1.55, { blur: 16 }),
  shotOnDisplay(FLY, { x: 1168, y: 742 }, 2.25, { spring: { response: 1, damping: 0.94 } }),
  shotOnDisplay(WORK.send - 0.2, COMPOSER, 1.8),
  shotOnDisplay(WORK.plan + 0.3, { x: 1092, y: 590 }, 1.8),
  shotOnDisplay(WORK.tools[0], { x: 1092, y: 556 }, 1.76),
  shotOnDisplay(WORK.approval - 0.15, { x: 1134, y: 628 }, 2),
  shotOnDisplay(WORK.allow + 0.1, { x: 1000, y: 494 }, 1.22, {
    spring: { response: 0.95, damping: 1 },
  }),
  shotOnDisplay(APP.start - 0.4, COMPOSER, 1.8),
  shotOnDisplay(APP.build, { x: 1092, y: 600 }, 1.85),
  { ...REST_SHOT, at: APP.open - 0.05, spring: { response: 0.9, damping: 0.9 } },
  shotOnDisplay(APP.use[2], { x: 740, y: 410 }, 1.05),
  shotOnDisplay(TOOLS.start - 0.1, { x: 1150, y: 470 }, 1.45, {
    blur: 12,
    spring: springs.window,
  }),
  shotOnDisplay(TOOLS.pullOut, { x: 1150, y: 470 }, 1.15, { blur: 22, contain: false }),
];

/** The stage shakes a little as each card lands: the frame's vertical offset, in px. */
export function toolsShake(t: number): number {
  return TOOLS.cards.reduce((sum, landed) => {
    const u = t - landed;
    return u <= 0 ? sum : sum + Math.exp(-u * 14) * Math.sin(u * 70) * 7;
  }, 0);
}
