/** Seconds a word holds before the next change; the first word (the name) holds a little longer. */
const HOLD = 1.3;
const FIRST_HOLD = 1.6;
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
  change(time: number): number;
  /** Seconds since the shown word arrived (power-on or a change landing), or -1 if it has not. */
  settled(time: number): number;
  /** Marks the shown word as arrived at `time`: the end of power-on. */
  arrive(time: number): void;
  /** Advances to `time` (seconds), starting the next change once the current word's hold is over. */
  tick(time: number, running: boolean): void;
  /** Ends any change at once, on its incoming word. */
  finish(): void;
  /** Starts over on the first of `count` words. */
  reset(count: number): void;
}

/**
 * `changeSeconds` says how long a change from one word to another takes (typing.ts), read as each
 * change starts.
 */
export function createWordCycle(
  count: number,
  changeSeconds: (from: number, to: number) => number,
): WordCycle {
  let words = count;
  let current = 0;
  let next = -1;
  let changeAt = 0;
  /** How long the change in progress takes. */
  let changeLength = 0;
  /** When the current word's hold ends; NaN until the cycle first runs. */
  let holdUntil = Number.NaN;
  /** When the shown word arrived; NaN before power-on ends and after the words are reset. */
  let arrivedAt = Number.NaN;

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
    change(time) {
      return next < 0 ? -1 : time - changeAt;
    },
    settled(time) {
      return next >= 0 || Number.isNaN(arrivedAt) ? -1 : time - arrivedAt;
    },
    arrive(time) {
      arrivedAt = time;
    },
    tick(time, running) {
      if (next >= 0 && time - changeAt >= changeLength) {
        land();
        arrivedAt = changeAt + changeLength;
        holdUntil = time + hold(current);
      }
      if (!running || words < 2 || next >= 0) {
        // A paused cycle restarts its hold when it resumes, so nothing changes the moment it does.
        if (!running) holdUntil = Number.NaN;
        return;
      }
      if (Number.isNaN(holdUntil)) holdUntil = time + hold(current);
      if (time < holdUntil) return;
      next = (current + 1) % words;
      changeAt = time;
      changeLength = changeSeconds(current, next);
    },
    finish() {
      // A change cut short counts as landed when it would have; a word at rest keeps its arrival.
      if (next >= 0) arrivedAt = changeAt + changeLength;
      land();
      holdUntil = Number.NaN;
    },
    reset(nextCount) {
      words = nextCount;
      current = 0;
      next = -1;
      holdUntil = Number.NaN;
      arrivedAt = Number.NaN;
    },
  };
}
