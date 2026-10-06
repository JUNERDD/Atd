/** Render scales relative to the clamped device pixel ratio, from best to cheapest. */
const LEVELS = [1, 0.85, 0.7, 0.6] as const;
/** Frames per measurement window. */
const WINDOW = 24;
/** A window whose mean interval is this much above the refresh period is dropping frames. */
const SLOW = 1.25;
/** So far behind that one window is enough evidence to step down. */
const SEVERE = 2;
/** A window this close to the refresh period has headroom. */
const GOOD = 1.08;
/** Consecutive slow windows before stepping down. */
const SLOW_WINDOWS = 2;
const FIRST_HOLD = 8;
const MAX_HOLD = 64;

/** Insertion sort: the window is tiny, and unlike TypedArray#sort it never allocates. */
function sortInPlace(values: Float64Array): void {
  for (let i = 1; i < values.length; i++) {
    const value = values[i] ?? 0;
    let j = i - 1;
    while (j >= 0 && (values[j] ?? 0) > value) {
      values[j + 1] = values[j] ?? 0;
      j -= 1;
    }
    values[j + 1] = value;
  }
}

export interface QualityGovernor {
  /** Current render scale. */
  readonly scale: number;
  /** Records the interval between two consecutive drawn frames; returns true when the scale changed. */
  sample(intervalMs: number): boolean;
  /** Drops the partial window, e.g. after a pause or a resize. */
  reset(): void;
}

/**
 * Picks the render scale from rAF cadence. The refresh period is the lowest window median seen,
 * starting from 60 Hz: a median ignores the jitter of timer-driven rAF clocks, and a page that is
 * GPU-bound from the start settles for 60 Hz rather than learning a slower period. A sustained mean
 * above that period means the GPU is behind. Stepping back up needs a run of good windows, and the
 * run doubles after a step-up that fails at once, so the scale cannot oscillate.
 */
export function createQualityGovernor(): QualityGovernor {
  const intervals = new Float64Array(WINDOW);
  let count = 0;
  let level = 0;
  let refresh = 1000 / 60;
  let slowRun = 0;
  let goodRun = 0;
  let hold = FIRST_HOLD;
  let windowsSinceStepUp = Number.POSITIVE_INFINITY;

  const step = (delta: 1 | -1): boolean => {
    const next = level + delta;
    if (next < 0 || next >= LEVELS.length) return false;
    level = next;
    slowRun = 0;
    goodRun = 0;
    return true;
  };

  return {
    get scale() {
      return LEVELS[level] ?? 1;
    },
    sample(intervalMs) {
      intervals[count] = intervalMs;
      count += 1;
      if (count < WINDOW) return false;
      count = 0;
      let sum = 0;
      for (let i = 0; i < WINDOW; i++) sum += intervals[i] ?? 0;
      const mean = sum / WINDOW;
      sortInPlace(intervals);
      const median = intervals[WINDOW >> 1] ?? mean;
      refresh = Math.min(refresh, Math.max(median, 1000 / 240));
      windowsSinceStepUp += 1;

      if (mean > refresh * SLOW) {
        goodRun = 0;
        slowRun += 1;
        if (slowRun < SLOW_WINDOWS && mean < refresh * SEVERE) return false;
        // A step-up that drops frames right away was premature: wait twice as long next time.
        if (windowsSinceStepUp <= SLOW_WINDOWS + 2) hold = Math.min(hold * 2, MAX_HOLD);
        return step(1);
      }
      slowRun = 0;
      goodRun = mean < refresh * GOOD ? goodRun + 1 : 0;
      if (goodRun < hold || !step(-1)) return false;
      windowsSinceStepUp = 0;
      return true;
    },
    reset() {
      count = 0;
    },
  };
}
