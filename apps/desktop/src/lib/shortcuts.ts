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
const recordedModifiers = new Set(['meta', 'ctrl', 'alt', 'shift']);

/** Converts validated Electron accelerators for useHotkeys with physical keys and delimiter "|". */
export function acceleratorToHotkey(accelerator: string, platform: string): string {
  const modifiers: Record<string, string> = {
    CommandOrControl: platform === 'darwin' ? 'meta' : 'ctrl',
    Command: 'meta',
    Control: 'ctrl',
    Super: 'meta',
    Alt: 'alt',
    Shift: 'shift',
  };
  return accelerator
    .split('+')
    .map((key) => modifiers[key] ?? hotkeyKeyNames.get(key) ?? key.toLowerCase())
    .join('+');
}

/** Converts useRecordHotkeys(false) tokens to the single-key subset supported by native settings. */
export function recordedKeysToAccelerator(
  keys: ReadonlySet<string>,
  platform: string,
): string | null {
  const nonModifiers = Array.from(keys).filter((key) => !recordedModifiers.has(key));
  if (nonModifiers.length !== 1) return null;
  const recorded = nonModifiers[0];
  if (!recorded) return null;
  const key =
    recordedKeyNames.get(recorded) ??
    (/^(?:[a-z0-9]|f(?:[1-9]|1\d|2[0-4]))$/.test(recorded) ? recorded.toUpperCase() : null);
  if (!key) return null;

  const modifiers: string[] = [];
  if (platform === 'darwin') {
    if (keys.has('meta')) modifiers.push('CommandOrControl');
    if (keys.has('ctrl')) modifiers.push('Control');
  } else {
    if (keys.has('ctrl')) modifiers.push('CommandOrControl');
    if (keys.has('meta')) modifiers.push('Super');
  }
  if (keys.has('alt')) modifiers.push('Alt');
  if (keys.has('shift')) modifiers.push('Shift');
  return [...modifiers, key].join('+');
}

export function shortcutKeys(accelerator: string, platform: string): string[] {
  const mac = platform === 'darwin';
  const labels: Record<string, string> = {
    CommandOrControl: mac ? '⌘' : 'Ctrl',
    Command: '⌘',
    Control: mac ? '⌃' : 'Ctrl',
    Super: mac ? '⌘' : platform === 'win32' ? 'Win' : 'Super',
    Alt: mac ? '⌥' : 'Alt',
    Shift: mac ? '⇧' : 'Shift',
    Enter: mac ? 'Return' : 'Enter',
    Up: '↑',
    Down: '↓',
    Left: '←',
    Right: '→',
  };
  return accelerator.split('+').map((key) => labels[key] ?? key);
}
