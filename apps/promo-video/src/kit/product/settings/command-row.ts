import { clamp01 } from '../../../motion/ease.ts';

/**
 * The long press that lifts a row (`use-long-press-drag.ts`, `commands.css`): after a short
 * click's length (120 ms) the shadow rises over 230 ms, ease-out, and at 350 ms the row lifts and
 * follows the pointer. Moving more than 4 pt before then cancels the hold.
 */
export const HOLD = { shadowDelay: 0.12, shadowRise: 0.23, lift: 0.35, slop: 4 } as const;

/** CSS `ease-out`, `cubic-bezier(0, 0, 0.58, 1)`, solved for its progress at `x`. */
function cssEaseOut(x: number): number {
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 24; step++) {
    const mid = (lo + hi) / 2;
    const u = 1 - mid;
    // x(s) = 3u²s·0 + 3us²·0.58 + s³ and y(s) = 3us² + s³ for control points (0, 0), (0.58, 1).
    if (3 * u * mid * mid * 0.58 + mid ** 3 < x) lo = mid;
    else hi = mid;
  }
  const s = (lo + hi) / 2;
  return 3 * (1 - s) * s * s + s ** 3;
}

/**
 * A row's hold state `age` seconds into a press (omit or pass a negative age for a row at rest):
 * the shadow's rise, 0 → 1, and whether it has lifted. Feed both to `CommandRow`.
 */
export function commandRowHold(age: number | undefined): { shadow: number; lifted: boolean } {
  if (age === undefined || age < 0) return { shadow: 0, lifted: false };
  const rise = clamp01((age - HOLD.shadowDelay) / HOLD.shadowRise);
  return { shadow: age >= HOLD.lift ? 1 : cssEaseOut(rise), lifted: age >= HOLD.lift };
}
