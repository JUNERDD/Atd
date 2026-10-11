/**
 * The round trip's pointer and what it touches: the drag selection derived from the pointer as a
 * text view derives it (lines above the pointer's line whole, on its line every character whose
 * middle it has passed), the selection toolbar's placement and its buttons' positions, and the
 * pointer's keys. Widths are measured with the film's faces at the size the text is set in.
 */
import type { Lang } from '../../../copy.ts';
import type { CursorKey } from '../../../kit/world/cursor.ts';
import { textWidthAt } from '../../../kit/world/measure.ts';
import type { Point } from '../../../kit/world/points.ts';
import { strings } from '../../../kit/product/strings.ts';
import { graphemes } from '../../../kit/world/text-units.ts';
import { WRITEBACK_BEATS as B } from './beats.ts';
import type { WritebackContent } from './content.ts';
import { NOTE, NOTE_TEXT, PARAGRAPH, TOOLBAR_GAP, TOOLBAR_HEIGHT } from './layout.ts';

/** The advance of the first `count` graphemes of `line` in the paragraph's type, in points. */
function advance(line: string, count: number): number {
  const text = graphemes(line).slice(0, count).join('');
  return textWidthAt(text, NOTE_TEXT.weight, NOTE_TEXT.size);
}

/** How many graphemes of each rough line the pointer at `point` has selected, from the first. */
export function selectionAt(point: Point, lines: readonly string[]): number[] {
  const row = Math.floor((point.y - NOTE_TEXT.top) / NOTE_TEXT.line);
  const dx = point.x - NOTE_TEXT.left;
  return lines.map((line, index) => {
    const count = graphemes(line).length;
    if (index < row) return count;
    if (index > row) return 0;
    let selected = 0;
    for (let char = 1; char <= count; char++) {
      if ((advance(line, char - 1) + advance(line, char)) / 2 > dx) break;
      selected = char;
    }
    return selected;
  });
}

/** Where the drag starts (just before the first character) and ends (just past the last). */
export function dragEnds(lines: readonly string[]): { from: Point; to: Point } {
  const last = lines.length - 1;
  return {
    from: { x: NOTE_TEXT.left - 1, y: NOTE_TEXT.top + NOTE_TEXT.line / 2 },
    to: {
      x: NOTE_TEXT.left + advance(lines[last] ?? '', Infinity) + 6,
      y: NOTE_TEXT.top + last * NOTE_TEXT.line + NOTE_TEXT.line / 2,
    },
  };
}

/** A toolbar label's width, 13 pt medium. */
const label = (text: string) => textWidthAt(text, 500, 13);

/**
 * The toolbar's width and each command button's middle from its left edge (`SelectionToolbarPanel`):
 * 4 pt padding, 2 pt gaps, the 16 pt grip, Ask Atd (10 pt in, 14 pt glyph, 6 pt gap), every
 * command split with its 20 pt chevron, and the 28 pt More.
 */
function toolbarMetrics(lang: Lang, commands: readonly string[]) {
  const ask = 10 + 14 + 6 + label(strings[lang].selection.ask) + 10;
  let x = 4 + 16 + 2 + ask + 2;
  const middles: number[] = [];
  for (const name of commands) {
    const button = 10 + label(name) + 10;
    middles.push(x + button / 2);
    x += button + 20 + 2;
  }
  return { width: x + 28 + 4, middles };
}

/**
 * The toolbar's box on the display: centred over the selection, its bottom edge 8 pt above it,
 * and the clicked command's middle.
 */
export function toolbarPlace(lang: Lang, c: WritebackContent) {
  const metrics = toolbarMetrics(lang, c.commands);
  const bottom = NOTE_TEXT.top - TOOLBAR_GAP;
  const left = PARAGRAPH.x - metrics.width / 2;
  return {
    /** The middle of its bottom edge, where it grows from. */
    anchor: { x: PARAGRAPH.x, y: bottom },
    button: { x: left + (metrics.middles[c.clicked] ?? 0), y: bottom - TOOLBAR_HEIGHT / 2 },
  };
}

/**
 * The pointer's keys: it drifts in over the note, reaches the paragraph's start as ⌥ goes down,
 * drags to its end, rises to Polish writing and clicks it, then moves out of the way while the
 * camera is down at the island.
 */
export function pointerKeys(lang: Lang, c: WritebackContent): CursorKey[] {
  const { from, to } = dragEnds(c.note.rough);
  const { button } = toolbarPlace(lang, c);
  const rest = { x: NOTE.x + NOTE.width - 70, y: NOTE.y + NOTE.height - 60 };
  return [
    { at: 0, ...rest },
    { at: B.windowIn, ...rest },
    { at: B.optionDown, ...from, travel: 0.7 },
    { at: B.dragDown, ...from, press: 'down' },
    { at: B.dragUp, ...to, press: 'up', travel: B.dragUp - B.dragDown },
    { at: B.hover, ...button, travel: 0.5 },
    { at: B.click, ...button, press: true },
    {
      at: B.cameraUp - 0.1,
      x: NOTE.x + NOTE.width + 260,
      y: NOTE.y + NOTE.height + 40,
      travel: 0.6,
    },
  ];
}

/** Whether the pointer is the I-beam (over the text, until the toolbar takes it). */
export function overText(t: number): boolean {
  return t >= B.optionDown - 0.2 && t < B.dragUp + 0.25;
}
