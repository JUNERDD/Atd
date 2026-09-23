import { historyField, redo, undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import type { EditCommand } from '../../electron/contract';

/**
 * Runs Edit → Undo/Redo from the application menu. A focused CodeMirror editor with history moves
 * its own history: Blink's native undo stack never sees the edits CodeMirror handles itself, and
 * running the native command inside the editor would rewrite its document behind its back.
 * Anywhere else (inputs, textareas) the native editing command runs, as the menu role did.
 */
export function runEditCommand(command: EditCommand): void {
  const host = document.activeElement?.closest('.cm-editor');
  const view = host instanceof HTMLElement ? EditorView.findFromDOM(host) : null;
  if (view?.state.field(historyField, false)) {
    (command === 'undo' ? undo : redo)(view);
    return;
  }
  document.execCommand(command);
}

/** Routes the application menu's edit commands in this window; returns the unsubscribe. */
export function installEditCommands(): () => void {
  return window.desktop?.onEditCommand?.(runEditCommand) ?? (() => {});
}
