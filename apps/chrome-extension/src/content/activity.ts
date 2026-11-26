import type { OwnInput } from '../channel/payloads.ts';
import { OwnInputRecorder } from '../own-input.ts';
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
  /**
   * Additional events owned by Atd's HUD when they land outside its shadow host (⌃⌥⌘+arrow, or
   * a click that picks an element of the page for the in-page ask).
   */
  ownEvent?(event: Event): boolean;
  report(): void;
}

export interface ActivityTracker {
  /** Consumes recent trusted hardware events recorded on Atd's own HUD layer. */
  takeOwnInput(): OwnInput | undefined;
}

/**
 * Tells the background that the person is using this tab, so a run treats it as in use (D10:
 * recent input in an owned active tab counts like Take over). Only trusted events on the page
 * itself count as page activity, while trusted events on Atd's HUD layer record source-stamped
 * wall-clock timestamps so the host can attribute HUD approvals without masking page input.
 */
export function watchActivity(deps: ActivityDeps): ActivityTracker {
  let last = 0;
  const own = new OwnInputRecorder();
  const seen = (event: Event): void => {
    if (!event.isTrusted) return;
    if (fromOwnLayer(event) || deps.ownEvent?.(event) === true) {
      own.record(event);
      return;
    }
    const now = Date.now();
    if (now >= deps.dispatchingUntil()) own.supersede(event);
    if (!deps.active() || now < deps.dispatchingUntil() || now - last < THROTTLE_MS) return;
    last = now;
    deps.report();
  };
  for (const type of EVENTS) addEventListener(type, seen, { capture: true, passive: true, signal });
  return { takeOwnInput: () => own.take() };
}
