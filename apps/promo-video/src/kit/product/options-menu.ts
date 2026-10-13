import type { Point, Rect } from '../world/points.ts';
import { lineWidth } from './island-layout.ts';

/**
 * The selection toolbar's menus as geometry (`SelectionToolbarMenuLayout`, `ToolbarOptionsRow`):
 * rows of one common width, 28 pt capsules 2 pt apart in 4 pt of padding, a 9 pt hairline row
 * between an options menu's rows and its Run row. Each row has the toolbar button's 10 pt inset and
 * 13 pt medium title (cut past 240 pt), a secondary detail right-aligned 16 pt past the title (cut
 * past 160 pt), and one trailing 14 pt slot, as a pop-up menu marks its choice: a value's or a
 * toggle's checkmark, or the chevron of a row that opens a submenu. Rows whose siblings use the
 * slot keep it empty (`blank`), so every mark and chevron shares one column and every detail ends
 * at the same edge. The slot sits 6 pt after a detail, or 16 pt after a bare title.
 */
export interface MenuRow {
  title: string;
  /** What the row shows now on its right (a choice's value, the Run row's values). */
  detail?: string;
  /** Other details it may switch to, measured with it so the menu keeps its width. */
  reserved?: readonly string[];
  /** No trailing slot unless the row opens a submenu (`none`), the slot empty (`blank`), or a check. */
  mark?: 'none' | 'blank' | 'check';
  submenu?: boolean;
}

export type MenuItem = MenuRow | 'separator';

export const MENU = {
  padding: 4,
  gap: 2,
  row: 28,
  separator: 9,
  /** A menu opens this far below the toolbar, a submenu this far past its menu. */
  offset: 4,
  /** A row's inset, its title's and detail's caps, the slot, and the gaps before it. */
  inset: 10,
  titleMax: 240,
  detailMax: 160,
  slot: 14,
  detailGap: 16,
  iconGap: 6,
} as const;

/** Whether a row keeps the trailing slot: for its chevron, or a mark (shown or blank). */
export const hasSlot = (row: MenuRow) => Boolean(row.submenu) || (row.mark ?? 'none') !== 'none';

/** A row's natural width: its parts at their measured widths, text up to its caps. */
function rowWidth(row: MenuRow): number {
  const details = [row.detail, ...(row.reserved ?? [])].filter((text) => text !== undefined);
  const detail = Math.min(
    Math.max(0, ...details.map((text) => lineWidth(text, 13, 400))),
    MENU.detailMax,
  );
  const title = Math.min(lineWidth(row.title, 13, 500), MENU.titleMax);
  const slot = hasSlot(row) ? MENU.slot + (detail > 0 ? MENU.iconGap : MENU.detailGap) : 0;
  return MENU.inset * 2 + title + (detail > 0 ? MENU.detailGap + detail : 0) + slot;
}

/** The common row width of a menu. */
export function menuRowWidth(items: readonly MenuItem[]): number {
  return Math.max(...items.map((item) => (item === 'separator' ? 0 : rowWidth(item))));
}

/** The menu's frame with its top-left at `origin`. */
export function menuFrame(origin: Point, items: readonly MenuItem[]): Rect {
  const rows = items.filter((item) => item !== 'separator').length;
  const separators = items.length - rows;
  return {
    x: origin.x,
    y: origin.y,
    width: menuRowWidth(items) + MENU.padding * 2,
    height:
      rows * MENU.row +
      separators * MENU.separator +
      Math.max(items.length - 1, 0) * MENU.gap +
      MENU.padding * 2,
  };
}

/** Each item's frame (a hairline's too), for the pointer to land on and hover. */
export function menuItemRects(origin: Point, items: readonly MenuItem[]): Rect[] {
  const width = menuRowWidth(items);
  let y = origin.y + MENU.padding;
  return items.map((item) => {
    const height = item === 'separator' ? MENU.separator : MENU.row;
    const rect = { x: origin.x + MENU.padding, y, width, height };
    y += height + MENU.gap;
    return rect;
  });
}

/** The index of the row under `point`, if any (never a hairline). */
export function rowAt(point: Point, origin: Point, items: readonly MenuItem[]): number | undefined {
  const index = menuItemRects(origin, items).findIndex(
    (rect) =>
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height,
  );
  return index < 0 || items[index] === 'separator' ? undefined : index;
}

/** The middle of item `index`. */
export function rowCenter(origin: Point, items: readonly MenuItem[], index: number): Point {
  const rect = menuItemRects(origin, items)[index];
  return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : origin;
}
