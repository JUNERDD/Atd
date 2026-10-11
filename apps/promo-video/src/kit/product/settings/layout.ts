/**
 * Where the settings window and its content column sit on the Mac's display, in points, shared by
 * the scenes that show the window so a cut between them keeps it in place.
 */
import type { Rect } from '../../world/points.ts';

/** The sidebar card's width (`--settings-sidebar-width`); the card is inset 8 pt. */
export const SETTINGS_SIDEBAR_WIDTH = 227;

/** The window: wide enough for the run settings' three fields to share one row. */
export const SETTINGS_BOX: Rect = { x: 236, y: 92, width: 1040, height: 640 };

/** The content's side padding (`.settings-content-scroll` in the sidebar layout). */
const PAD_X = 40;
/** The unified title bar the content header shares, and the 8 pt the content starts below it. */
const HEADER = 52;
const PAD_TOP = 8;

/** The content column of a window at `box`: its page starts at `y`, between its side paddings. */
export function settingsColumn(box: Rect = SETTINGS_BOX): Rect {
  const x = box.x + SETTINGS_SIDEBAR_WIDTH + 8 + PAD_X;
  const y = box.y + HEADER + PAD_TOP;
  return { x, y, width: box.x + box.width - PAD_X - x, height: box.y + box.height - y };
}
