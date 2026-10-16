/**
 * Window state on the root element for styles: `data-window-active="false"` turns the glass
 * surfaces into their dimmed fill (`surface-glass` in `@atd/ui`), `data-window-visible="false"`
 * marks a panel the shell hid at alpha 0, which keeps running, and
 * `data-reduced-transparency="true"` carries the system's Reduce transparency setting, which WebKit
 * does not expose as a media feature. Unset reads as active, visible and transparent.
 */
const activeListeners = new Set<(active: boolean) => void>();

export function setWindowActive(active: boolean) {
  document.documentElement.dataset.windowActive = String(active);
  for (const listener of activeListeners) listener(active);
}

/** Every time the shell reports the window becoming key or resigning it; returns the unsubscribe. */
export function onWindowActive(listener: (active: boolean) => void): () => void {
  activeListeners.add(listener);
  return () => activeListeners.delete(listener);
}

export function setWindowVisible(visible: boolean) {
  document.documentElement.dataset.windowVisible = String(visible);
}

export function setReducedTransparency(reduce: boolean) {
  document.documentElement.dataset.reducedTransparency = String(reduce);
}
