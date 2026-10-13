import { textWidthAt } from '../world/measure.ts';

/**
 * The points the island's parts take (`IslandMetrics`, `IslandPieces.swift`), and the text
 * measurements its sizes are built from: the film's faces measured as the shell measures its
 * system font, rounded up. Measurements are exact only once the fonts have loaded, so callers
 * measure per render, never at module scope.
 */
export const ISLAND = {
  padding: 4,
  gap: 2,
  control: 28,
  grip: 16,
  glyph: 16,
  meter: 36,
  keycap: 20,
  chipMax: 160,
  card: {
    padding: 6,
    header: 28,
    row: 28,
    gap: 4,
    footer: 32,
    min: 300,
    max: 420,
    /** The tallest shape the island takes (`maxShape`); an answer scrolls past it. */
    maxHeight: 400,
    /** More rows than this scroll; a list of more values than `filterAfter` has a filter field. */
    maxRows: 8,
    filterAfter: 6,
    filter: 28,
  },
} as const;

/** A single line's width in points at its own size, rounded up as the shell measures it. */
export function lineWidth(text: string, size: number, weight: number): number {
  return Math.ceil(textWidthAt(text, weight, size) + 1);
}

/** A keycap: 20 pt tall, at least as wide, its 12 pt medium symbol 4 pt in. */
export const keycapWidth = (symbol: string) =>
  Math.max(ISLAND.keycap, lineWidth(symbol, 12, 500) + 8);

/** A footer key hint (`IslandKeyHint`): its keycap, 4 pt, its 12 pt secondary label. */
export const keyHintWidth = (keys: string, label: string) =>
  keycapWidth(keys) + 4 + lineWidth(label, 12, 400);

/** A labelled capsule button (`IslandTextButton`): 10 pt either side of its 13 pt medium title. */
export const textButtonWidth = (title: string, trailing = 0) =>
  10 + lineWidth(title, 13, 500) + (trailing > 0 ? 6 + trailing : 0) + 10;

/**
 * A card footer's ideal width (`IslandCard`, `IslandAnswerCard`): 4 pt in, its key hints and its
 * buttons 10 pt apart around a spacer of at least 8 pt.
 */
export function footerWidth(hints: readonly [string, string][], buttons: number): number {
  const items = hints.map(([keys, label]) => keyHintWidth(keys, label));
  const gaps = 10 * (items.length + (buttons > 0 ? 1 : 0));
  return 4 + items.reduce((sum, width) => sum + width, 0) + gaps + 8 + buttons;
}
