import type { OwnInput } from './channel/payloads.ts';

/** Matches `ComputerCoordinator.inUseInput` (3s) on the host. */
const OWN_INPUT_WINDOW_MS = 3000;
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

/** The macOS event type a DOM event stands for, or null when it stands for none the host reads. */
function ownInputKey(event: Event): OwnInputKey | null {
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
 * Source-stamped wall-clock times of the person's trusted hardware events on Atd's own UI (the
 * in-page HUD layer, the panel), latest per macOS event type. A request the person makes there
 * carries them (`OwnInput`), so the host can verify them against its live HID readings and tell
 * them from input aimed at the page: Chrome is the frontmost app either way.
 */
export class OwnInputRecorder {
  private readonly at: Partial<Record<OwnInputKey, number>> = {};

  /** A trusted event that landed on Atd's own UI. */
  record(event: Event): void {
    const key = ownInputKey(event);
    if (key === null) return;
    const delta = performance.now() - event.timeStamp;
    if (Number.isFinite(delta) && delta >= -5 && delta <= 10_000) {
      this.at[key] = Date.now() - Math.max(0, delta);
    }
  }

  /** A trusted event aimed at the page: a newer event of its type is no longer Atd's own. */
  supersede(event: Event): void {
    const key = ownInputKey(event);
    if (key !== null) delete this.at[key];
  }

  /** Consumes what was recorded within the host's active-use window. */
  take(): OwnInput | undefined {
    const cutoff = Date.now() - OWN_INPUT_WINDOW_MS;
    const snapshot: OwnInput = {};
    let any = false;
    for (const key of OWN_KEYS) {
      const at = this.at[key];
      delete this.at[key];
      if (at !== undefined && at >= cutoff) {
        snapshot[key] = at;
        any = true;
      }
    }
    return any ? snapshot : undefined;
  }
}
