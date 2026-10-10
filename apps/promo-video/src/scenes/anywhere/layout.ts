/**
 * Where everything sits on the Mac's display in this section, in points. The windows' content is
 * laid out from these same numbers (as custom properties), so the cursor, the selection, the
 * element boxes and the camera all aim at what is actually drawn.
 */
import { dock, type Point, type Rect } from '../../kit/world/points.ts';

/** The title bar every MacWindow has. */
export const BAR = 52;

/** The reading app's window, and its article column inside the window's body. */
export const ARTICLE: Rect = { x: 150, y: 72, width: 790, height: 690 };
export const COLUMN = { left: 76, width: 640 } as const;
/** The article's type: body lines are 16 pt on a 26 pt line. */
export const TEXT = { size: 16, line: 26, weight: 400 } as const;
/** Each block's top, in the window body's points. */
export const BLOCKS = {
  kicker: 34,
  title: 56,
  dek: 104,
  byline: 168,
  rule: 200,
  before: 220,
  selected: 314,
  /** Paragraphs are 16 pt apart. */
  gap: 16,
} as const;

/** The selected paragraph's first line, on the display. */
export const SELECTION_ORIGIN: Point = {
  x: ARTICLE.x + COLUMN.left,
  y: ARTICLE.y + BAR + BLOCKS.selected,
};

/** The Atd panel, docked to the visible display's bottom-right. */
export const PANEL: Rect = dock({ width: 500, height: 680 }, 'bottom-right');

/** The dashboard window: an inset sidebar, then its body. */
export const DASH: Rect = { x: 96, y: 58, width: 880, height: 702 };
export const DASH_SIDEBAR = 180;
/** The dashboard body's origin on the display (right of the sidebar and its 8 pt inset). */
export const DASH_BODY: Point = { x: DASH.x + DASH_SIDEBAR + 8, y: DASH.y + BAR };
const BODY_WIDTH = DASH.width - DASH_SIDEBAR - 8;

/** The dashboard's parts, in its body's points. */
export const DASH_PARTS = {
  title: { x: 28, y: 20, width: 104, height: 30 },
  export: { x: BODY_WIDTH - 28 - 96, y: 22, width: 96, height: 30 },
  kpi: (index: number): Rect => {
    const width = (BODY_WIDTH - 56 - 28) / 3;
    return { x: 28 + index * (width + 14), y: 82, width, height: 96 };
  },
  chart: { x: 28, y: 194, width: BODY_WIDTH - 56, height: 300 },
  stations: { x: 28, y: 510, width: BODY_WIDTH - 56, height: 128 },
} as const;

/** The chart card's plot, in the card's points: six bars over a label row. */
export const PLOT = { x: 20, y: 72, width: DASH_PARTS.chart.width - 40, height: 204, bars: 180 };
/** Riders per hour, in thousands: the peak at 1 AM, the low at 4 AM. */
export const RIDERS = [4.1, 5.24, 3.6, 2.0, 1.3, 1.9] as const;
const BAR_WIDTH = 46;

/** A bar's box in the card's points. */
export function barBox(index: number): Rect {
  const slot = PLOT.width / RIDERS.length;
  const height = ((RIDERS[index] ?? 0) / 5.24) * (PLOT.bars - 12);
  return {
    x: PLOT.x + index * slot + (slot - BAR_WIDTH) / 2,
    y: PLOT.y + PLOT.bars - height,
    width: BAR_WIDTH,
    height,
  };
}

/** A box in the dashboard body's points, on the display. */
export function onDisplay(rect: Rect, origin: Point = DASH_BODY): Rect {
  return { ...rect, x: origin.x + rect.x, y: origin.y + rect.y };
}

/** The chart card, the capture's selection, on the display. */
export const CARD: Rect = onDisplay(DASH_PARTS.chart);

/** The spotlight drawn over the 1 AM peak, and the two steps, in the card's points. */
const PEAK = barBox(1);
const LOW = barBox(4);
export const SPOTLIGHT: Rect = {
  x: PEAK.x - 14,
  y: PEAK.y - 34,
  width: PEAK.width + 28,
  height: PLOT.y + PLOT.height - (PEAK.y - 34),
};
export const STEPS: readonly Point[] = [
  { x: PEAK.x + PEAK.width / 2, y: PEAK.y - 18 },
  { x: LOW.x + LOW.width / 2, y: LOW.y - 18 },
];

/** The annotation bars hang 10 pt under the selection, right-aligned with it. */
export const BARS_ANCHOR: Point = { x: CARD.x + CARD.width, y: CARD.y + CARD.height + 10 };
/** Done, the last control of the top bar (28 pt circles, 6 pt padding). */
export const DONE: Point = { x: BARS_ANCHOR.x - 20, y: BARS_ANCHOR.y + 20 };

/** Finder, with the PDF the cursor drags out of it. */
export const FINDER: Rect = { x: 290, y: 176, width: 700, height: 400 };

/**
 * The mini panel's 200 × 140 box: its right edge is the display's edge, its middle the pill's
 * resting place (the app's default, 40% down the work area).
 */
export const MINI_MIDDLE = 30 + 0.4 * (982 - 30);
export const MINI: Rect = { x: 1512 - 200, y: MINI_MIDDLE - 70, width: 200, height: 140 };
/** The drop card's middle (184 pt wide, 8 pt from the edge). */
export const MINI_CARD: Point = { x: 1512 - 8 - 92, y: MINI_MIDDLE };
