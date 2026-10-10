/** Finder's content model and grid metrics, so scenes can find where an item sits. */
import type { Rect } from './points.ts';

export interface FinderItem {
  kind: 'pdf' | 'folder';
  name: string;
}

/** The grid's cell, in points, so scenes can find an item's position (see `finderItemCenter`). */
export const FINDER_GRID = {
  left: 18,
  top: 16,
  cellWidth: 112,
  cellHeight: 112,
  columns: 4,
} as const;

/**
 * The center of an item's icon art inside a `FinderWindow` at `box` (sidebar 196 pt), in display
 * points: where the cursor goes to pick it up.
 */
export function finderItemCenter(box: Rect, index: number): { x: number; y: number } {
  const column = index % FINDER_GRID.columns;
  const row = Math.floor(index / FINDER_GRID.columns);
  return {
    x:
      box.x +
      196 +
      8 +
      FINDER_GRID.left +
      column * FINDER_GRID.cellWidth +
      FINDER_GRID.cellWidth / 2,
    y: box.y + 52 + FINDER_GRID.top + row * FINDER_GRID.cellHeight + 32,
  };
}
