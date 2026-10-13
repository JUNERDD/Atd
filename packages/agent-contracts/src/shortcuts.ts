import type {
  SelectionToolbarKey,
  SelectionToolbarSettings,
  ShortcutBindingsWire,
} from './workspace.js';

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

/**
 * Modifiers a double-tap shortcut can use, as `DoubleTap+<Modifier>` spells them. The form is
 * canonical as written, so it only ever collides with the identical double-tap.
 */
export const DOUBLE_TAP_MODIFIERS = ['Command', 'Alt', 'Control', 'Shift'] as const;
export type DoubleTapModifier = (typeof DOUBLE_TAP_MODIFIERS)[number];
const DOUBLE_TAP_PREFIX = 'DoubleTap+';

/** The modifier a `DoubleTap+<Modifier>` accelerator taps twice; null for any other value. */
export function doubleTapModifier(accelerator: string): DoubleTapModifier | null {
  if (!accelerator.startsWith(DOUBLE_TAP_PREFIX)) return null;
  const modifier = accelerator.slice(DOUBLE_TAP_PREFIX.length);
  return DOUBLE_TAP_MODIFIERS.find((item) => item === modifier) ?? null;
}

/** The modifier each selection toolbar activation key taps. */
const TOOLBAR_TAP_MODIFIERS: Record<SelectionToolbarKey, DoubleTapModifier> = {
  option: 'Alt',
  command: 'Command',
  shift: 'Shift',
};

/** The selection toolbar settings that decide which gesture it watches. */
export type SelectionToolbarGesture = Pick<
  SelectionToolbarSettings,
  'activation' | 'activationKeys'
>;

/**
 * The double-tap the selection toolbar's `toggle` mode turns on and off with, as an accelerator
 * (`DoubleTap+Alt`): it watches one key pressed twice on its own, the same gesture as that
 * double-tap shortcut. Null in `hold` and `always`, and for a combination of keys, which no
 * shortcut can press. Whether the toolbar is switched on does not matter: its gesture stays
 * reserved, so switching it on never makes a conflict.
 */
export function selectionToolbarDoubleTap(toolbar: SelectionToolbarGesture): string | null {
  const [key, ...others] = toolbar.activationKeys;
  return toolbar.activation === 'toggle' && key && others.length === 0
    ? `${DOUBLE_TAP_PREFIX}${TOOLBAR_TAP_MODIFIERS[key]}`
    : null;
}

/** How a caller registers the shortcut it validates. */
export interface AcceleratorOptions {
  /**
   * The shortcut is one the macOS shell registers globally (the panel and screenshot shortcuts,
   * command shortcuts), which alone can detect a double-tap of a lone modifier. Only then, and
   * only on `darwin`, is `DoubleTap+<Modifier>` accepted.
   */
  allowDoubleTap?: boolean;
}

/** Validates an accelerator for `platform` and answers it with its modifiers in canonical order. */
export function parseAccelerator(
  value: unknown,
  requireModifier: boolean,
  platform: string,
  options: AcceleratorOptions = {},
): string {
  if (typeof value !== 'string' || value.length > 100) throw new TypeError('Invalid shortcut.');
  if (options.allowDoubleTap && platform === 'darwin' && doubleTapModifier(value)) return value;
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

/**
 * The keys an accelerator presses on `platform`; equal values collide when registered. A
 * double-tap answers itself, so it collides only with the same double-tap.
 */
export function effectiveAccelerator(shortcut: string, platform: string): string {
  if (doubleTapModifier(shortcut)) return shortcut;
  const parts = shortcut.split('+');
  const key = parts.pop();
  return [...parts.map((part) => effectiveModifier(part, platform)).sort(), key].join('+');
}

/**
 * Validates application bindings for `platform`: every action present, each accelerator valid
 * (navigation actions need a modifier; only the global ones may be a double-tap), no two pressing
 * the same keys. Answers them canonical.
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
  // Only the shell's global shortcuts can be double-taps; the page handles the others.
  const global = { allowDoubleTap: true };
  const shortcuts = {
    togglePanel: parseAccelerator(value.togglePanel, true, platform, global),
    captureScreenshot: parseAccelerator(value.captureScreenshot, true, platform, global),
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

/**
 * What already holds a shortcut: an application action, an enabled command, or the gesture the
 * selection toolbar's `toggle` mode watches (`selectionToolbarDoubleTap`).
 */
export type ShortcutHolder =
  | { kind: 'app'; action: keyof ShortcutBindingsWire }
  | { kind: 'command'; id: string; name: string }
  | { kind: 'selectionToolbar' };

/**
 * The application action, else the enabled command other than `exceptCommandId`, that presses
 * the same keys as `shortcut` on `platform`; null when neither does. For the selection toolbar's
 * own gesture, and as the shared part of `commandShortcutHolder`.
 */
export function shortcutHolder(
  shortcut: string,
  appShortcuts: ShortcutBindingsWire,
  commands: ReadonlyArray<ShortcutCommand>,
  platform: string,
  exceptCommandId?: string,
): Exclude<ShortcutHolder, { kind: 'selectionToolbar' }> | null {
  const pressed = effectiveAccelerator(shortcut, platform);
  for (const [action, value] of Object.entries(appShortcuts) as Array<
    [keyof ShortcutBindingsWire, string]
  >)
    if (effectiveAccelerator(value, platform) === pressed) return { kind: 'app', action };
  const other = commandHoldingShortcut(shortcut, commands, platform, exceptCommandId);
  return other ? { kind: 'command', id: other.id, name: other.name } : null;
}

/**
 * The application action, the selection toolbar's double-tap or another enabled command that
 * already holds `command.shortcut` on `platform` (in that order), or null when it is free (or the
 * command has no shortcut). Only the OS can tell whether another application holds it; the
 * desktop learns that when it registers the shortcut.
 */
export function commandShortcutHolder(
  command: { id: string; shortcut: string },
  appShortcuts: ShortcutBindingsWire,
  commands: ReadonlyArray<ShortcutCommand>,
  platform: string,
  selectionToolbar: SelectionToolbarGesture,
): ShortcutHolder | null {
  if (!command.shortcut) return null;
  const holder = shortcutHolder(command.shortcut, appShortcuts, commands, platform, command.id);
  if (holder?.kind === 'app') return holder;
  if (command.shortcut === selectionToolbarDoubleTap(selectionToolbar))
    return { kind: 'selectionToolbar' };
  return holder;
}
