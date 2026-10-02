import type { ShortcutBindingsWire } from './workspace.js';

/**
 * Electron accelerator grammar and shortcut ownership rules, shared by the desktop (global
 * registration), the web client (validation before a save) and the service (the Agent's
 * `command` tool). `platform` is a Node platform name; the web client passes the OS it detected.
 */

/** The application shortcuts in effect while the shared settings hold none (`shortcuts: null`). */
export const DEFAULT_SHORTCUTS = {
  togglePanel: 'CommandOrControl+Shift+Space',
  captureScreenshot: 'CommandOrControl+Shift+2',
  newConversation: 'CommandOrControl+N',
  openSettings: 'CommandOrControl+,',
  sendMessage: 'Enter',
  newLine: 'Shift+Enter',
} as const satisfies ShortcutBindingsWire;

const MODIFIERS = ['CommandOrControl', 'Command', 'Control', 'Super', 'Alt', 'Shift'];
const SYMBOL_KEYS = new Set([',', '.', '/', ';', "'", '\\', '[', ']', '`', '-', '=']);
const NAMED_KEYS = new Set([
  'Space',
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

function effectiveModifier(modifier: string, platform: string): string {
  if (modifier === 'CommandOrControl') return platform === 'darwin' ? 'Command' : 'Control';
  if (modifier === 'Super' && platform === 'darwin') return 'Command';
  return modifier;
}

/** Validates an accelerator for `platform` and answers it with its modifiers in canonical order. */
export function parseAccelerator(
  value: unknown,
  requireModifier: boolean,
  platform: string,
): string {
  if (typeof value !== 'string' || value.length > 100) throw new TypeError('Invalid shortcut.');
  const parts = value.split('+');
  const key = parts.pop();
  if (
    !key ||
    !(
      /^[A-Z0-9]$/.test(key) ||
      SYMBOL_KEYS.has(key) ||
      /^F(?:[1-9]|1\d|2[0-4])$/.test(key) ||
      NAMED_KEYS.has(key)
    ) ||
    parts.some((part) => !MODIFIERS.includes(part)) ||
    (platform !== 'darwin' && parts.includes('Command')) ||
    new Set(parts.map((part) => effectiveModifier(part, platform))).size !== parts.length ||
    (requireModifier && !parts.some((part) => part !== 'Shift'))
  ) {
    throw new TypeError(
      'Use a supported key combination with a modifier for navigation shortcuts.',
    );
  }
  return [...MODIFIERS.filter((modifier) => parts.includes(modifier)), key].join('+');
}

/** The keys an accelerator presses on `platform`; equal values collide when registered. */
export function effectiveAccelerator(shortcut: string, platform: string): string {
  const parts = shortcut.split('+');
  const key = parts.pop();
  return [...parts.map((part) => effectiveModifier(part, platform)).sort(), key].join('+');
}

/**
 * Validates application bindings for `platform`: every action present, each accelerator valid
 * (navigation actions need a modifier), no two pressing the same keys. Answers them canonical.
 */
export function parseShortcutBindings(value: unknown, platform: string): ShortcutBindingsWire {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== Object.keys(DEFAULT_SHORTCUTS).length ||
    !('togglePanel' in value) ||
    !('captureScreenshot' in value) ||
    !('newConversation' in value) ||
    !('openSettings' in value) ||
    !('sendMessage' in value) ||
    !('newLine' in value)
  ) {
    throw new TypeError('Invalid shortcut settings.');
  }
  const shortcuts = {
    togglePanel: parseAccelerator(value.togglePanel, true, platform),
    captureScreenshot: parseAccelerator(value.captureScreenshot, true, platform),
    newConversation: parseAccelerator(value.newConversation, true, platform),
    openSettings: parseAccelerator(value.openSettings, true, platform),
    sendMessage: parseAccelerator(value.sendMessage, false, platform),
    newLine: parseAccelerator(value.newLine, false, platform),
  };
  const effective = Object.values(shortcuts).map((value) => effectiveAccelerator(value, platform));
  if (new Set(effective).size !== effective.length) {
    throw new TypeError('Each action needs a different shortcut.');
  }
  return shortcuts;
}

/** A saved command as the shortcut rules read it. */
interface ShortcutCommand {
  id: string;
  name: string;
  enabled: boolean;
  shortcut: string;
}

/**
 * The enabled command, other than the one with `exceptId`, whose shortcut presses the same keys
 * as `shortcut` on `platform`; undefined when none does.
 */
export function commandHoldingShortcut(
  shortcut: string,
  commands: ReadonlyArray<ShortcutCommand>,
  platform: string,
  exceptId?: string,
): ShortcutCommand | undefined {
  const pressed = effectiveAccelerator(shortcut, platform);
  return commands.find(
    (item) =>
      item.id !== exceptId &&
      item.enabled &&
      item.shortcut &&
      effectiveAccelerator(item.shortcut, platform) === pressed,
  );
}

/** What already holds a command shortcut. */
export type ShortcutHolder =
  | { kind: 'app'; action: keyof ShortcutBindingsWire }
  | { kind: 'command'; id: string; name: string };

/**
 * The application action or other enabled command that already holds `command.shortcut` on
 * `platform`, or null when it is free (or the command has no shortcut). Only the OS can tell
 * whether another application holds it; the desktop learns that when it registers the shortcut.
 */
export function commandShortcutHolder(
  command: { id: string; shortcut: string },
  appShortcuts: ShortcutBindingsWire,
  commands: ReadonlyArray<ShortcutCommand>,
  platform: string,
): ShortcutHolder | null {
  if (!command.shortcut) return null;
  const pressed = effectiveAccelerator(command.shortcut, platform);
  for (const [action, value] of Object.entries(appShortcuts) as Array<
    [keyof ShortcutBindingsWire, string]
  >)
    if (effectiveAccelerator(value, platform) === pressed) return { kind: 'app', action };
  const other = commandHoldingShortcut(command.shortcut, commands, platform, command.id);
  return other ? { kind: 'command', id: other.id, name: other.name } : null;
}
