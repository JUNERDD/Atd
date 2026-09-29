import type { EditCommand } from '../client/contract';

/**
 * Runs Edit → Undo/Redo from the application menu (Electron's, or the macOS shell's through the
 * `edit.command` event). A focused CodeMirror editor with history moves its own history: the
 * engine's native undo stack (Blink's, WebKit's) never sees the edits CodeMirror handles itself,
 * and running the native command inside the editor would rewrite its document behind its back.
 * Anywhere else (inputs, textareas) the native editing command runs, as the menu role did.
 *
 * CodeMirror loads lazily: a window that never mounted an editor (the settings window until the
 * command editor opens) has no `.cm-editor` to find, so it never fetches the editor packages. A
 * focused editor means they are already loaded, and the import resolves from the module cache.
 */
export function runEditCommand(command: EditCommand): void {
  const host = document.activeElement?.closest('.cm-editor');
  if (!(host instanceof HTMLElement)) {
    document.execCommand(command);
    return;
  }
  void import('./editor-history').then(({ runEditorHistory }) => {
    if (!runEditorHistory(host, command)) document.execCommand(command);
  });
}

/** Routes the application menu's edit commands in this window; returns the unsubscribe. */
export function installEditCommands(): () => void {
  return window.desktop?.onEditCommand?.(runEditCommand) ?? (() => {});
}
