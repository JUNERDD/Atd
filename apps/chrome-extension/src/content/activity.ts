import { fromOwnLayer } from './hosts.ts';
import { signal } from './lifetime.ts';

/** At most one report a second (the background keeps the latest as `lastInputAt`). */
const THROTTLE_MS = 1000;
const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

export interface ActivityDeps {
  /** Whether a run that owns this tab is active: only then is input reported at all. */
  active(): boolean;
  /**
   * Until when input in the page is likely Atd's own: CDP-dispatched input arrives as trusted
   * events, so the moments the pointer shows a dispatch are left out.
   */
  dispatchingUntil(): number;
  report(): void;
}

/**
 * Tells the background that the person is using this tab, so a run treats it as in use (D10:
 * recent input in an owned active tab counts like Take over). Only trusted events on the page
 * itself count (not the HUD's own controls), only while this tab has an active run, and only that
 * input happened: no position, key or target.
 */
export function watchActivity(deps: ActivityDeps): void {
  let last = 0;
  const seen = (event: Event): void => {
    if (!event.isTrusted || !deps.active() || fromOwnLayer(event)) return;
    const now = Date.now();
    if (now < deps.dispatchingUntil() || now - last < THROTTLE_MS) return;
    last = now;
    deps.report();
  };
  for (const type of EVENTS) addEventListener(type, seen, { capture: true, passive: true, signal });
}
