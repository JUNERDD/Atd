/** The platform label the desktop shows for an accelerator; the grammar is in the contracts. */
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
