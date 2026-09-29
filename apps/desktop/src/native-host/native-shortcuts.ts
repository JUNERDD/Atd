import type { PreparedCommand } from '../../electron/agent/bridge';
import { readyToRun } from '../../electron/agent/command-validation';
import { errorMessage } from '../../electron/agent/validation';
import type { NativeBridge } from '../native-bridge/client';
import { PANEL_SHORTCUT_ID, type ShortcutResult } from '../native-bridge/contract';
import type { NativeCommands } from './native-commands';

type RegistrationFailure = Extract<ShortcutResult, { registered: false }>['reason'];

const REGISTRATION_ERRORS: Record<RegistrationFailure, string> = {
  unavailable: 'This global shortcut is unavailable. Choose another combination.',
  invalid: 'This shortcut cannot be registered on this Mac. Choose another combination.',
};

export interface ShortcutSync {
  /** Pushes the current set; calls made while one is in flight collapse into one more push. */
  sync(): void;
}

/**
 * The panel's side of the global shortcuts. The shell registers whatever set the panel pushes (the
 * panel shortcut plus each enabled command's shortcut) and reports every item; conflicts between
 * the app's own shortcuts stay with the service and the settings checks. A command shortcut
 * arrives as `{ id }` after the shell captured the selection and showed the panel, and runs as the
 * desktop's does: prepared with the capture expected, then launched.
 */
export function nativeShortcuts(
  bridge: NativeBridge,
  commands: NativeCommands,
  host: {
    panelShortcut: () => string;
    /** Every push result: whether the panel shortcut holds, after `commands.errors` changed. */
    applied: (panelAvailable: boolean) => void;
    launch: (prepared: PreparedCommand, autoRun: boolean) => void;
  },
): ShortcutSync {
  let running = false;
  let again = false;

  async function push() {
    const list = commands.list();
    const { results } = await bridge.call('shortcuts.set', {
      registrations: [
        { id: PANEL_SHORTCUT_ID, accelerator: host.panelShortcut() },
        ...list
          .filter((command) => command.enabled && command.shortcut)
          .map((command) => ({ id: command.id, accelerator: command.shortcut })),
      ],
      selectionWanted: list.some((command) => command.enabled && command.input.selection),
    });
    let panelAvailable = false;
    for (const id of Object.keys(commands.errors)) delete commands.errors[id];
    for (const result of results) {
      if (result.id === PANEL_SHORTCUT_ID) panelAvailable = result.registered;
      else if (!result.registered) commands.errors[result.id] = REGISTRATION_ERRORS[result.reason];
    }
    host.applied(panelAvailable);
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
      .then((prepared) =>
        host.launch(prepared, !prepared.notice && readyToRun(prepared.command, prepared.input)),
      )
      .catch((error: unknown) => {
        commands.errors[id] = errorMessage(error);
      });
  });

  return { sync: () => void run() };
}
