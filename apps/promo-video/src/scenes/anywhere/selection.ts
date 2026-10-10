/**
 * The drag-selection, derived from the pointer as a text view does it: every line above the
 * pointer's line is selected whole, and on its line each character whose middle the pointer has
 * passed.
 */
import type { Point } from '../../kit/world/points.ts';
import { SELECTION_ORIGIN, TEXT } from './layout.ts';
import { textWidth } from './measure.ts';

/** The advance after the first `count` characters of `line`, in points. */
function advance(line: string, count: number): number {
  return textWidth(Array.from(line).slice(0, count).join(''), TEXT.size, TEXT.weight);
}

/** A line's full width, in points. */
export function lineWidth(line: string): number {
  return textWidth(line, TEXT.size, TEXT.weight);
}

/** How many characters of each line the pointer at `point` has selected, from the first one. */
export function selectionAt(point: Point, lines: readonly string[]): number[] {
  const row = Math.floor((point.y - SELECTION_ORIGIN.y) / TEXT.line);
  const dx = point.x - SELECTION_ORIGIN.x;
  return lines.map((line, index) => {
    const count = Array.from(line).length;
    if (index < row) return count;
    if (index > row) return 0;
    let selected = 0;
    for (let char = 1; char <= count; char++) {
      const middle = (advance(line, char - 1) + advance(line, char)) / 2;
      if (middle > dx) break;
      selected = char;
    }
    return selected;
  });
}

/** Where the selection ends: just past its last character, on its last line's middle. */
export function selectionEnd(lines: readonly string[]): Point {
  const last = lines.length - 1;
  return {
    x: SELECTION_ORIGIN.x + lineWidth(lines[last] ?? ''),
    y: SELECTION_ORIGIN.y + last * TEXT.line + TEXT.line / 2,
  };
}
