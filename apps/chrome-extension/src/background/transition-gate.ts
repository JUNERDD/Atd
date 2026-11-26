/** The longest a takeover transition may hold a tab's commands, however its content script fares. */
export const HOLD_CAP_MS = 2500;

interface Hold {
  /** The transition (its capture request id) holding the tab, or null once released. */
  id: string | null;
  released: Promise<void>;
  release(): void;
  timer: ReturnType<typeof setTimeout>;
  /** Commands waiting for `released`; while any wait, every later command waits behind them. */
  queued: number;
}

/**
 * Holds the agent's look and touch on a tab while its takeover ripple bends the page
 * (`transition.capture` with `hold`), so the first screenshot and the first click see the page
 * itself. While a hold lasts, `Page.captureScreenshot` and `Input.*` wait; once one waits, every
 * later command for the tab (child sessions included) waits behind it, so Chrome receives them in
 * the order they were sent. A hold ends when its content script says the transition left
 * (`transition.end`), when that content script goes, or after `HOLD_CAP_MS`.
 *
 * `Debuggee.send` is the one caller of `run`; nothing else sends CDP commands to a tab.
 */
export class TransitionGate {
  private readonly holds = new Map<number, Hold>();

  /**
   * Holds the tab for transition `id`. A hold already there is taken over and keeps its deadline,
   * so no sequence of requests holds a tab past `HOLD_CAP_MS` without an end in between.
   */
  hold(tabId: number, id: string): void {
    const current = this.holds.get(tabId);
    if (current !== undefined && current.id !== null) {
      current.id = id;
      return;
    }
    // A released hold whose commands are still draining is replaced: they dispatch in this task's
    // microtasks, before any command that could reach the new one, and count down their own entry.
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => (release = resolve));
    const timer = setTimeout(() => this.release(tabId), HOLD_CAP_MS);
    this.holds.set(tabId, { id, released, release, timer, queued: 0 });
  }

  /**
   * Ends the tab's hold. With `id`, only that transition's (a late end of an earlier transition
   * leaves a newer one alone); without, whichever holds it (its content script went away).
   */
  release(tabId: number, id?: string): void {
    const hold = this.holds.get(tabId);
    if (hold === undefined || hold.id === null || (id !== undefined && hold.id !== id)) return;
    clearTimeout(hold.timer);
    hold.id = null;
    hold.release();
    if (hold.queued === 0) this.holds.delete(tabId);
  }

  /**
   * Calls `dispatch` now, or once the tab's hold ends when the command must wait: a screenshot or
   * input while held, or anything sent while an earlier command still waits. `dispatch` must hand
   * its command to Chrome before its first `await`, which is what keeps the order.
   */
  run<T>(tabId: number, method: string, dispatch: () => Promise<T>): Promise<T> {
    const hold = this.holds.get(tabId);
    if (hold === undefined || (hold.queued === 0 && (hold.id === null || !gated(method))))
      return dispatch();
    hold.queued += 1;
    return hold.released.then(() => {
      // Counted down and dispatched in one step, so no command can slip between two waiting ones.
      hold.queued -= 1;
      if (hold.queued === 0 && hold.id === null && this.holds.get(tabId) === hold)
        this.holds.delete(tabId);
      return dispatch();
    });
  }
}

/** What the agent must not do to a bent page: look at it or touch it. */
function gated(method: string): boolean {
  return method === 'Page.captureScreenshot' || method.startsWith('Input.');
}
