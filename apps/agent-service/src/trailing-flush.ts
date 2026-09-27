/**
 * Coalesces bursts of work into one trailing run per window: the first `schedule` arms a timer,
 * later calls within the window join it, so a steady stream still runs once per window instead
 * of being postponed like a debounce. `flush` runs owed work now; `cancel` drops it.
 *
 * A run that throws from the timer is dropped rather than rethrown, which would crash the
 * service. Callers pass work that reads its current state (a pure projection), so the next
 * synchronous `flush` or direct call repeats it and surfaces the same error to its caller.
 */
export class TrailingFlush {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly run: () => void,
    private readonly delayMs: number,
  ) {}

  schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.run();
      } catch {
        // See the class comment: the next synchronous run reports it.
      }
    }, this.delayMs);
    // Owed stream deltas never keep the process alive on their own.
    this.timer.unref();
  }

  /** Runs owed work now; nothing happens when no run is scheduled. */
  flush(): void {
    if (!this.timer) return;
    this.cancel();
    this.run();
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
