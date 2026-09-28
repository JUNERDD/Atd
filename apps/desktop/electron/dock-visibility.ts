import { app, BrowserWindow } from 'electron';

/** Electron ignores `dock.hide()` within a second of the previous Dock change. */
const HIDE_SPACING_MS = 1100;

/**
 * Applies the "Show in Dock" preference on macOS. Packaged builds start as an agent app
 * (`LSUIElement` in electron-builder.yml), so a hidden Dock icon never flashes at launch; showing
 * it turns the app into a regular one at runtime. Development builds start with the icon and hide
 * it once the preference loads. Changes run in order, so rapid toggles settle on the last one.
 */
export class DockVisibility {
  private queue: Promise<void> = Promise.resolve();
  private changedAt = 0;

  apply(show: boolean): Promise<void> {
    const dock = app.dock;
    if (process.platform !== 'darwin' || !dock) return Promise.resolve();
    const change = this.queue.then(async () => {
      if (dock.isVisible() === show) return;
      if (show) {
        await dock.show();
      } else {
        const wait = this.changedAt + HIDE_SPACING_MS - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        // Becoming an agent app deactivates it: the windows stay open but lose focus, so the
        // window the user toggled the preference in comes back to the front.
        const focused = BrowserWindow.getFocusedWindow();
        dock.hide();
        if (focused && !focused.isDestroyed()) {
          app.focus({ steal: true });
          focused.focus();
        }
      }
      this.changedAt = Date.now();
    });
    this.queue = change.catch(() => undefined);
    return change;
  }
}
