import { globalShortcut } from 'electron';
import { DEFAULT_SHORTCUTS, type ShortcutBindings } from './settings-contract';

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

function effectiveModifier(modifier: string): string {
  if (modifier === 'CommandOrControl') return process.platform === 'darwin' ? 'Command' : 'Control';
  if (modifier === 'Super' && process.platform === 'darwin') return 'Command';
  return modifier;
}

function parseAccelerator(value: unknown, requireModifier: boolean): string {
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
    (process.platform !== 'darwin' && parts.includes('Command')) ||
    new Set(parts.map(effectiveModifier)).size !== parts.length ||
    (requireModifier && !parts.some((part) => part !== 'Shift'))
  ) {
    throw new TypeError(
      'Use a supported key combination with a modifier for navigation shortcuts.',
    );
  }
  return [...MODIFIERS.filter((modifier) => parts.includes(modifier)), key].join('+');
}

function effectiveAccelerator(shortcut: string): string {
  const parts = shortcut.split('+');
  const key = parts.pop();
  return [...parts.map(effectiveModifier).sort(), key].join('+');
}

export function parseShortcutBindings(value: unknown): ShortcutBindings {
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
    togglePanel: parseAccelerator(value.togglePanel, true),
    newConversation: parseAccelerator(value.newConversation, true),
    openSettings: parseAccelerator(value.openSettings, true),
    sendMessage: parseAccelerator(value.sendMessage, false),
    newLine: parseAccelerator(value.newLine, false),
  };
  const effective = Object.values(shortcuts).map(effectiveAccelerator);
  if (new Set(effective).size !== effective.length) {
    throw new TypeError('Each action needs a different shortcut.');
  }
  return shortcuts;
}

export function shortcutLabel(accelerator: string): string {
  const labels: Record<string, string> =
    process.platform === 'darwin'
      ? { CommandOrControl: '⌘', Command: '⌘', Control: '⌃', Super: '⌘', Alt: '⌥', Shift: '⇧' }
      : {
          CommandOrControl: 'Ctrl',
          Control: 'Ctrl',
          Super: process.platform === 'win32' ? 'Win' : 'Super',
          Alt: 'Alt',
          Shift: 'Shift',
        };
  return accelerator
    .split('+')
    .map((part) => labels[part] ?? part)
    .join(process.platform === 'darwin' ? ' ' : ' + ');
}

export class PanelShortcut {
  private accelerator = '';
  available = false;

  constructor(private readonly toggle: () => void) {}

  private register(accelerator: string): boolean {
    try {
      return globalShortcut.register(accelerator, this.toggle);
    } catch {
      return false;
    }
  }

  initialize(accelerator: string) {
    this.accelerator = accelerator;
    this.available = this.register(accelerator);
  }

  async replace(accelerator: string, persist: () => Promise<void>) {
    if (
      this.available &&
      effectiveAccelerator(accelerator) === effectiveAccelerator(this.accelerator)
    ) {
      await persist();
      this.accelerator = accelerator;
      return;
    }
    if (!this.register(accelerator)) {
      throw new Error('That global shortcut is unavailable. Choose another combination.');
    }
    // Keep the old registration until the replacement is safely persisted.
    try {
      await persist();
    } catch (error) {
      globalShortcut.unregister(accelerator);
      throw error;
    }
    if (this.available) globalShortcut.unregister(this.accelerator);
    this.accelerator = accelerator;
    this.available = true;
  }
}
