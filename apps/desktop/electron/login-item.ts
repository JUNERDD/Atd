import { app, shell } from 'electron';
import type { BrowserWindow } from 'electron';

/** System Settings › General › Login Items, where macOS asks the user to approve a login item. */
const LOGIN_ITEMS_SETTINGS = 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension';

/**
 * Windows has no "opened at login" flag, so the Run key entry launches with this argument. The
 * same `args` must be passed when reading the entry back, or it reads as off.
 */
const OPENED_AT_LOGIN_ARG = '--opened-at-login';
const LOGIN_ITEM_OPTIONS = process.platform === 'win32' ? { args: [OPENED_AT_LOGIN_ARG] } : {};

/** True when the OS started this launch as a login item; the panel then stays hidden. */
export function openedAtLogin(): boolean {
  if (process.platform === 'darwin') return app.getLoginItemSettings().wasOpenedAtLogin === true;
  if (process.platform === 'win32') return process.argv.includes(OPENED_AT_LOGIN_ARG);
  return false;
}

/**
 * The "Open at login" preference. The OS login item is its only record — nothing goes into the
 * settings file — so a change made in System Settings or Windows' startup apps is what the switch
 * shows after the next read. Only packaged macOS and Windows builds offer it: a development build
 * would register the bare Electron binary, and Linux has no login item API in Electron.
 */
export class LoginItem {
  private readonly supported =
    app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32');
  private state: boolean | null = null;

  /**
   * Reads the state once and re-reads it whenever the settings window regains focus, so an item
   * approved or removed in System Settings shows when the user comes back; `changed` then
   * broadcasts the snapshot. Constructed once, after the app is ready.
   */
  constructor(
    private readonly settingsWindow: () => BrowserWindow | null,
    private readonly changed: () => void,
  ) {
    this.refresh();
    if (!this.supported) return;
    app.on('browser-window-focus', (_event, window) => {
      if (window === this.settingsWindow() && this.refresh()) this.changed();
    });
  }

  /** The last read state; null where opening at login is unavailable. */
  get current(): boolean | null {
    return this.state;
  }

  /** Re-reads the OS login item and reports whether the state changed. */
  private refresh(): boolean {
    if (!this.supported) return false;
    const previous = this.state;
    const settings = app.getLoginItemSettings(LOGIN_ITEM_OPTIONS);
    // macOS 13+ keeps a newly registered item off until the user approves it.
    this.state = settings.openAtLogin && settings.status !== 'requires-approval';
    return this.state !== previous;
  }

  /**
   * Registers or removes the login item and returns the applied state. An item macOS holds for
   * approval reads as off and opens Login Items in System Settings; the focus re-read picks up the
   * approval. Any other enable the OS did not apply rejects.
   */
  async set(value: unknown): Promise<boolean> {
    if (typeof value !== 'boolean') throw new TypeError('Open at login must be a boolean');
    if (!this.supported) throw new Error('Opening at login needs the installed desktop app.');
    app.setLoginItemSettings({ openAtLogin: value, ...LOGIN_ITEM_OPTIONS });
    this.refresh();
    this.changed();
    const applied = this.state === true;
    if (value && !applied) {
      if (app.getLoginItemSettings(LOGIN_ITEM_OPTIONS).status !== 'requires-approval') {
        throw new Error('The system did not add AI to the login items.');
      }
      await shell.openExternal(LOGIN_ITEMS_SETTINGS);
    }
    return applied;
  }
}
