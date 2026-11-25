import type { OwnInput } from '../channel/payloads.ts';
import { fromOwnLayer } from './hosts.ts';
import { signal } from './lifetime.ts';

/** At most one report a second (the background keeps the latest as `lastInputAt`). */
const THROTTLE_MS = 1000;
/** Matches `ComputerCoordinator.inUseInput` (3s) on the host. */
const OWN_INPUT_WINDOW_MS = 3000;
const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
const OWN_KEYS = [
  'keyDown',
  'leftMouseDown',
  'rightMouseDown',
  'otherMouseDown',
  'scrollWheel',
] as const;
/** Modifier keys update macOS `CGEventType.flagsChanged`, not `CGEventType.keyDown`. */
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn']);

type OwnInputKey = (typeof OWN_KEYS)[number];

export interface ActivityDeps {
  /** Whether a run that owns this tab is active: only then is input reported at all. */
  active(): boolean;
  /**
   * Until when input in the page is likely Atd's own: CDP-dispatched input arrives as trusted
   * events, so the moments the pointer shows a dispatch are left out.
   */
  dispatchingUntil(): number;
  /** Additional events owned by Atd's HUD when focus lies outside the shadow host (e.g. ⌃⌥⌘+arrow). */
  ownEvent?(event: Event): boolean;
  report(): void;
}

export interface ActivityTracker {
  /** Consumes recent trusted hardware events recorded on Atd's own HUD layer. */
  takeOwnInput(): OwnInput | undefined;
}

function classifyOwnInputKey(event: Event): OwnInputKey | null {
  switch (event.type) {
    case 'pointerdown': {
      const button = (event as PointerEvent).button;
      if (button === 0) return 'leftMouseDown';
      if (button === 2) return 'rightMouseDown';
      return button >= 1 ? 'otherMouseDown' : null;
    }
    case 'keydown':
      return MODIFIER_KEYS.has((event as KeyboardEvent).key) ? null : 'keyDown';
    case 'wheel':
      return 'scrollWheel';
    default:
      return null;
  }
}

/**
 * Tells the background that the person is using this tab, so a run treats it as in use (D10:
 * recent input in an owned active tab counts like Take over). Only trusted events on the page
 * itself count as page activity, while trusted events on Atd's HUD layer record source-stamped
 * wall-clock timestamps so the host can attribute HUD approvals without masking page input.
 */
export function watchActivity(deps: ActivityDeps): ActivityTracker {
  let last = 0;
  const own: Partial<Record<OwnInputKey, number>> = {};
  const seen = (event: Event): void => {
    if (!event.isTrusted) return;
    const key = classifyOwnInputKey(event);
    if (fromOwnLayer(event) || deps.ownEvent?.(event) === true) {
      if (key === null) return;
      const delta = performance.now() - event.timeStamp;
      if (Number.isFinite(delta) && delta >= -5 && delta <= 10_000) {
        own[key] = Date.now() - Math.max(0, delta);
      }
      return;
    }
    const now = Date.now();
    if (now >= deps.dispatchingUntil() && key !== null) delete own[key];
    if (!deps.active() || now < deps.dispatchingUntil() || now - last < THROTTLE_MS) return;
    last = now;
    deps.report();
  };
  for (const type of EVENTS) addEventListener(type, seen, { capture: true, passive: true, signal });
  return {
    takeOwnInput(): OwnInput | undefined {
      const cutoff = Date.now() - OWN_INPUT_WINDOW_MS;
      const snapshot: OwnInput = {};
      let any = false;
      for (const key of OWN_KEYS) {
        const at = own[key];
        delete own[key];
        if (at !== undefined && at >= cutoff) {
          snapshot[key] = at;
          any = true;
        }
      }
      return any ? snapshot : undefined;
    },
  };
}
