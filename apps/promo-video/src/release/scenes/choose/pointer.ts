/**
 * The mouse path of the where act, as geometry and state on the display (points): the selection
 * toolbar centred 8 pt above line 2 (`SelectionToolbarPlacement`), Translate's split button
 * ending it, its options menu 4 pt under the capsule at the split's leading edge
 * (`SelectionToolbarMenuPlacement`), the When-done submenu 4 pt past the menu with its first row
 * level with When done (`SelectionToolbarSubmenuPlacement`), and the pointer's keys. A pick in the
 * submenu changes the row and closes the submenu; Run launches with the values (`ToolbarOptions
 * Content`). Pure, so a frame evaluates alone.
 */
import type { Lang } from '../../../copy.ts';
import { lineWidth } from '../../../kit/product/island-layout.ts';
import {
  MENU,
  menuFrame,
  menuItemRects,
  rowAt,
  type MenuItem,
} from '../../../kit/product/options-menu.ts';
import { outputChoice, outputMenuItems, outputMenuRow } from '../../../kit/product/run-output.ts';
import { strings } from '../../../kit/product/strings.ts';
import { cursorAt, type CursorKey, type CursorState } from '../../../kit/world/cursor.ts';
import type { Point, Rect } from '../../../kit/world/points.ts';
import { clamp01 } from '../../../motion/ease.ts';
import { CHOOSE_BEATS as B } from './beats.ts';
import { content, PICKED_LANGUAGE } from './content.ts';
import { line2Box } from './note-layout.ts';

/** The toolbar sits this far above the selection; the capsule is 36 pt tall with 4 pt padding. */
const TOOLBAR_GAP = 8;
const CAPSULE = { height: 36, padding: 4, grip: 16, gap: 2, chevron: 20, endChevron: 28 };

const label = (text: string) => lineWidth(text, 13, 500) - 1;
const button = (text: string) => 10 + label(text) + 10;
const middle = (rect: Rect): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

export interface PointerPlan {
  capsule: Rect;
  /** Translate's chevron (Translate leads the commands, Polish writing ends the capsule). */
  chevron: Rect;
  menu: Rect;
  submenu: Rect;
  /** The menu before and after the pick (When done's detail changes), and the submenu's rows. */
  items: MenuItem[];
  picked: MenuItem[];
  submenuItems: MenuItem[];
  keys: CursorKey[];
}

/** The toolbar, the menus and the pointer's path for `lang`. */
export function pointerPlan(lang: Lang): PointerPlan {
  const c = content[lang];
  const s = strings[lang];
  const line = line2Box(lang);
  const ask = 10 + 14 + 6 + label(s.selection.ask) + 10;
  const translate = button(c.translate);
  const polish = button(c.polish) + CAPSULE.endChevron;
  const lead = CAPSULE.padding + CAPSULE.grip + CAPSULE.gap + ask + CAPSULE.gap;
  const width = lead + translate + CAPSULE.chevron + CAPSULE.gap + polish + CAPSULE.padding;
  const capsule = {
    x: line.x + line.width / 2 - width / 2,
    y: line.y - TOOLBAR_GAP - CAPSULE.height,
    width,
    height: CAPSULE.height,
  };
  const split = capsule.x + lead;
  const chevron = {
    x: split + translate,
    y: capsule.y + CAPSULE.padding,
    width: CAPSULE.chevron,
    height: 28,
  };
  const japanese = c.languages[PICKED_LANGUAGE] ?? '';
  const language: MenuItem = {
    title: c.languageLabel,
    detail: japanese,
    reserved: c.languages,
    submenu: true,
  };
  const run: MenuItem = { title: s.command.run, detail: japanese };
  const saved = outputChoice(lang, { saved: 'replaceSelection' });
  const after = outputChoice(lang, { saved: 'replaceSelection', current: 'insertAfterSelection' });
  const items: MenuItem[] = [language, outputMenuRow(saved), 'separator', run];
  const picked: MenuItem[] = [language, outputMenuRow(after), 'separator', run];
  const menu = menuFrame({ x: split, y: capsule.y + capsule.height + MENU.offset }, items);
  const rows = menuItemRects(menu, items);
  const whenDone = rows[1] ?? menu;
  const submenuItems = outputMenuItems(saved);
  const submenu = menuFrame(
    { x: menu.x + menu.width + MENU.offset, y: whenDone.y - MENU.padding },
    submenuItems,
  );
  const subRows = menuItemRects(submenu, submenuItems);
  const sub = (index: number, dx: number): Point => {
    const rect = subRows[index] ?? submenu;
    return { x: rect.x + dx, y: rect.y + rect.height / 2 };
  };
  const runRow = rows[3] ?? menu;
  const lineY = line.y + line.height / 2;
  const keys: CursorKey[] = [
    { at: B.pointerIn, x: line.x + line.width + 260, y: lineY + 170 },
    { at: B.dragStart, x: line.x - 1, y: lineY, press: 'down', travel: 0.5 },
    { at: B.dragEnd, x: line.x + line.width + 1, y: lineY, travel: 0.42 },
    { at: B.dragUp, x: line.x + line.width + 1, y: lineY, press: 'up' },
    { at: B.chevronClick, ...middle(chevron), press: true, travel: 0.4 },
    { at: B.whenDoneHover, x: whenDone.x + 56, y: whenDone.y + 14, travel: 0.26 },
    { at: B.submenuEnter, ...sub(0, 44), travel: 0.26 },
    { at: B.pickClick, ...sub(2, 92), press: true, travel: 0.26 },
    { at: B.runClick, x: runRow.x + 46, y: runRow.y + 14, press: true, travel: 0.36 },
  ];
  return { capsule, chevron, menu, submenu, items, picked, submenuItems, keys };
}

