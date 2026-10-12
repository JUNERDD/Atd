import { doubleTapModifier } from '@atd/agent-contracts';
import type { CommandLaunch } from '../client/agent/bridge';
import { argumentOverrides } from '../client/agent/command-arguments';
import { runsAsIs } from '../client/agent/command-prepare';
import { withOutputAction } from '../client/agent/run-output';
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

/** The shell watches the keyboard for a double-tap only with Accessibility access. */
const DOUBLE_TAP_UNAVAILABLE =
  'Double-tap shortcuts need Accessibility access. Allow Atd in System Settings › Privacy & Security › Accessibility.';

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
 * command shortcut arrives as `{ id, target?, arguments?, intent? }` after the shell captured the
 * selection, and is prepared with the capture expected and the shell's picks over the remembered
 * values, carrying the write target along; the answer goes where the shell's pick says for this
 * run, else where the command's saved output says. Then by `intent`: `run` (or none) launches it
 * as the desktop's shortcut does, running it when it can be used as-is; `edit` shows its input
 * step and never runs it; `choose` asks the panel to offer its options first
 * (`CommandLaunch.choose`). The screenshot shortcut is the panel page's to run
 * (`DesktopBridge.onScreenshotShortcut`).
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
    launch: (launch: CommandLaunch) => void;
  },
): ShortcutSync {
  let running = false;
  let again = false;
  /** The set the shell last took; an identical set is not pushed again. */
  let pushed = '';
  /** The shell's answer to that set, shared with settings windows; null before the first. */
  let state: Extract<WindowMessage, { type: 'shortcutState' }> | null = null;
  /** The shell's Accessibility trust, which a double-tap needs; null before it reports it. */
  let trusted: boolean | null = null;
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
    const doubleTaps = new Set(
      params.registrations.flatMap(({ id, accelerator }) =>
        doubleTapModifier(accelerator) ? [id] : [],
      ),
    );
    const available: GlobalShortcutState = { panelAvailable: false, screenshotAvailable: false };
    for (const id of Object.keys(commands.errors)) delete commands.errors[id];
    for (const result of results) {
      if (result.id === PANEL_SHORTCUT_ID) available.panelAvailable = result.registered;
      else if (result.id === SCREENSHOT_SHORTCUT_ID)
        available.screenshotAvailable = result.registered;
      else if (!result.registered)
        commands.errors[result.id] =
          result.reason === 'unavailable' && doubleTaps.has(result.id) && trusted === false
            ? DOUBLE_TAP_UNAVAILABLE
            : REGISTRATION_ERRORS[result.reason];
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

  // A double-tap registers only with Accessibility access, which the shell re-applies as it
  // changes; pushing again learns the new answer for the settings and the command errors.
  bridge.on('accessibility.trust', ({ trusted: now }) => {
    if (trusted !== null && trusted !== now) {
      pushed = '';
      void run();
    }
    trusted = now;
  });

  // The target is the field the summon found focused in another app; a write-back output writes
  // the answer there once the run completes.
  bridge.on('shortcut.command', ({ id, target, arguments: picked, intent = 'run' }) => {
    // Async, so a throw (`find` of a deleted command) rejects into the catch below.
    void (async () =>
      commands.prepare(id, true, picked && argumentOverrides(commands.find(id), picked)))()
      .then((prepared) => {
        const launched = withOutputAction(
          target ? { ...prepared, target } : prepared,
          picked?.output,
        );
        if (intent === 'run') host.launch({ prepared: launched, autoRun: runsAsIs(launched) });
        else
          host.launch({
            prepared: launched,
            autoRun: false,
            ...(intent === 'choose' ? { choose: true as const } : {}),
          });
      })
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
