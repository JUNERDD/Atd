/** Seconds a word holds before the next change; the first word (the name) holds longer. */
const HOLD = 2.4;
const FIRST_HOLD = 3.4;
/**
 * Seconds one change takes on the board: the shader's sweep across it (SWEEP) plus one cell's melt
 * (MELT) in shaders.ts. Keep them in step.
 */
export const CHANGE_SECONDS = 1.6;

/**
 * Which word the field shows, and the change in progress. A change starts only while the cycle may
 * run (full motion, power-on done, more than one word); a change already under way always ends.
 */
export interface WordCycle {
  /** The word on the board, or the one changing away. */
  readonly current: number;
  /** The word changing in, or -1. */
  readonly next: number;
  /** Seconds into the change in progress, or -1. */
  morph(time: number): number;
  /** Advances to `time` (seconds). Returns the index of a word that starts changing in, or -1. */
  tick(time: number, running: boolean): number;
  /** Ends any change at once, on its incoming word. */
  finish(): void;
  /** Starts over on the first of `count` words. */
  reset(count: number): void;
}

export function createWordCycle(count: number): WordCycle {
  let words = count;
  let current = 0;
  let next = -1;
  let changeAt = 0;
  /** When the current word's hold ends; NaN until the cycle first runs. */
  let holdUntil = Number.NaN;

  const hold = (index: number) => (index === 0 ? FIRST_HOLD : HOLD);
  const land = () => {
    if (next < 0) return;
    current = next;
    next = -1;
  };

  return {
    get current() {
      return current;
    },
    get next() {
      return next;
    },
    morph(time) {
      return next < 0 ? -1 : time - changeAt;
    },
    tick(time, running) {
      if (next >= 0 && time - changeAt >= CHANGE_SECONDS) {
        land();
        holdUntil = time + hold(current);
      }
      if (!running || words < 2 || next >= 0) {
        // A paused cycle restarts its hold when it resumes, so nothing changes the moment it does.
        if (!running) holdUntil = Number.NaN;
        return -1;
      }
      if (Number.isNaN(holdUntil)) holdUntil = time + hold(current);
      if (time < holdUntil) return -1;
      next = (current + 1) % words;
      changeAt = time;
      return next;
    },
    finish() {
      land();
      holdUntil = Number.NaN;
    },
    reset(nextCount) {
      words = nextCount;
      current = 0;
      next = -1;
      holdUntil = Number.NaN;
    },
  };
}
