/**
 * The section's choreography as data: where the pointer goes and when it presses, and where the
 * camera looks, all on `CHOREO.anywhere`'s beats (section-local seconds). The selection's end and
 * the toolbar's Translate button depend on measured text, so the plan is built per language.
 */
import type { Lang } from '../../copy.ts';
import { springs } from '../../motion/spring.ts';
import { strings } from '../../kit/product/strings.ts';
import { shotOnDisplay, type Shot } from '../../kit/world/camera.ts';
import type { CursorKey } from '../../kit/world/cursor.ts';
import { finderItemCenter } from '../../kit/world/finder.ts';
import type { Point, Rect } from '../../kit/world/points.ts';
import { CHOREO } from '../../timeline.ts';
import type { AnywhereContent } from './content.ts';
import {
  CARD,
  DASH_PARTS,
  DONE,
  FINDER,
  MINI_CARD,
  onDisplay,
  SELECTION_ORIGIN,
  SPOTLIGHT,
  STEPS,
  TEXT,
} from './layout.ts';
import { textWidth } from './measure.ts';
import { selectionEnd } from './selection.ts';

export const A = CHOREO.anywhere;

/** When the dashboard opens and the camera whips to it, as the translation finishes. */
export const DASH_OPEN = A.screenshot.start - 0.15;
/** The spotlight is dragged out over this long from its beat. */
export const SPOT_DRAG = 0.24;

export interface Plan {
  /** The selection toolbar's top-left (it is centered under the selection's end). */
  capsule: Point;
  translate: Point;
  cursor: CursorKey[];
  camera: Shot[];
}

/**
 * The toolbar's width and the middle of its first command, from its anatomy: 4 pt padding, the
 * 16 pt grip, Ask Atd (14 pt glyph, 6 pt gap, label, 10 pt in), the commands (label, 10 pt in) and
 * the 28 pt More, 2 pt apart; labels are 13 pt medium.
 */
function capsuleMetrics(lang: Lang, commands: readonly string[]) {
  const label = (text: string) => textWidth(text, 13, 500);
  const ask = 30 + label(strings[lang].selection.ask);
  const buttons = commands.map((name) => 20 + label(name));
  const width = 4 + 16 + 2 + ask + buttons.reduce((sum, w) => sum + w + 2, 0) + 2 + 28 + 4;
  const first = 4 + 16 + 2 + ask + 2 + (buttons[0] ?? 0) / 2;
  return { width, first };
}

const center = (rect: Rect): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

export function planFor(lang: Lang, c: AnywhereContent): Plan {
  const S = A.selection;
  const C = A.screenshot;
  const M = A.mini;
  const U = A.summon;
  const end = selectionEnd(c.article.selected);
  const metrics = capsuleMetrics(lang, c.commands);
  const capsule = { x: end.x - metrics.width / 2, y: end.y + TEXT.line / 2 + 8 };
  const translate = { x: capsule.x + metrics.first, y: capsule.y + 18 };
  const kpi = center(onDisplay(DASH_PARTS.kpi(0)));
  const exportButton = center(onDisplay(DASH_PARTS.export));
  const plot = { x: CARD.x + 330, y: CARD.y + 170 };
  const spot = { x: CARD.x + SPOTLIGHT.x, y: CARD.y + SPOTLIGHT.y };
  const step = (index: number) => ({
    x: CARD.x + (STEPS[index]?.x ?? 0),
    y: CARD.y + (STEPS[index]?.y ?? 0),
  });
  const pdf = finderItemCenter(FINDER, 0);

  const cursor: CursorKey[] = [
    { at: 0, x: 700, y: 700 },
    { at: S.start, x: 700, y: 700 },
    // The drag-select: down before the first character, up past the last.
    { at: S.drag[0], x: SELECTION_ORIGIN.x - 2, y: SELECTION_ORIGIN.y + 13, press: 'down' },
    { at: S.drag[1], x: end.x + 3, y: end.y, press: 'up', travel: S.drag[1] - S.drag[0] },
    { at: S.click - 0.22, x: translate.x, y: translate.y },
    { at: S.click, x: translate.x, y: translate.y, press: true },
    { at: S.click + 0.8, x: translate.x + 70, y: translate.y + 170 },
    // The capture: the pointer finds elements, a scroll grows the box, a click selects it.
    { at: C.freeze, x: 352, y: 150 },
    { at: C.hover[0], x: kpi.x - 20, y: kpi.y + 6 },
    { at: C.hover[1], x: exportButton.x + 6, y: exportButton.y + 2 },
    { at: C.hover[2], x: plot.x, y: plot.y },
    { at: C.select, x: plot.x, y: plot.y, press: true },
    { at: C.spotlight, x: spot.x, y: spot.y, press: 'down' },
    {
      at: C.spotlight + SPOT_DRAG,
      x: spot.x + SPOTLIGHT.width,
      y: spot.y + SPOTLIGHT.height,
      press: 'up',
      travel: SPOT_DRAG,
    },
    { at: C.steps[0], ...step(0), press: true },
    { at: C.steps[1], ...step(1), press: true },
    { at: C.done, x: DONE.x, y: DONE.y, press: true },
    // The mini panel: a PDF out of Finder, toward the edge, into the drop card.
    { at: M.pickup, x: pdf.x, y: pdf.y, press: 'down' },
    { at: M.magnet, x: MINI_CARD.x - 150, y: MINI_CARD.y - 24 },
    { at: M.drop, x: MINI_CARD.x + 44, y: MINI_CARD.y + 30, press: 'up', travel: 0.55 },
    { at: M.settle + 0.55, x: 880, y: 640 },
  ];

  const camera: Shot[] = [
    shotOnDisplay(0, { x: 600, y: 470 }, 1.1, { blur: 10 }),
    // Through the word, onto the desktop: a push in on the paragraph and, below it, the toolbar.
    shotOnDisplay(S.start, { x: 540, y: 530 }, 1.7),
    // Out again, enough to take in the panel as it rises.
    shotOnDisplay(S.click + 0.05, { x: 900, y: 500 }, 1.15),
    // Then in on the translation as it streams.
    shotOnDisplay(S.stream[0] - 0.1, { x: 1246, y: 690 }, 1.7, { spring: springs.smooth }),
    // A whip to the dashboard as it opens; in on the chart card as the box grows to it.
    shotOnDisplay(DASH_OPEN, { x: 560, y: 420 }, 1.2, { spring: springs.window }),
    shotOnDisplay(C.grow - 0.1, { x: CARD.x + CARD.width / 2, y: 520 }, 1.55),
    // Out to the panel as the capture flies into its composer.
    shotOnDisplay(C.done - 0.1, { x: 900, y: 590 }, 1.28, { spring: springs.window }),
    // A whip to Finder and the screen's edge, in on the drop card, then back to the desktop.
    shotOnDisplay(M.start, { x: 930, y: 420 }, 1.3, { spring: springs.snappy }),
    shotOnDisplay(M.drop - 0.5, { x: 1200, y: 450 }, 1.6),
    shotOnDisplay(U.start - 0.45, { x: 756, y: 425 }, 1),
    // The dive: into the panel until it fills the frame, on the header and its welcome.
    shotOnDisplay(U.dive, { x: 1246, y: 300 }, 3.08, { spring: springs.smooth }),
  ];

  return { capsule, translate, cursor, camera };
}
