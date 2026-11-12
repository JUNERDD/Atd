/** The most often a growing answer reaches a native result card. */
export const STREAM_INTERVAL_MS = 120;

/**
 * Paces a streaming answer's updates to a native result card: each card update re-measures and
 * redraws native text, so token-by-token updates would only cost frames.
 */
export interface StreamThrottle {
  /**
   * Runs `update` at once when no update ran within the interval; otherwise keeps it as the one
   * due when the interval ends, replacing any update kept before it.
   */
  push(update: () => void): void;
  /** Drops a kept update; the run's end sends its final state itself. */
  cancel(): void;
}

/**
 * A throttle whose first update runs at once, later ones at most once per `intervalMs`, and whose
 * last update always runs unless `cancel` came first.
 */
export function streamThrottle(intervalMs = STREAM_INTERVAL_MS): StreamThrottle {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let due: (() => void) | undefined;
  const tick = () => {
    timer = undefined;
    const next = due;
    due = undefined;
    if (!next) return;
    next();
    timer = setTimeout(tick, intervalMs);
  };
  return {
    push(update) {
      if (timer !== undefined) {
        due = update;
        return;
      }
      update();
      timer = setTimeout(tick, intervalMs);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      due = undefined;
    },
  };
}