/** What the toolbar and its menus show at `t`. */
export interface PointerState {
  cursor: CursorState;
  /** The pointer's opacity: it glides in, and hides once the app types (as macOS hides it). */
  cursorOpacity: number;
  /** Line 2's selection, 0 → 1 of its graphemes, while the drag runs and after. */
  selection: number;
  toolbar: { shown: boolean; age: number; chevron: 'hover' | 'open' | undefined };
  menu: { shown: boolean; items: MenuItem[]; hover?: number; pressed?: number; active?: number };
  submenu: { shown: boolean; hover?: number; pressed?: number };
}

const near = (t: number, at: number) => t > at - 0.03 && t < at + 0.1;
const inside = (point: Point, rect: Rect) =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.width &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.height;

export function pointerAt(plan: PointerPlan, t: number, lang: Lang): PointerState {
  const cursor = cursorAt(t, plan.keys);
  const line = line2Box(lang);
  const drag = t < B.dragStart ? 0 : t < B.dragUp ? clamp01((cursor.x - line.x) / line.width) : 1;
  const menuShown = t >= B.chevronClick + 0.03 && t < B.runClick + 0.06;
  const submenuShown = t >= B.submenuOpen && t < B.pickClick + 0.06;
  const items = t >= B.pickClick + 0.06 ? plan.picked : plan.items;
  const over = (rect: Rect, items: readonly MenuItem[]) => rowAt(cursor, rect, items);
  const menuHover = menuShown ? over(plan.menu, items) : undefined;
  const subHover = submenuShown ? over(plan.submenu, plan.submenuItems) : undefined;
  return {
    cursor,
    cursorOpacity: clamp01((t - B.pointerIn) / 0.2) * (1 - clamp01((t - B.whereWrite) / 0.15)),
    selection: t >= B.whereWrite ? 0 : drag,
    toolbar: {
      shown: t >= B.dragUp && t < B.runClick + 0.06,
      age: t - B.dragUp,
      chevron: menuShown ? 'open' : inside(cursor, plan.chevron) ? 'hover' : undefined,
    },
    menu: {
      shown: menuShown,
      items,
      ...(menuHover === undefined ? {} : { hover: menuHover }),
      ...(near(t, B.runClick) ? { pressed: 3 } : {}),
      ...(submenuShown ? { active: 1 } : {}),
    },
    submenu: {
      shown: submenuShown,
      ...(subHover === undefined ? {} : { hover: subHover }),
      ...(near(t, B.pickClick) ? { pressed: 2 } : {}),
    },
  };
}
