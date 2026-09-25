import { DEFAULT_SHORTCUTS, type ShortcutBindings } from './settings-contract';

/**
 * Electron accelerator grammar shared by the desktop (global registration) and the web client
 * (validation before a save reaches the service). `platform` is a Node platform name; the web
 * client passes the OS it detected.
 */

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

export function effectiveAccelerator(shortcut: string, platform: string): string {
  const parts = shortcut.split('+');
  const key = parts.pop();
  return [...parts.map((part) => effectiveModifier(part, platform)).sort(), key].join('+');
}

export function parseShortcutBindings(value: unknown, platform: string): ShortcutBindings {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== Object.keys(DEFAULT_SHORTCUTS).length ||
    !('togglePanel' in value) ||
    !('newConversation' in value) ||
    !('openSettings' in value) ||
    !('sendMessage' in value) ||
    !('newLine' in value)
  ) {
    throw new TypeError('Invalid shortcut settings.');
  }
  const shortcuts = {
    togglePanel: parseAccelerator(value.togglePanel, true, platform),
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

export function shortcutLabel(accelerator: string, platform: string): string {
  const labels: Record<string, string> =
    platform === 'darwin'
      ? { CommandOrControl: '⌘', Command: '⌘', Control: '⌃', Super: '⌘', Alt: '⌥', Shift: '⇧' }
      : {
          CommandOrControl: 'Ctrl',
          Control: 'Ctrl',
          Super: platform === 'win32' ? 'Win' : 'Super',
          Alt: 'Alt',
          Shift: 'Shift',
        };
  return accelerator
    .split('+')
    .map((part) => labels[part] ?? part)
    .join(platform === 'darwin' ? ' ' : ' + ');
}
