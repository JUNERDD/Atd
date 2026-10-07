import type { PreparedCommand } from '../client/agent/bridge';
import { runsAsIs } from '../client/agent/command-prepare';
import { errorMessage } from '../client/agent/validation';
import type { NativeBridge, ShortcutResult } from '../native-bridge/client';
import { PANEL_SHORTCUT_ID, SCREENSHOT_SHORTCUT_ID } from '../native-bridge/calls';
import type { NativeCommands } from './native-commands';
import type { WindowMessage, WindowMessages } from './window-messages';

type RegistrationFailure = Extract<ShortcutResult, { registered: false }>['reason'];

/** Whether the shell holds each of the app's own global shortcuts. */
export interface GlobalShortcutState {
  panelAvailable: boolean;
  screenshotAvailable: boolean;
}

const REGISTRATION_ERRORS: Record<RegistrationFailure, string> = {
  unavailable: 'This global shortcut is unavailable. Choose another combination.',
  invalid: 'This shortcut cannot be registered on this Mac. Choose another combination.',
};

export interface ShortcutSync {
  /**
   * Pushes the current set when it changed, or always with `force` (a command changed, so its
   * registration error must be reported again). Calls made while one is in flight collapse into
   * one more push.
   */
  sync(force?: boolean): void;
}

/**
 * The panel's side of the global shortcuts. The shell registers whatever set the panel pushes (the
 * panel and screenshot shortcuts plus each enabled command's shortcut) and reports every item;
 * conflicts between the app's own shortcuts stay with the service and the settings checks. A
 * command shortcut arrives as `{ id }` after the shell captured the selection and showed the
 * panel, and runs as the desktop's does: prepared with the capture expected, then launched. The
 * screenshot shortcut is the panel page's to run (`DesktopBridge.onScreenshotShortcut`).
 */
export function nativeShortcuts(
  bridge: NativeBridge,
  commands: NativeCommands,
  messages: WindowMessages,
  host: {
    /** The app's global accelerators, or null while the service's settings have not loaded. */
    appShortcuts: () => { togglePanel: string; captureScreenshot: string } | null;
    /** Every push result: which app shortcuts hold, after `commands.errors` changed. */
    applied: (state: GlobalShortcutState) => void;
    launch: (prepared: PreparedCommand, autoRun: boolean) => void;
  },
): ShortcutSync {
  let running = false;
  let again = false;
  /** The set the shell last took; an identical set is not pushed again. */
  let pushed = '';
  /** The shell's answer to that set, shared with settings windows; null before the first. */
  let state: Extract<WindowMessage, { type: 'shortcutState' }> | null = null;
  messages.listen((message) => {
    if (message.type === 'shortcutStateRequest' && state) messages.post(state);
  });

  async function push() {
    const app = host.appShortcuts();
    if (app === null) return;
    const list = commands.list();
    const params = {
      registrations: [
        { id: PANEL_SHORTCUT_ID, accelerator: app.togglePanel },
        { id: SCREENSHOT_SHORTCUT_ID, accelerator: app.captureScreenshot },
        ...list
          .filter((command) => command.enabled && command.shortcut)
          .map((command) => ({ id: command.id, accelerator: command.shortcut })),
      ],
      selectionWanted: list.some((command) => command.enabled && command.input.selection),
    };
    const signature = JSON.stringify(params);
    if (signature === pushed) return;
    const { results } = await bridge.call('shortcuts.set', params);
    pushed = signature;
    const available: GlobalShortcutState = { panelAvailable: false, screenshotAvailable: false };
    for (const id of Object.keys(commands.errors)) delete commands.errors[id];
    for (const result of results) {
      if (result.id === PANEL_SHORTCUT_ID) available.panelAvailable = result.registered;
      else if (result.id === SCREENSHOT_SHORTCUT_ID)
        available.screenshotAvailable = result.registered;
      else if (!result.registered) commands.errors[result.id] = REGISTRATION_ERRORS[result.reason];
    }
    host.applied(available);
    state = { type: 'shortcutState', ...available, errors: { ...commands.errors } };
    messages.post(state);
  }

  async function run() {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await push().catch((error: unknown) => {
          console.error('The native shell did not take the shortcut set:', error);
        });
      } while (again);
    } finally {
      running = false;
    }
  }

  bridge.on('shortcut.command', ({ id }) => {
    void commands
      .prepare(id, true)
      .then((prepared) => host.launch(prepared, runsAsIs(prepared)))
      .catch((error: unknown) => {
        commands.errors[id] = errorMessage(error);
      });
  });

  return {
    sync: (force = false) => {
      if (force) pushed = '';
      void run();
    },
  };
}

/**
 * A settings window's side of the registration results: it never pushes a set, so it takes the
 * panel's answers into its own command errors and reports which app shortcuts hold.
 */
export function followShortcutState(
  messages: WindowMessages,
  commands: NativeCommands,
  applied: (state: GlobalShortcutState) => void,
): void {
  messages.listen((message) => {
    if (message.type !== 'shortcutState') return;
    for (const id of Object.keys(commands.errors)) delete commands.errors[id];
    Object.assign(commands.errors, message.errors);
    applied({
      panelAvailable: message.panelAvailable,
      screenshotAvailable: message.screenshotAvailable,
    });
  });
  messages.post({ type: 'shortcutStateRequest' });
}
