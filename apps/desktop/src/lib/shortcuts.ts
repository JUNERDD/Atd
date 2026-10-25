import { doubleTapModifier } from '@atd/agent-contracts';
import { parseHotkey, type HotkeyChord } from '@tanstack/react-hotkeys';

const recordedKeyNames = new Map([
  ['comma', ','],
  ['period', '.'],
  ['slash', '/'],
  ['semicolon', ';'],
  ['quote', "'"],
  ['backslash', '\\'],
  ['bracketleft', '['],
  ['bracketright', ']'],
  ['backquote', '`'],
  ['minus', '-'],
  ['equal', '='],
  ['space', 'Space'],
  ['enter', 'Enter'],
  ['tab', 'Tab'],
  ['backspace', 'Backspace'],
  ['delete', 'Delete'],
  ['arrowup', 'Up'],
  ['arrowdown', 'Down'],
  ['arrowleft', 'Left'],
  ['arrowright', 'Right'],
  ['home', 'Home'],
  ['end', 'End'],
  ['pageup', 'PageUp'],
  ['pagedown', 'PageDown'],
]);
const hotkeyKeyNames = new Map(
  Array.from(recordedKeyNames, ([recorded, accelerator]) => [accelerator, recorded]),
);

/**
 * Converts validated Electron accelerators for useHotkeys with physical keys and delimiter "|".
 * A double-tap (`DoubleTap+Command`) answers its modifier twice (`meta+meta`): only the shell
 * detects double-taps, so no in-page binding uses one, and held-key displays read both caps.
 */
export function acceleratorToHotkey(accelerator: string, platform: string): string {
  const modifiers: Record<string, string> = {
    CommandOrControl: platform === 'darwin' ? 'meta' : 'ctrl',
    Command: 'meta',
    Control: 'ctrl',
    Super: 'meta',
    Alt: 'alt',
    Shift: 'shift',
  };
  const tapped = doubleTapModifier(accelerator);
  if (tapped) return `${modifiers[tapped]}+${modifiers[tapped]}`;
  return accelerator
    .split('+')
    .map((key) => modifiers[key] ?? hotkeyKeyNames.get(key) ?? key.toLowerCase())
    .join('+');
}

/**
 * Matches a keydown against a validated Electron accelerator the way `useHotkeys` does with
 * `useKey: false`: by physical key (`event.code`), with exactly the accelerator's modifiers.
 */
export function matchesAccelerator(
  event: Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  accelerator: string,
  platform: string,
): boolean {
  const keys = acceleratorToHotkey(accelerator, platform).split('+');
  const key = keys.pop();
  return (
    key === event.code.toLowerCase().replace(/key|digit|numpad/, '') &&
    event.metaKey === keys.includes('meta') &&
    event.ctrlKey === keys.includes('ctrl') &&
    event.altKey === keys.includes('alt') &&
    event.shiftKey === keys.includes('shift')
  );
}

/** Converts a recorded physical chord to the single-key subset the native shell supports. */
export function recordedHotkeyToAccelerator(hotkey: HotkeyChord, platform: string): string | null {
  const chord = parseHotkey(hotkey, platform === 'darwin' ? 'mac' : 'windows');
  if (!chord.code) return null;
  const recorded = chord.code.toLowerCase().replace(/^(?:key|digit|numpad)/, '');
  const key =
    recordedKeyNames.get(recorded) ??
    (/^(?:[a-z0-9]|f(?:[1-9]|1\d|2[0-4]))$/.test(recorded) ? recorded.toUpperCase() : null);
  if (!key) return null;

  const modifiers: string[] = [];
  if (platform === 'darwin') {
    if (chord.meta) modifiers.push('CommandOrControl');
    if (chord.ctrl) modifiers.push('Control');
  } else {
    if (chord.ctrl) modifiers.push('CommandOrControl');
    if (chord.meta) modifiers.push('Super');
  }
  if (chord.alt) modifiers.push('Alt');
  if (chord.shift) modifiers.push('Shift');
  return [...modifiers, key].join('+');
}

/** The keycap labels of an accelerator; a double-tap shows its modifier twice (⌘ ⌘). */
export function shortcutKeys(accelerator: string, platform: string): string[] {
  const tapped = doubleTapModifier(accelerator);
  if (tapped) return shortcutKeys(tapped, platform).flatMap((label) => [label, label]);
  const mac = platform === 'darwin';
  const labels: Record<string, string> = {
    CommandOrControl: mac ? '⌘' : 'Ctrl',
    Command: '⌘',
    Control: mac ? '⌃' : 'Ctrl',
    Super: mac ? '⌘' : platform === 'win32' ? 'Win' : 'Super',
    Alt: mac ? '⌥' : 'Alt',
    Shift: mac ? '⇧' : 'Shift',
    Enter: mac ? 'Return' : 'Enter',
    Escape: mac ? '⎋' : 'Esc',
    Up: '↑',
    Down: '↓',
    Left: '←',
    Right: '→',
  };
  return accelerator.split('+').map((key) => labels[key] ?? key);
}
