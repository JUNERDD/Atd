import { fromOwnLayer } from '../hosts.ts';
import { signal } from '../lifetime.ts';

/** A keyboard-made selection counts once it has stopped changing for this long. */
const KEY_SETTLE_MS = 300;
/** A selection change counts as keyboard-made only this soon after one of the person's keys. */
const KEY_RECENT_MS = 1000;

export interface SelectionEvents {
  /** A selection the person made has settled: read it now and offer the commands. */
  settled(): void;
  /** The selection changed (a shown bar checks that its selection is still there). */
  changed(): void;
}

/**
 * When a selection the person made has settled: as the mouse is released (a drag, a double or a
 * triple click), or, for one made with the keyboard (Shift with the arrows, ⌘A), once it has
 * stopped changing while no mouse button is down. Only the person's own input counts: a page
 * that changes the selection by script, without their keys, is not offered commands. Presses and
 * keys on Atd's own surfaces are not the page's.
 */
export function watchSelections(events: SelectionEvents): void {
  let pressed = false;
  let lastKey = Number.NEGATIVE_INFINITY;
  let timer = 0;
  const options = { capture: true, signal };

  addEventListener(
    'mousedown',
    (event) => {
      if (event.button === 0) pressed = true;
    },
    options,
  );
  addEventListener(
    'mouseup',
    (event) => {
      if (event.button !== 0) return;
      pressed = false;
      if (fromOwnLayer(event)) return;
      // The selection settles after the event; read it once it has.
      setTimeout(() => events.settled(), 0);
    },
    options,
  );
  // A release outside the window never arrives; the next press starts over.
  addEventListener(
    'blur',
    () => {
      pressed = false;
    },
    { signal },
  );
  addEventListener(
    'keydown',
    (event) => {
      if (event.isTrusted && !fromOwnLayer(event)) lastKey = performance.now();
    },
    options,
  );
  document.addEventListener(
    'selectionchange',
    () => {
      events.changed();
      if (pressed || performance.now() - lastKey > KEY_RECENT_MS) return;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!pressed) events.settled();
      }, KEY_SETTLE_MS);
    },
    { signal },
  );
}
