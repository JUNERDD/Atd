/**
 * Window state on the root element for styles: `data-window-active="false"` turns the glass
 * surfaces into their dimmed fill (`surface-glass` in `@ai/ui`), and `data-window-visible="false"`
 * marks a panel the shell hid at alpha 0, which keeps running. Unset reads as active and visible.
 */
export function setWindowActive(active: boolean) {
  document.documentElement.dataset.windowActive = String(active);
}

export function setWindowVisible(visible: boolean) {
  document.documentElement.dataset.windowVisible = String(visible);
}

/** Electron: the document has focus exactly while its window is the key window. */
export function followDocumentFocus(): () => void {
  const update = () => setWindowActive(document.hasFocus());
  window.addEventListener('focus', update);
  window.addEventListener('blur', update);
  update();
  return () => {
    window.removeEventListener('focus', update);
    window.removeEventListener('blur', update);
  };
}
