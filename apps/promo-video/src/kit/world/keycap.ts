/**
 * How far a key is pressed at time `t`: it travels down quickly at `press`, holds, and springs back
 * up at `release` with a small overshoot above rest (negative travel), as a real cap does when its
 * switch returns. Pure, so any frame can be evaluated alone.
 */
import { ramp } from '../../motion/ease.ts';
import { springAt, type Spring } from '../../motion/spring.ts';
import { graphemes } from './text-units.ts';

/** The cap's return: quick, with a little bounce. */
const RETURN: Spring = { response: 0.3, damping: 0.55 };
/** Seconds the cap takes to bottom out. */
const DOWN = 0.07;
/** How long a tap holds when no release is given. */
export const TAP_HOLD = 0.2;

/** Travel 0 (rest) → 1 (bottomed out); slightly negative while it overshoots on the way back. */
export function keyTravel(t: number, press: number, release = press + TAP_HOLD): number {
  const down = ramp(t, press, DOWN);
  if (t < release) return down;
  return ramp(release, press, DOWN) * (1 - springAt(t, release, RETURN));
}

/**
 * What a cap reads: any short label. The modifiers and Space are named for completion; letters,
 * digits, arrows, `↩`, `Esc`, `Tab` and the like work the same way.
 */
export type KeyLegend = '⌘' | '⇧' | '⌥' | '⌃' | 'Space' | (string & {});

/** Caps wider than one unit, as a Mac keyboard has them. */
const WIDE: Readonly<Record<string, number>> = {
  Space: 2.7,
  '↩': 1.8,
  Return: 1.8,
  '⇥': 1.5,
  Tab: 1.5,
  '⌫': 1.5,
  Delete: 1.5,
};

/** A legend set as a word (`Esc`, `Return`) rather than a symbol: smaller, as Space's is. */
export const isWordLegend = (legend: KeyLegend) =>
  legend !== 'Space' && graphemes(legend).length > 1;

/**
 * A cap's width in key units: the Mac's for the wide keys, one unit for a symbol, a letter or a
 * short word, and wide enough for a longer word's letters otherwise.
 */
export function keyWidth(legend: KeyLegend): number {
  const wide = WIDE[legend];
  if (wide !== undefined) return wide;
  const letters = graphemes(legend).length;
  return letters <= 3 ? 1 : Math.max(1, 0.5 + letters * 0.2);
}
