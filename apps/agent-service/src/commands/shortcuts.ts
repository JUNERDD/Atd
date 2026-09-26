import {
  commandHoldingShortcut,
  commandShortcutHolder,
  effectiveAccelerator,
  parseAccelerator,
  type ShortcutBindingsWire,
} from '@ai/agent-contracts';
import { ConflictError } from '../errors.js';

/**
 * Command shortcut rules. The command store enforces them on every write, whichever client or
 * tool makes it; the settings routes enforce them when application shortcuts change. The service
 * runs on the machine whose desktop registers the shortcuts, so its own platform decides the
 * grammar and which accelerators collide.
 */

/** Application shortcut actions as the settings name them, for conflict messages. */
const APP_SHORTCUT_NAMES: Record<keyof ShortcutBindingsWire, string> = {
  togglePanel: 'Toggle panel',
  newConversation: 'New conversation',
  openSettings: 'Open settings',
  sendMessage: 'Send message',
  newLine: 'New line',
};

/** The command with its shortcut validated and in canonical form; no shortcut stays as it is. */
export function withCanonicalShortcut<T extends { shortcut?: string }>(command: T): T {
  if (!command.shortcut) return command;
  try {
    return { ...command, shortcut: parseAccelerator(command.shortcut, true, process.platform) };
  } catch {
    throw new TypeError(
      `"${command.shortcut}" is not a supported shortcut. Use an Electron accelerator that includes CommandOrControl, Command, Control, Alt or Super, such as CommandOrControl+Alt+S.`,
    );
  }
}

/**
 * Throws a ConflictError naming the application action or other enabled command that already
 * holds the shortcut of an enabled `command`. Another application holding it is only known when
 * the desktop registers it.
 */
export function assertShortcutFree(
  command: { id: string; enabled: boolean; shortcut: string },
  commands: ReadonlyArray<{ id: string; name: string; enabled: boolean; shortcut: string }>,
  appShortcuts: ShortcutBindingsWire,
): void {
  if (!command.enabled) return;
  const holder = commandShortcutHolder(command, appShortcuts, commands, process.platform);
  if (!holder) return;
  const owner =
    holder.kind === 'app'
      ? `the app shortcut "${APP_SHORTCUT_NAMES[holder.action]}"`
      : `the command "${holder.name}"`;
  throw new ConflictError(
    `The shortcut ${command.shortcut} is already used by ${owner}. Choose another combination.`,
  );
}

/**
 * Refuses application bindings that change an action to a shortcut an enabled command holds
 * (ConflictError). `next` is already valid (`parseShortcutBindings`). Unchanged actions are not
 * checked, so a save never fails over a conflict it did not make.
 */
export function assertAppShortcutsFree(
  next: ShortcutBindingsWire,
  previous: ShortcutBindingsWire,
  commands: ReadonlyArray<{ id: string; name: string; enabled: boolean; shortcut: string }>,
): void {
  for (const [action, value] of Object.entries(next) as Array<
    [keyof ShortcutBindingsWire, string]
  >) {
    if (
      effectiveAccelerator(value, process.platform) ===
      effectiveAccelerator(previous[action], process.platform)
    )
      continue;
    const holder = commandHoldingShortcut(value, commands, process.platform);
    if (holder)
      throw new ConflictError(
        `The shortcut ${value} for "${APP_SHORTCUT_NAMES[action]}" is already used by the command "${holder.name}". Choose another combination.`,
      );
  }
}
